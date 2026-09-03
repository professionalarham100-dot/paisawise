/**
 * Parse a PKR amount string (with optional thousands separators) into a
 * positive number. Returns `null` for empty / non-numeric / non-positive input.
 *
 * Canonical implementation; previously duplicated in `storage/expenses.ts`
 * and `app/goals.tsx`. Uses the stricter `<= 0` rejection consistent with
 * goals validation. UI flows in `add-expense.tsx` already gate with
 * `parsedAmount <= 0`, so the strict variant is safe across all call sites.
 */
export const parsePkrAmount = (raw: string): number | null => {
  const normalized = raw.replace(/,/g, "").trim();
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
};

export const formatPKR = (amount: number): string => {
  if (!Number.isFinite(amount)) {
    return "PKR 0";
  }

  const rounded = Math.round(amount);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const digits = String(abs);
  if (digits.length <= 3) {
    return `${sign}PKR ${digits}`;
  }

  const last3 = digits.slice(-3);
  let lead = digits.slice(0, -3);
  const parts: string[] = [];
  while (lead.length > 2) {
    parts.unshift(lead.slice(-2));
    lead = lead.slice(0, -2);
  }
  if (lead) {
    parts.unshift(lead);
  }
  return `${sign}PKR ${parts.join(",")},${last3}`;
};

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const formatDatePK = (input: string | Date): string => {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const day = date.getDate();
  const month = MONTHS_SHORT[date.getMonth()] ?? "";
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
};
