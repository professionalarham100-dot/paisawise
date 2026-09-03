import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "../lib/firebase";
import { coerceExpenseList, writeLocalExpensesOnly, type Expense } from "./expenses";
import {
    MONTHLY_INCOME_SYNC_KEY,
    USER_PROFILE_STORAGE_KEY,
    parseUserProfile,
    serializeUserProfilePayload,
    type UserProfile,
} from "./userProfile";

import { GOALS_STORAGE_KEY } from "../constants/storage-keys";
import { clamp } from "../utils/math";

export type FirestoreSavingGoal = {
  id: string;
  createdAt: number;
  name: string;
  targetAmount: number;
  deadlineMonth: string;
  savedAmount: number;
  achieved: boolean;
};

export const coerceSavingGoalsList = (parsed: unknown): FirestoreSavingGoal[] => {
  if (!Array.isArray(parsed)) {
    return [];
  }

  const goals: FirestoreSavingGoal[] = [];

  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    const record = item as Partial<FirestoreSavingGoal>;
    if (
      typeof record.id !== "string" ||
      typeof record.name !== "string" ||
      typeof record.targetAmount !== "number" ||
      typeof record.savedAmount !== "number" ||
      typeof record.achieved !== "boolean"
    ) {
      continue;
    }

    const createdAt =
      typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
        ? record.createdAt
        : 0;

    const deadlineMonth =
      typeof record.deadlineMonth === "string" ? record.deadlineMonth.trim() : "";

    if (!Number.isFinite(record.targetAmount) || record.targetAmount <= 0) {
      continue;
    }

    if (!Number.isFinite(record.savedAmount) || record.savedAmount < 0) {
      continue;
    }

    const target = record.targetAmount;
    const saved = clamp(record.savedAmount, 0, target);
    const achieved = saved >= target;

    goals.push({
      id: record.id,
      createdAt,
      name: record.name.trim(),
      targetAmount: target,
      deadlineMonth,
      savedAmount: saved,
      achieved,
    });
  }

  return goals.sort((a, b) => b.createdAt - a.createdAt);
};

const readSalaryFromFirestore = (d: Record<string, unknown>): number => {
  const fromSalary = d.salary;
  const fromMonthly = d.monthlySalary;

  const tryNum = (v: unknown): number => {
    if (typeof v === "number" && Number.isFinite(v)) {
      return v;
    }
    if (typeof v === "string") {
      const n = Number.parseFloat(v);
      return Number.isFinite(n) ? n : Number.NaN;
    }
    return Number.NaN;
  };

  const a = tryNum(fromSalary);
  if (Number.isFinite(a) && a >= 0) {
    return a;
  }

  const b = tryNum(fromMonthly);
  return Number.isFinite(b) && b >= 0 ? b : Number.NaN;
};

const readBudgetLimitFromFirestore = (d: Record<string, unknown>): number | null => {
  const raw = d.monthlyBudgetLimit ?? d.budgetLimit;
  if (raw == null || raw === "") {
    return null;
  }
  let n: number;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    n = raw;
  } else if (typeof raw === "string" && raw.trim()) {
    n = Number.parseFloat(raw.trim());
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return n;
};

type FirestoreSyncListener = (ok: boolean) => void;

const firestoreSyncListeners = new Set<FirestoreSyncListener>();

/** Subscribe to Firestore pull success/failure (for global UI). */
export const subscribeFirestoreSyncStatus = (listener: FirestoreSyncListener) => {
  firestoreSyncListeners.add(listener);
  return () => {
    firestoreSyncListeners.delete(listener);
  };
};

const notifyFirestoreSyncStatus = (ok: boolean) => {
  for (const fn of firestoreSyncListeners) {
    fn(ok);
  }
};

/** Build `UserProfile` from a Firestore `users/{uid}/data/profile` document. */
export const parseFirestoreProfileDoc = (d: Record<string, unknown>): UserProfile | null => {
  const name =
    typeof d.name === "string"
      ? d.name.trim()
      : typeof d.fullName === "string"
        ? d.fullName.trim()
        : "";
  const city = typeof d.city === "string" ? d.city.trim() : "";
  const monthlySalary = readSalaryFromFirestore(d);
  const monthlyBudgetLimit = readBudgetLimitFromFirestore(d);
  const genderStr = typeof d.gender === "string" ? d.gender : "male";
  const dob = typeof d.dob === "string" && d.dob.trim() !== "" ? d.dob.trim() : null;

  const rawObj: Record<string, unknown> = {
    name,
    city,
    salary: monthlySalary,
    gender: genderStr,
  };
  if (monthlyBudgetLimit != null) {
    rawObj.monthlyBudgetLimit = monthlyBudgetLimit;
  }
  if (dob != null) {
    rawObj.dob = dob;
  }

  const em = d.email;
  if (typeof em === "string" && em.trim()) {
    rawObj.email = em.trim();
  }

  return parseUserProfile(JSON.stringify(rawObj));
};

