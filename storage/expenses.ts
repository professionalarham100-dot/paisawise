import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, setDoc } from "firebase/firestore";

import { EXPENSES_STORAGE_KEY } from "../constants/storage-keys";
import { auth, db } from "../lib/firebase";
import { parsePkrAmount } from "../utils/currency";
import { updateStreak } from "../utils/streak";

export { EXPENSES_STORAGE_KEY, parsePkrAmount };

export type Expense = {
  id: string;
  name: string;
  amount: number;
  category: string;
  frequency: "one_time" | "monthly";
  date: string; // ISO string
};

const uuid = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });

/** Coerce unknown JSON (e.g. from Firestore) into validated expense rows. */
export const coerceExpenseList = (parsed: unknown): Expense[] => {
  if (!Array.isArray(parsed)) {
    return [];
  }

  const expenses: Expense[] = [];

  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    const record = item as Partial<Expense>;
    if (
      typeof record.id !== "string" ||
      typeof record.name !== "string" ||
      typeof record.amount !== "number" ||
      typeof record.category !== "string" ||
      typeof record.date !== "string"
    ) {
      continue;
    }

    if (!Number.isFinite(record.amount) || record.amount < 0) {
      continue;
    }

    const date = new Date(record.date);
    if (Number.isNaN(date.getTime())) {
      continue;
    }

    const frequency =
      record.frequency === "monthly" || record.frequency === "one_time"
        ? record.frequency
        : "one_time";

    expenses.push({
      id: record.id,
      name: record.name.trim(),
      category: record.category.trim(),
      amount: record.amount,
      frequency,
      date: record.date,
    });
  }

  return expenses.sort((a, b) => {
    const aTime = new Date(a.date).getTime();
    const bTime = new Date(b.date).getTime();
    return bTime - aTime;
  });
};

export const loadExpenses = async (): Promise<Expense[]> => {
  const raw = await AsyncStorage.getItem(EXPENSES_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return coerceExpenseList(parsed);
  } catch {
    return [];
  }
};

const syncExpensesToFirestore = async (expenses: Expense[]): Promise<boolean> => {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    return true;
  }

  try {
    await setDoc(doc(db, "users", uid, "data", "expenses"), { list: expenses });
    return true;
  } catch (error) {
    console.log("Failed to sync expenses to Firestore:", error);
    return false;
  }
};

/** Write expenses to device only (used when restoring from Firestore — avoids a cloud write loop). */
export const writeLocalExpensesOnly = async (expenses: Expense[]) => {
  await AsyncStorage.setItem(EXPENSES_STORAGE_KEY, JSON.stringify(expenses));
};

const saveExpenses = async (expenses: Expense[]) => {
  await AsyncStorage.setItem(EXPENSES_STORAGE_KEY, JSON.stringify(expenses));
  await syncExpensesToFirestore(expenses);
};

export const replaceAllExpenses = async (expenses: Expense[]) => {
  await saveExpenses(expenses);
};

export const addExpense = async (input: {
  name: string;
  amountRaw: string;
  category: string;
  frequency: "one_time" | "monthly";
}): Promise<Expense | null> => {
  const name = input.name.trim();
  const category = input.category.trim();
  const frequency = input.frequency;
  const amount = parsePkrAmount(input.amountRaw);

  if (!name || !category || amount === null || (frequency !== "one_time" && frequency !== "monthly")) {
    return null;
  }

  const next: Expense = {
    id: uuid(),
    name,
    amount,
    category,
    frequency,
    date: new Date().toISOString(),
  };

  const existing = await loadExpenses();
  await saveExpenses([next, ...existing]);
  void updateStreak();
  return next;
};

export const deleteExpenseById = async (id: string) => {
  const existing = await loadExpenses();
  const next = existing.filter((expense) => expense.id !== id);

  if (next.length === existing.length) {
    return false;
  }

  await saveExpenses(next);
  return true;
};

export const updateExpenseById = async (
  id: string,
  updates: {
    name: string;
    amountRaw: string;
    category: string;
    dateIso: string;
  }
): Promise<Expense | null> => {
  const name = updates.name.trim();
  const category = updates.category.trim();
  const amount = parsePkrAmount(updates.amountRaw);
  const date = new Date(updates.dateIso);

  if (!name || !category || amount === null || Number.isNaN(date.getTime())) {
    return null;
  }

  const existing = await loadExpenses();
  const index = existing.findIndex((expense) => expense.id === id);
  if (index < 0) {
    return null;
  }

  const nextExpense: Expense = {
    ...existing[index],
    name,
    amount,
    category,
    date: date.toISOString(),
  };

  const next = [...existing];
  next[index] = nextExpense;
  await saveExpenses(next);
  return nextExpense;
};

export const sumExpenses = (expenses: Expense[]) => {
  return expenses.reduce((sum, item) => sum + item.amount, 0);
};
