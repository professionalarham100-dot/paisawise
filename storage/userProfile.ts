import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, setDoc } from "firebase/firestore";

import {
    MONTHLY_INCOME_SYNC_KEY,
    USER_PROFILE_STORAGE_KEY,
} from "../constants/storage-keys";
import { auth, db } from "../lib/firebase";

export { MONTHLY_INCOME_SYNC_KEY, USER_PROFILE_STORAGE_KEY };

export type UserGender = "male" | "female" | "other";

const YEAR_IN_MS = 365.25 * 24 * 60 * 60 * 1000;

export type UserProfile = {
  fullName: string;
  city: string;
  monthlySalary: number;
  /** Optional explicit monthly spend cap; null means fallback to 80% of salary. */
  monthlyBudgetLimit: number | null;
  gender: UserGender;
  /** Full DOB ISO string (YYYY-MM-DD or full ISO timestamp). */
  dob: string | null;
  /** Derived whole years, computed from dob when available. */
  age: number | null;
  /** Firebase / account email; mirrored in Firestore. */
  email: string | null;
};

export const getAgeFromDob = (dob: string | null): number | null => {
  if (!dob) {
    return null;
  }
  const date = new Date(dob);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const age = Math.floor((Date.now() - date.getTime()) / YEAR_IN_MS);
  if (!Number.isFinite(age) || age < 0 || age > 120) {
    return null;
  }
  return age;
};

const readSalary = (record: Record<string, unknown>): number => {
  const fromSalary = record.salary;
  const fromMonthly = record.monthlySalary;

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
  return b;
};

const readName = (record: Record<string, unknown>): string => {
  if (typeof record.name === "string" && record.name.trim()) {
    return record.name.trim();
  }
  if (typeof record.fullName === "string" && record.fullName.trim()) {
    return record.fullName.trim();
  }
  return "";
};

const readGender = (record: Record<string, unknown>): UserGender => {
  const raw = typeof record.gender === "string" ? record.gender.trim().toLowerCase() : "";
  if (raw === "male") {
    return "male";
  }
  if (raw === "female") {
    return "female";
  }
  if (raw === "other") {
    return "other";
  }
  return "male";
};

const readEmail = (record: Record<string, unknown>): string | null => {
  const v = record.email;
  if (typeof v === "string" && v.trim()) {
    return v.trim();
  }
  return null;
};

const readLegacyAge = (record: Record<string, unknown>): number | null => {
  const v = record.age;
  let n: number;
  if (typeof v === "number" && Number.isFinite(v)) {
    n = Math.round(v);
  } else if (typeof v === "string" && v.trim()) {
    n = Number.parseInt(v.trim(), 10);
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n < 1 || n > 120) {
    return null;
  }
  return n;
};

const readDob = (record: Record<string, unknown>): string | null => {
  const raw = record.dob;
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }
  const dob = raw.trim();
  const parsed = new Date(dob);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return dob;
};

