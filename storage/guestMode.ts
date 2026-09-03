import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, setDoc } from "firebase/firestore";

import { auth, db } from "../lib/firebase";
import { loadExpenses, writeLocalExpensesOnly, type Expense } from "./expenses";
import {
    coerceSavingGoalsList,
    type CloudUserDataBundle,
    type FirestoreSavingGoal,
} from "./firestoreRestore";
import {
    getAgeFromDob,
    loadUserProfile,
    MONTHLY_INCOME_SYNC_KEY,
    serializeUserProfilePayload,
    USER_PROFILE_STORAGE_KEY,
    type UserProfile,
} from "./userProfile";

import {
    EXPENSE_NAME_HISTORY_KEY,
    GOALS_STORAGE_KEY,
    GUEST_BANNER_DISMISSED_AT_KEY,
    GUEST_MODE_KEY,
} from "../constants/storage-keys";

export { GUEST_BANNER_DISMISSED_AT_KEY, GUEST_MODE_KEY };

export const isGuestModeEnabled = async (): Promise<boolean> => {
  const raw = await AsyncStorage.getItem(GUEST_MODE_KEY);
  return raw === "true";
};

export const setGuestModeEnabled = async (enabled: boolean): Promise<void> => {
  if (enabled) {
    await AsyncStorage.setItem(GUEST_MODE_KEY, "true");
    return;
  }
  await AsyncStorage.removeItem(GUEST_MODE_KEY);
};

export const clearGuestMode = async (): Promise<void> => {
  await setGuestModeEnabled(false);
};

const newClientId = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

/**
 * When guest mode is on and the device still has meaningful local data, do not pull Firestore
 * into AsyncStorage yet — the login screen must run guest-vs-cloud conflict resolution first.
 */
export const shouldDeferFirestoreRestoreForGuestLogin = async (): Promise<boolean> => {
  if (!(await isGuestModeEnabled())) {
    return false;
  }
  return hasMeaningfulGuestLocalData();
};

export const hasMeaningfulGuestLocalData = async (): Promise<boolean> => {
  const [expenses, profile, goalsRaw] = await Promise.all([
    loadExpenses(),
    loadUserProfile(),
    AsyncStorage.getItem(GOALS_STORAGE_KEY),
  ]);
  if (expenses.length > 0) {
    return true;
  }
  if (profile && (profile.fullName.trim() !== "" || profile.monthlySalary > 0)) {
    return true;
  }
  if (!goalsRaw) {
    return false;
  }
  try {
    const goals = coerceSavingGoalsList(JSON.parse(goalsRaw) as unknown);
    return goals.length > 0;
  } catch {
    return false;
  }
};

const mergeExpenseLists = (cloud: Expense[], local: Expense[]): Expense[] => {
  const used = new Set(cloud.map((e) => e.id));
  const remapped = local.map((e) => ({
    ...e,
    id: used.has(e.id) ? newClientId() : e.id,
  }));
  remapped.forEach((e) => used.add(e.id));
  const combined = [...cloud, ...remapped];
  combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return combined;
};

const mergeGoalLists = (cloud: FirestoreSavingGoal[], local: FirestoreSavingGoal[]): FirestoreSavingGoal[] => {
  const used = new Set(cloud.map((g) => g.id));
  const remapped = local.map((g) => ({
    ...g,
    id: used.has(g.id) ? newClientId() : g.id,
  }));
  remapped.forEach((g) => used.add(g.id));
  return [...cloud, ...remapped].sort((a, b) => b.createdAt - a.createdAt);
};

const mergeUserProfiles = (
  cloud: UserProfile | null,
  guest: UserProfile | null,
  accountEmail: string | null
): UserProfile | null => {
  if (!cloud && !guest) {
    return null;
  }
  if (!guest) {
    const c = cloud!;
    return { ...c, email: c.email ?? accountEmail };
  }
  if (!cloud) {
    return { ...guest, email: accountEmail ?? guest.email };
  }
  const dob = cloud.dob ?? guest.dob;
  return {
    fullName: cloud.fullName.trim() ? cloud.fullName : guest.fullName,
    city: cloud.city.trim() ? cloud.city : guest.city,
    monthlySalary: Math.max(cloud.monthlySalary, guest.monthlySalary),
    monthlyBudgetLimit: cloud.monthlyBudgetLimit ?? guest.monthlyBudgetLimit,
    gender: cloud.gender,
    dob,
    age: getAgeFromDob(dob),
    email: accountEmail ?? cloud.email ?? guest.email,
  };
};

const parseLocalExpenseNameHistory = (raw: string | null): string[] => {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .slice(0, 500);
  } catch {
    return [];
  }
};

const mergeExpenseNameHistories = (cloud: string[], local: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...cloud, ...local]) {
    const k = s.toLowerCase();
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(s);
    if (out.length >= 500) {
      break;
    }
  }
  return out;
};

