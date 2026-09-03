/**
 * Centralized AsyncStorage key registry. Every persistent key the app reads
 * or writes should live here so we have a single source of truth and can
 * reason about migrations, cleanup, and naming.
 */

export const GOALS_STORAGE_KEY = "paisawise.savingGoals.v1";
export const EXPENSES_STORAGE_KEY = "paisawise.expenses.v1";
export const EXPENSE_NAME_HISTORY_KEY = "paisawise.expenseNameHistory.v1";
export const USER_PROFILE_STORAGE_KEY = "paisawise.userProfile.v1";
export const MONTHLY_INCOME_SYNC_KEY = "paisawise.monthlyIncome.v1";
export const BUDGET_WARNING_TIER_KEY = "budget_warning_tier";
export const TOTAL_EXPENSES_ADDED_KEY = "total_expenses_added";
export const RATING_PROMPT_SHOWN_KEY = "rating_prompt_shown";
export const APP_OPEN_COUNT_KEY = "app_open_count";
export const GUEST_MODE_KEY = "guest_mode";
export const GUEST_BANNER_DISMISSED_AT_KEY = "guest_banner_dismissed_at";
export const NOTIFICATIONS_ENABLED_KEY = "notifications_enabled";