const readMonthlyBudgetLimit = (record: Record<string, unknown>): number | null => {
  const raw = record.monthlyBudgetLimit ?? record.budgetLimit;
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

export const getEffectiveMonthlyBudgetLimit = (profile: UserProfile): number => {
  if (
    profile.monthlyBudgetLimit != null &&
    Number.isFinite(profile.monthlyBudgetLimit) &&
    profile.monthlyBudgetLimit >= 0
  ) {
    return profile.monthlyBudgetLimit;
  }
  return Math.max(0, profile.monthlySalary * 0.8);
};

/** Appends a short gender note for Claude system prompts (add-expense, roast). */
export const buildSystemPromptWithGender = (
  baseSystemPrompt: string,
  gender: UserGender
): string => {
  const genderNote =
    gender === "male"
      ? "User profile: gender is male. Tailor tone and examples naturally for a Pakistani male user (e.g. \"bhai\" where appropriate)."
      : gender === "female"
        ? "User profile: gender is female. Tailor tone and examples respectfully for a Pakistani female user; avoid defaulting to male-coded slang."
        : "User profile: gender is non-binary / unspecified. Use a neutral, respectful Pakistani tone; avoid male- or female-coded slang.";

  return `${baseSystemPrompt}\n\n${genderNote}`;
};

export const formatGenderLabel = (gender: UserGender): string => {
  if (gender === "male") {
    return "Male";
  }
  if (gender === "female") {
    return "Female";
  }
  return "Other";
};

export const serializeUserProfilePayload = (profile: UserProfile) => {
  const payload: Record<string, unknown> = {
    name: profile.fullName,
    city: profile.city,
    salary: profile.monthlySalary,
    gender: profile.gender,
  };
  if (profile.monthlyBudgetLimit != null && Number.isFinite(profile.monthlyBudgetLimit)) {
    payload.monthlyBudgetLimit = profile.monthlyBudgetLimit;
  }
  if (profile.dob != null && profile.dob.trim() !== "") {
    payload.dob = profile.dob.trim();
  }
  if (profile.email != null && profile.email.trim() !== "") {
    payload.email = profile.email.trim();
  }
  return JSON.stringify(payload);
};

export const parseUserProfile = (raw: string): UserProfile | null => {
  try {
    const data = JSON.parse(raw) as unknown;
    if (typeof data !== "object" || data === null) {
      return null;
    }

    const record = data as Record<string, unknown>;
    const fullName = readName(record);
    const city = typeof record.city === "string" ? record.city.trim() : "";
    const monthlySalary = readSalary(record);
    const monthlyBudgetLimit = readMonthlyBudgetLimit(record);
    const gender = readGender(record);
    const dob = readDob(record);
    const age = getAgeFromDob(dob) ?? readLegacyAge(record);
    const email = readEmail(record);

    if (!fullName || !Number.isFinite(monthlySalary) || monthlySalary < 0) {
      return null;
    }

    return {
      fullName,
      city,
      monthlySalary,
      monthlyBudgetLimit,
      gender,
      dob,
      age,
      email,
    };
  } catch {
    return null;
  }
};

export const loadUserProfile = async (): Promise<UserProfile | null> => {
  const raw = await AsyncStorage.getItem(USER_PROFILE_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  return parseUserProfile(raw);
};

export const saveUserProfile = async (profile: UserProfile) => {
  await AsyncStorage.setItem(
    USER_PROFILE_STORAGE_KEY,
    serializeUserProfilePayload(profile)
  );
};

export const pushUserProfileToFirestore = async (
  profile: UserProfile
): Promise<boolean> => {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    return true;
  }

  const docData: Record<string, unknown> = {
    name: profile.fullName,
    city: profile.city,
    salary: profile.monthlySalary,
    gender: profile.gender,
  };
  if (profile.monthlyBudgetLimit != null && Number.isFinite(profile.monthlyBudgetLimit)) {
    docData.monthlyBudgetLimit = profile.monthlyBudgetLimit;
  }
  if (profile.dob != null && profile.dob.trim() !== "") {
    docData.dob = profile.dob.trim();
  }
  const email = auth.currentUser?.email ?? profile.email;
  if (email != null && email.trim() !== "") {
    docData.email = email.trim();
  }

  try {
    await setDoc(doc(db, "users", uid, "data", "profile"), docData);
    return true;
  } catch (error) {
    console.log("Failed to sync user profile to Firestore:", error);
    return false;
  }
};

export const persistUserProfileWithIncomeMirror = async (profile: UserProfile) => {
  await AsyncStorage.setItem(USER_PROFILE_STORAGE_KEY, serializeUserProfilePayload(profile));
  await AsyncStorage.setItem(MONTHLY_INCOME_SYNC_KEY, String(profile.monthlySalary));
  await pushUserProfileToFirestore(profile);
};