export type CloudDataPresence = {
  hasExpenses: boolean;
  hasProfile: boolean;
  hasGoals: boolean;
  hasMetaHistory: boolean;
  hasAny: boolean;
};

export type CloudUserDataBundle = {
  presence: CloudDataPresence;
  expenses: Expense[];
  goals: FirestoreSavingGoal[];
  profile: UserProfile | null;
  expenseNameHistory: string[];
};

const readExpenseNameHistoryFromMeta = (data: Record<string, unknown> | undefined): string[] => {
  const raw = data?.expenseNameHistory;
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
    }
  }
  return out.slice(0, 500);
};

/** One Firestore round-trip for login conflict detection + guest/cloud merge. */
export const fetchCloudUserDataBundleForCurrentUser = async (): Promise<CloudUserDataBundle | null> => {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    return null;
  }

  try {
    const expensesRef = doc(db, "users", uid, "data", "expenses");
    const profileRef = doc(db, "users", uid, "data", "profile");
    const goalsRef = doc(db, "users", uid, "data", "goals");
    const metaRef = doc(db, "users", uid, "data", "meta");

    const [expSnap, profSnap, goalsSnap, metaSnap] = await Promise.all([
      getDoc(expensesRef),
      getDoc(profileRef),
      getDoc(goalsRef),
      getDoc(metaRef),
    ]);

    const expenses = expSnap.exists() ? coerceExpenseList(expSnap.data()?.list) : [];
    const goals = goalsSnap.exists() ? coerceSavingGoalsList(goalsSnap.data()?.list) : [];
    const profile = profSnap.exists() ? parseFirestoreProfileDoc(profSnap.data() as Record<string, unknown>) : null;
    const expenseNameHistory = metaSnap.exists()
      ? readExpenseNameHistoryFromMeta(metaSnap.data() as Record<string, unknown>)
      : [];

    const hasExpenses = expenses.length > 0;
    const hasGoals = goals.length > 0;
    const hasProfile =
      profile != null &&
      (profile.fullName.trim() !== "" || profile.monthlySalary > 0 || profile.city.trim() !== "");
    const hasMetaHistory = expenseNameHistory.length > 0;
    const hasAny = hasExpenses || hasGoals || hasProfile || hasMetaHistory;

    return {
      presence: { hasExpenses, hasGoals, hasProfile, hasMetaHistory, hasAny },
      expenses,
      goals,
      profile,
      expenseNameHistory,
    };
  } catch (e) {
    console.log("fetchCloudUserDataBundleForCurrentUser failed:", e);
    return null;
  }
};

/** When signed in, pull Firestore `users/{uid}/data/*` into AsyncStorage (cloud wins). */
export const restoreUserDataFromFirestoreIfSignedIn = async (): Promise<boolean> => {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    notifyFirestoreSyncStatus(true);
    return true;
  }

  try {
    const expensesRef = doc(db, "users", uid, "data", "expenses");
    const profileRef = doc(db, "users", uid, "data", "profile");
    const goalsRef = doc(db, "users", uid, "data", "goals");

    const [expSnap, profSnap, goalsSnap] = await Promise.all([
      getDoc(expensesRef),
      getDoc(profileRef),
      getDoc(goalsRef),
    ]);

    if (expSnap.exists()) {
      const data = expSnap.data();
      const list = data?.list;
      const next = coerceExpenseList(list);
      await writeLocalExpensesOnly(next);
    }

    if (profSnap.exists()) {
      const profile = parseFirestoreProfileDoc(profSnap.data() as Record<string, unknown>);
      if (profile) {
        await AsyncStorage.setItem(
          USER_PROFILE_STORAGE_KEY,
          serializeUserProfilePayload(profile)
        );
        await AsyncStorage.setItem(MONTHLY_INCOME_SYNC_KEY, String(profile.monthlySalary));
      }
    }

    if (goalsSnap.exists()) {
      const data = goalsSnap.data();
      const list = data?.list;
      const next = coerceSavingGoalsList(list);
      await AsyncStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(next));
    }

    notifyFirestoreSyncStatus(true);
    return true;
  } catch (error) {
    console.log("restoreUserDataFromFirestoreIfSignedIn failed:", error);
    notifyFirestoreSyncStatus(false);
    return false;
  }
};
