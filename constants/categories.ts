/**
 * Canonical list of expense categories. Shared between the add-expense
 * screen and the home screen's edit-expense modal so the picker UI stays
 * in sync everywhere.
 */
export const EXPENSE_CATEGORIES = [
  "Food",
  "Transport",
  "Shopping",
  "Utilities",
  "Health",
  "Education",
  "Entertainment",
  "Other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