/** Merge guest AsyncStorage data with a pre-fetched cloud bundle, write local, then push to Firestore. */
export const mergeGuestLocalWithCloudBundle = async (cloud: CloudUserDataBundle): Promise<void> => {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    return;
  }

  const [guestExpenses, guestProfile, goalsRaw, historyRaw] = await Promise.all([
    loadExpenses(),
    loadUserProfile(),
    AsyncStorage.getItem(GOALS_STORAGE_KEY),
    AsyncStorage.getItem(EXPENSE_NAME_HISTORY_KEY),
  ]);

  let guestGoals: FirestoreSavingGoal[] = [];
  if (goalsRaw) {
    try {
      guestGoals = coerceSavingGoalsList(JSON.parse(goalsRaw) as unknown);
    } catch {
      guestGoals = [];
    }
  }

  const guestHistory = parseLocalExpenseNameHistory(historyRaw);
  const mergedExpenses = mergeExpenseLists(cloud.expenses, guestExpenses);
  const mergedGoals = mergeGoalLists(cloud.goals, guestGoals);
  const mergedProfile = mergeUserProfiles(cloud.profile, guestProfile, auth.currentUser?.email?.trim() ?? null);
  const mergedHistory = mergeExpenseNameHistories(cloud.expenseNameHistory, guestHistory);

  await writeLocalExpensesOnly(mergedExpenses);
  await AsyncStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(mergedGoals));
  if (mergedProfile) {
    await AsyncStorage.setItem(USER_PROFILE_STORAGE_KEY, serializeUserProfilePayload(mergedProfile));
    await AsyncStorage.setItem(MONTHLY_INCOME_SYNC_KEY, String(mergedProfile.monthlySalary));
  }
  await AsyncStorage.setItem(EXPENSE_NAME_HISTORY_KEY, JSON.stringify(mergedHistory));

  await migrateGuestLocalDataToFirestoreForCurrentUser();
};

export const getTodayStamp = (): string => {
  return new Date().toISOString().slice(0, 10);
};

type RawGoal = {
  id: string;
  createdAt: number;
  name: string;
  targetAmount: number;
  deadlineMonth: string;
  savedAmount: number;
  achieved: boolean;
};

const coerceGoals = (parsed: unknown): RawGoal[] => {
  if (!Array.isArray(parsed)) {
    return [];
  }
  const rows: RawGoal[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const rec = item as Partial<RawGoal>;
    if (
      typeof rec.id !== "string" ||
      typeof rec.name !== "string" ||
      typeof rec.createdAt !== "number" ||
      typeof rec.targetAmount !== "number" ||
      typeof rec.deadlineMonth !== "string" ||
      typeof rec.savedAmount !== "number" ||
      typeof rec.achieved !== "boolean"
    ) {
      continue;
    }
    rows.push({
      id: rec.id,
      createdAt: rec.createdAt,
      name: rec.name.trim(),
      targetAmount: rec.targetAmount,
      deadlineMonth: rec.deadlineMonth.trim(),
      savedAmount: rec.savedAmount,
      achieved: rec.achieved,
    });
  }
  return rows;
};

export const migrateGuestLocalDataToFirestoreForCurrentUser = async (): Promise<boolean> => {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    return false;
  }

  const [expenses, profile, goalsRaw, expenseHistoryRaw] = await Promise.all([
    loadExpenses(),
    loadUserProfile(),
    AsyncStorage.getItem(GOALS_STORAGE_KEY),
    AsyncStorage.getItem(EXPENSE_NAME_HISTORY_KEY),
  ]);

  const writes: Array<Promise<void>> = [];

  writes.push(
    setDoc(doc(db, "users", uid, "data", "expenses"), {
      list: expenses,
    }).then(() => undefined)
  );

  if (profile) {
    const email = auth.currentUser?.email?.trim() ?? profile.email ?? null;
    const profileWithEmail = { ...profile, email: email && email !== "" ? email : null };
    // Keep local payload normalized too.
    await AsyncStorage.setItem(USER_PROFILE_STORAGE_KEY, serializeUserProfilePayload(profileWithEmail));
    writes.push(
      setDoc(doc(db, "users", uid, "data", "profile"), {
        name: profileWithEmail.fullName,
        city: profileWithEmail.city,
        salary: profileWithEmail.monthlySalary,
        gender: profileWithEmail.gender,
        ...(profileWithEmail.dob ? { dob: profileWithEmail.dob } : {}),
        ...(profileWithEmail.email ? { email: profileWithEmail.email } : {}),
      }).then(() => undefined)
    );
    await AsyncStorage.setItem(MONTHLY_INCOME_SYNC_KEY, String(profileWithEmail.monthlySalary));
  }

  if (goalsRaw) {
    try {
      const parsed = JSON.parse(goalsRaw) as unknown;
      const goals = coerceGoals(parsed);
      writes.push(
        setDoc(doc(db, "users", uid, "data", "goals"), {
          list: goals,
        }).then(() => undefined)
      );
    } catch {
      // Ignore malformed local goals payload.
    }
  }

  if (expenseHistoryRaw) {
    try {
      const parsed = JSON.parse(expenseHistoryRaw) as unknown;
      if (Array.isArray(parsed)) {
        const history = parsed
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
          .slice(0, 500);
        writes.push(
          setDoc(
            doc(db, "users", uid, "data", "meta"),
            { expenseNameHistory: history },
            { merge: true }
          ).then(() => undefined)
        );
      }
    } catch {
      // Ignore malformed history payload.
    }
  }

  await Promise.all(writes);
  return true;
};
