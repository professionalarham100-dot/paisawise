import { useFocusEffect, useRouter } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Animated,
    AppState,
    FlatList,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { auth } from "../../lib/firebase";

import AsyncStorage from "@react-native-async-storage/async-storage";
import BudgetRingSection from "../../components/BudgetRingSection";
import ExpenseModals from "../../components/ExpenseModals";
import ScreenErrorBoundary from "../../components/ScreenErrorBoundary";
import {
    APP_OPEN_COUNT_KEY,
    BUDGET_WARNING_TIER_KEY,
    GOALS_STORAGE_KEY,
    RATING_PROMPT_SHOWN_KEY,
    TOTAL_EXPENSES_ADDED_KEY,
} from "../../constants/storage-keys";
import {
    Expense,
    deleteExpenseById,
    loadExpenses,
    parsePkrAmount,
    sumExpenses,
    updateExpenseById,
} from "../../storage/expenses";
import { restoreUserDataFromFirestoreIfSignedIn } from "../../storage/firestoreRestore";
import {
    GUEST_BANNER_DISMISSED_AT_KEY,
    getTodayStamp,
    isGuestModeEnabled,
    shouldDeferFirestoreRestoreForGuestLogin,
} from "../../storage/guestMode";
import {
    getEffectiveMonthlyBudgetLimit,
    loadUserProfile,
    persistUserProfileWithIncomeMirror,
} from "../../storage/userProfile";
import { getCategoryColor } from "../../utils/categoryColors";
import { formatPKR } from "../../utils/currency";
import { getStreakData } from "../../utils/streak";

const MAX_EXPENSE_PKR = 9_999_999;
const MAX_EXPENSE_MESSAGE = "Maximum amount is PKR 99,99,999";
const FEATURE_CARD_WIDTH = 280;
const FEATURE_CARD_GAP = 12;
const FEATURE_SNAP = FEATURE_CARD_WIDTH + FEATURE_CARD_GAP;


const formatExpenseDate = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString("en-PK", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const isSameMonthAndYear = (iso: string, ref: Date) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return false;
  }
  return d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear();
};

const filterCurrentMonth = (allExpenses: Expense[]): Expense[] => {
  const now = new Date();
  return allExpenses.filter((expense) => isSameMonthAndYear(expense.date, now));
};

type CategoryBarRow = {
  category: string;
  amount: number;
  color: string;
  percent: number;
};

type CategoryBarsCompactProps = {
  rows: CategoryBarRow[];
  extraCount: number;
};

const CategoryBarsCompact = memo(function CategoryBarsCompact({
  rows,
  extraCount,
}: CategoryBarsCompactProps) {
  const animsRef = useRef<Animated.Value[]>([]);
  if (animsRef.current.length !== rows.length) {
    animsRef.current = rows.map(() => new Animated.Value(0));
  }

  useEffect(() => {
    animsRef.current.forEach((v) => v.setValue(0));
    Animated.stagger(
      80,
      animsRef.current.map((v) =>
        Animated.timing(v, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        })
      )
    ).start();
  }, [rows]);

  if (rows.length === 0) {
    return null;
  }

  return (
    <View style={styles.spendBreakdownCard}>
      <View style={styles.spendBreakdownHeader}>
        <Text  style={styles.spendBreakdownTitle}>
          {"Where\u2019s your money going?"}
        </Text>
        {extraCount > 0 ? (
          <Text  style={styles.spendBreakdownMore}>
            +{extraCount} more
          </Text>
        ) : null}
      </View>

      {rows.map((row, idx) => {
        const anim =
          animsRef.current[idx] ?? new Animated.Value(1);
        const fillPct = Math.max(2, row.percent);
        return (
          <View
            key={row.category}
            style={[
              styles.spendBreakdownRow,
              idx === rows.length - 1 ? styles.spendBreakdownRowLast : null,
            ]}
          >
            <View style={styles.spendBreakdownTopLine}>
              <Text
                
                style={styles.spendBreakdownCategory}
                numberOfLines={1}
              >
                {row.category}
              </Text>
              <Text
                
                style={styles.spendBreakdownAmount}
                numberOfLines={1}
              >
                {formatPKR(row.amount)}{" "}
                <Text style={styles.spendBreakdownPct}>
                  ({row.percent.toFixed(0)}%)
                </Text>
              </Text>
            </View>
            <View style={styles.spendBreakdownTrack}>
              <Animated.View
                style={{
                  height: "100%",
                  width: `${fillPct}%`,
                  backgroundColor: row.color,
                  borderRadius: 4,
                  transform: [{ scaleX: anim }],
                  transformOrigin: "left center",
                }}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
});

const loadTopGoalSummary = async (): Promise<GoalSummary | null> => {
  const raw = await AsyncStorage.getItem(GOALS_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    const rows = parsed
      .map((item) => {
        if (typeof item !== "object" || item === null) {
          return null;
        }
        const goal = item as {
          id?: unknown;
          name?: unknown;
          targetAmount?: unknown;
          savedAmount?: unknown;
        };
        if (
          typeof goal.id !== "string" ||
          typeof goal.name !== "string" ||
          typeof goal.targetAmount !== "number" ||
          typeof goal.savedAmount !== "number" ||
          !Number.isFinite(goal.targetAmount) ||
          goal.targetAmount <= 0 ||
          !Number.isFinite(goal.savedAmount)
        ) {
          return null;
        }
        const percent = Math.max(0, Math.min(100, (goal.savedAmount / goal.targetAmount) * 100));
        return {
          id: goal.id,
          name: goal.name.trim(),
          percent,
        } satisfies GoalSummary;
      })
      .filter(Boolean) as GoalSummary[];
    if (rows.length === 0) {
      return null;
    }
    return rows.sort((a, b) => b.percent - a.percent)[0] ?? null;
  } catch {
    return null;
  }
};

/** Title case for greeting: first letter of each word upper, rest lower (e.g. "ARHAM AFTAB" → "Arham Aftab"). */
const toTitleCaseDisplayName = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed
    .split(/\s+/)
    .map((word) => {
      if (!word) {
        return "";
      }
      const lower = word.toLocaleLowerCase("en-PK");
      return lower.charAt(0).toLocaleUpperCase("en-PK") + lower.slice(1);
    })
    .filter(Boolean)
    .join(" ");
};

/** Greeting uses first token only so long full names do not crowd the line (e.g. "Sample User" → "Sample"). */
const getFirstNameForGreeting = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  const first = trimmed.split(/\s+/)[0] ?? trimmed;
  return toTitleCaseDisplayName(first);
};

const getGreeting = (name: string) => {
  const hour = new Date().getHours();
  if (hour >= 0 && hour < 5) return `Midnight, ${name}! 🌙`;
  if (hour >= 5 && hour < 12) return `Good Morning, ${name}! ☀️`;
  if (hour >= 12 && hour < 16) return `Good Afternoon, ${name}! 👋`;
  if (hour >= 16 && hour < 20) return `Good Evening, ${name}! 🌤️`;
  return `Good Night, ${name}! 🌙`;
};

type CategorySlice = {
  category: string;
  amount: number;
  color: string;
};

type GoalSummary = {
  id: string;
  name: string;
  percent: number;
};

type CategoryRow = CategorySlice & {
  percent: number;
};

const pickCategoryColor = (category: string) => getCategoryColor(category);

const ExpenseListItem = memo(function ExpenseListItem({
  item,
  accentColor,
  onActionRequested,
}: {
  item: Expense;
  accentColor: string;
  onActionRequested: (item: Expense) => void;
}) {
  const openActionMenu = () => onActionRequested(item);

  return (
    <Pressable
      delayLongPress={400}
      onLongPress={openActionMenu}
      style={({ pressed }) => [
        styles.expenseRow,
        { borderLeftWidth: 4, borderLeftColor: accentColor },
        pressed && styles.expenseRowPressed,
      ]}
    >
      <View style={styles.expenseLeft}>
        <Text  style={styles.expenseName} numberOfLines={1} ellipsizeMode="tail">
          {item.name}
        </Text>
        <Text  style={styles.expenseMeta} numberOfLines={1} ellipsizeMode="tail">
          {item.category} · {formatExpenseDate(item.date)}
        </Text>
      </View>
      <View style={styles.expenseRight}>
        <Text  style={styles.expenseAmount}>{formatPKR(item.amount)}</Text>
        <Pressable
          onPress={openActionMenu}
          hitSlop={12}
          style={({ pressed }) => [styles.expenseMenuBtn, pressed && styles.expenseMenuBtnPressed]}
        >
          <Text  style={styles.expenseMenuText}>⋮</Text>
        </Pressable>
      </View>
    </Pressable>
  );
});

/** Keeps pager-dot state local so scrolling the feature row does not rebuild the whole FlatList header. */
const HomeFeatureCarousel = memo(function HomeFeatureCarousel({
  lastExpense,
  topGoal,
  monthlyReportTitle,
  totalExpenses,
}: {
  lastExpense: Expense | null;
  topGoal: GoalSummary | null;
  monthlyReportTitle: string;
  totalExpenses: number;
}) {
  const router = useRouter();
  const [activeFeatureIndex, setActiveFeatureIndex] = useState(0);

  const onFeatureScroll = useCallback((event: { nativeEvent: { contentOffset: { x: number } } }) => {
    const x = event.nativeEvent.contentOffset.x;
    const idx = Math.round(x / FEATURE_SNAP);
    setActiveFeatureIndex(Math.max(0, Math.min(3, idx)));
  }, []);

  return (
    <View style={styles.featureSection}>
      <ScrollView
        horizontal
        snapToInterval={FEATURE_SNAP}
        decelerationRate="fast"
        disableIntervalMomentum
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.featureTrack}
        onMomentumScrollEnd={onFeatureScroll}
      >
        <Pressable style={[styles.featureCard, styles.featureCardGreen]} onPress={() => router.push("/add-expense")}>
          <View style={styles.featureCardOverlay} />
          <Text  style={styles.featureTitle}>Quick Add</Text>
          <Text
            
            style={styles.featureSubtitle}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            Add Expense
          </Text>
          <Text  style={styles.featureMeta}>
            {lastExpense ? `${lastExpense.name} · ${formatPKR(lastExpense.amount)}` : "No recent expense"}
          </Text>
        </Pressable>

        <Pressable style={[styles.featureCard, styles.featureCardGreen]} onPress={() => router.push("/goals")}>
          <View style={styles.featureCardOverlay} />
          <Text  style={styles.featureTitle}>Goals Progress</Text>
          <Text
            
            style={styles.featureSubtitle}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {topGoal ? topGoal.name : "No goal added yet"}
          </Text>
          <View style={styles.featureProgressTrack}>
            <View
              style={[
                styles.featureProgressFill,
                { width: `${topGoal ? Math.max(topGoal.percent, 4) : 4}%` },
              ]}
            />
          </View>
          <Text  style={styles.featureMeta}>
            {topGoal ? `${topGoal.percent.toFixed(0)}% completed` : "0% completed"}
          </Text>
        </Pressable>

        <Pressable style={[styles.featureCard, styles.featureCardRoast]} onPress={() => router.push("/roast")}>
          <View style={styles.featureCardOverlay} />
          <Text  style={styles.featureTitle}>Roast Me 🔥</Text>
          <Text  style={styles.featureMeta}>Let AI judge your spending</Text>
        </Pressable>

        <Pressable style={[styles.featureCard, styles.featureCardGreen]} onPress={() => router.push("/history")}>
          <View style={styles.featureCardOverlay} />
          <Text  style={styles.featureTitle}>📊 Monthly Report</Text>
          <Text
            
            style={styles.featureSubtitle}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {monthlyReportTitle}
          </Text>
          <Text  style={styles.featureMeta}>Total spent: {formatPKR(totalExpenses)}</Text>
        </Pressable>
      </ScrollView>
      <View style={styles.featureDots}>
        {[0, 1, 2, 3].map((idx) => (
          <View
            key={idx}
            style={[styles.featureDot, activeFeatureIndex === idx && styles.featureDotActive]}
          />
        ))}
      </View>
    </View>
  );
});

function Index() {
  const router = useRouter();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [showGuestBlockingModal, setShowGuestBlockingModal] = useState(false);
  const [monthlyIncome, setMonthlyIncome] = useState(0);
  const [userFullName, setUserFullName] = useState("");
  const [monthlyBudgetLimit, setMonthlyBudgetLimit] = useState(0);
  const [hasCustomBudgetLimit, setHasCustomBudgetLimit] = useState(false);
  const [isHomeReady, setIsHomeReady] = useState(false);
  const [isGuestMode, setIsGuestMode] = useState(false);
  const [showGuestBanner, setShowGuestBanner] = useState(false);
  const [trackedExpenseTotal, setTrackedExpenseTotal] = useState(0);
  const ringPulse = useRef(new Animated.Value(1)).current;
  const [topGoal, setTopGoal] = useState<GoalSummary | null>(null);
  const [isIncomeModalVisible, setIsIncomeModalVisible] = useState(false);
  const [incomeDraft, setIncomeDraft] = useState("");
  const [incomeError, setIncomeError] = useState("");
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editTitleDraft, setEditTitleDraft] = useState("");
  const [editAmountDraft, setEditAmountDraft] = useState("");
  const [editCategoryDraft, setEditCategoryDraft] = useState("");
  const [editDateDraft, setEditDateDraft] = useState("");
  const [isEditDatePickerVisible, setIsEditDatePickerVisible] = useState(false);
  const [editDatePickerDraft, setEditDatePickerDraft] = useState(new Date());
  const [editError, setEditError] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [actionExpense, setActionExpense] = useState<Expense | null>(null);
  const [showRatingPrompt, setShowRatingPrompt] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const lastResumeAppOpenBumpAtRef = useRef(0);
  const homeHydratedRef = useRef(false);
  const restoreOnNextHomePullRef = useRef(true);

  const incrementAppOpenCount = useCallback(async () => {
    const raw = await AsyncStorage.getItem(APP_OPEN_COUNT_KEY);
    const n = Number.parseInt(raw ?? "0", 10);
    const base = Number.isFinite(n) && n >= 0 ? n : 0;
    await AsyncStorage.setItem(APP_OPEN_COUNT_KEY, String(base + 1));
  }, []);

  const maybeIncrementAppOpenOnResume = useCallback(async () => {
    const now = Date.now();
    if (now - lastResumeAppOpenBumpAtRef.current < 1500) {
      return;
    }
    lastResumeAppOpenBumpAtRef.current = now;
    await incrementAppOpenCount();
  }, [incrementAppOpenCount]);

  useEffect(() => {
    void incrementAppOpenCount();
    const appStateRef = { current: AppState.currentState };
    const sub = AppState.addEventListener("change", (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (next === "active" && (prev === "background" || prev === "inactive")) {
        restoreOnNextHomePullRef.current = true;
        void maybeIncrementAppOpenOnResume();
      }
    });
    return () => sub.remove();
  }, [incrementAppOpenCount, maybeIncrementAppOpenOnResume]);

  const refreshHome = useCallback(async () => {
    try {
      await auth.authStateReady();
      const guestEnabled = await isGuestModeEnabled();
      setIsGuestMode(guestEnabled);
      if (!guestEnabled) {
        setShowGuestBanner(false);
      } else {
        const dismissedFor = await AsyncStorage.getItem(GUEST_BANNER_DISMISSED_AT_KEY);
        setShowGuestBanner(dismissedFor !== getTodayStamp());
      }

      const needsFirestorePull =
        !homeHydratedRef.current || restoreOnNextHomePullRef.current;
      if (needsFirestorePull) {
        try {
          if (auth.currentUser?.emailVerified) {
            if (!(await shouldDeferFirestoreRestoreForGuestLogin())) {
              await restoreUserDataFromFirestoreIfSignedIn();
            }
          } else if (auth.currentUser) {
            await restoreUserDataFromFirestoreIfSignedIn();
          }
          setSyncFailed(false);
        } catch (error) {
          console.log("Firestore restore failed:", error);
          setSyncFailed(true);
        }
        restoreOnNextHomePullRef.current = false;
      }

      const [nextExpenses, profile, nextTopGoal, storedTotalRaw, ratingShownRaw] = await Promise.all([
        loadExpenses(),
        loadUserProfile(),
        loadTopGoalSummary(),
        AsyncStorage.getItem(TOTAL_EXPENSES_ADDED_KEY),
        AsyncStorage.getItem(RATING_PROMPT_SHOWN_KEY),
      ]);
      const storedTotal = Number.parseInt(storedTotalRaw ?? "0", 10);
      const trackedTotal = Number.isFinite(storedTotal) ? storedTotal : 0;
      const nextTrackedTotal = Math.max(trackedTotal, nextExpenses.length);
      if (nextTrackedTotal !== trackedTotal) {
        await AsyncStorage.setItem(TOTAL_EXPENSES_ADDED_KEY, String(nextTrackedTotal));
      }
      setTrackedExpenseTotal(nextTrackedTotal);
      const ratingPromptAlreadyShown = ratingShownRaw === "true";
      const appOpenRawLatest = await AsyncStorage.getItem(APP_OPEN_COUNT_KEY);
      const appOpenParsed = Number.parseInt(appOpenRawLatest ?? "0", 10);
      const appOpenCount = Number.isFinite(appOpenParsed) && appOpenParsed >= 0 ? appOpenParsed : 0;
      setShowRatingPrompt(
        !ratingPromptAlreadyShown && nextTrackedTotal >= 15 && appOpenCount >= 7
      );
      const currentMonthExpenses = filterCurrentMonth(nextExpenses);

      if (guestEnabled && currentMonthExpenses.length >= 5) {
        const shown = await AsyncStorage.getItem("paisawise.guestModal5Shown.v1");
        if (!shown) {
          setShowGuestBlockingModal(true);
          await AsyncStorage.setItem("paisawise.guestModal5Shown.v1", "true");
        }
      }

      if (!profile) {
        setIsHomeReady(false);
        if (auth.currentUser || guestEnabled) {
          router.replace("/profile");
        } else {
          router.replace("/welcome");
        }
        return;
      }

      setExpenses(currentMonthExpenses);
      const streakData = await getStreakData();
      setCurrentStreak(streakData.currentStreak);
      setMonthlyIncome(profile.monthlySalary);
      setMonthlyBudgetLimit(getEffectiveMonthlyBudgetLimit(profile));
      setHasCustomBudgetLimit(profile.monthlyBudgetLimit != null);
      setUserFullName(profile.fullName);
      setTopGoal(nextTopGoal);
      homeHydratedRef.current = true;
      setIsHomeReady(true);
    } catch (error) {
      console.log("refreshHome failed:", error);
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      void refreshHome();
    }, [refreshHome])
  );

  const totalExpenses = useMemo(() => sumExpenses(expenses), [expenses]);
  const oneTimeTotal = useMemo(
    () => expenses.filter((e) => e.frequency !== "monthly").reduce((sum, e) => sum + e.amount, 0),
    [expenses]
  );
  const monthlyRecurringTotal = useMemo(
    () => expenses.filter((e) => e.frequency === "monthly").reduce((sum, e) => sum + e.amount, 0),
    [expenses]
  );
  const budgetSpendRatio = useMemo(() => {
    if (monthlyBudgetLimit <= 0) {
      return 0;
    }
    return totalExpenses / monthlyBudgetLimit;
  }, [monthlyBudgetLimit, totalExpenses]);

  const budgetRemaining = useMemo(() => monthlyBudgetLimit - totalExpenses, [monthlyBudgetLimit, totalExpenses]);

  const budgetAlertTier = useMemo<"none" | "yellow" | "orange" | "red">(() => {
    if (budgetSpendRatio < 0.5) {
      return "none";
    }
    if (budgetSpendRatio < 0.8) {
      return "yellow";
    }
    if (budgetSpendRatio < 1) {
      return "orange";
    }
    return "red";
  }, [budgetSpendRatio]);
  const lastExpense = expenses[0] ?? null;
  const exceedsIncome = monthlyIncome > 0 && totalExpenses > monthlyIncome;
  const overspendAmount = exceedsIncome ? totalExpenses - monthlyIncome : 0;
  const monthlyReportTitle = useMemo(() => {
    return new Date().toLocaleDateString("en-PK", { month: "long", year: "numeric" });
  }, []);
  const recentHeaderTitle = useMemo(() => {
    const month = new Date().toLocaleDateString("en-PK", { month: "long", year: "numeric" });
    return `Recent Expenses — ${month}`;
  }, []);

  const categoryBreakdown = useMemo(() => {
    const totals = new Map<string, number>();

    for (const expense of expenses) {
      const category = expense.category?.trim() || "Other";
      totals.set(category, (totals.get(category) ?? 0) + expense.amount);
    }

    const slices: CategorySlice[] = [...totals.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .filter((item) => item.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .map((item) => ({
        ...item,
        color: pickCategoryColor(item.category),
      }));

    return slices;
  }, [expenses]);

  // userFullName comes from user_profile `name` (and legacy `fullName`) via loadUserProfile → fullName.
  const greetingLine = useMemo(() => {
    const name = getFirstNameForGreeting(userFullName);
    if (!name) {
      return getGreeting("there");
    }
    return getGreeting(name);
  }, [userFullName]);

  const categoryRows = useMemo((): CategoryRow[] => {
    if (totalExpenses <= 0) {
      return [];
    }

    return categoryBreakdown.map((slice) => ({
      ...slice,
      percent: Math.min(100, Math.max(0, (slice.amount / totalExpenses) * 100)),
    }));
  }, [categoryBreakdown, totalExpenses]);
  const recurringCategorySet = useMemo(() => {
    return new Set(
      expenses
        .filter((e) => e.frequency === "monthly")
        .map((e) => e.category.trim().toLowerCase())
    );
  }, [expenses]);

  const filteredExpenses = useMemo(() => {
    if (!searchQuery.trim()) return expenses;
    const q = searchQuery.toLowerCase();
    return expenses.filter((e) =>
      e.name.toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q)
    );
  }, [expenses, searchQuery]);

  const isRingEmptyState = monthlyIncome > 0 && totalExpenses === 0;

  useEffect(() => {
    if (!isRingEmptyState) {
      ringPulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ringPulse, {
          toValue: 1.04,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(ringPulse, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isRingEmptyState, ringPulse]);

  const openIncomeModal = useCallback(() => {
    setIncomeError("");
    setIncomeDraft(String(Math.round(monthlyIncome)));
    setIsIncomeModalVisible(true);
  }, [monthlyIncome]);

  const closeIncomeModal = () => {
    setIsIncomeModalVisible(false);
    setIncomeError("");
  };

  const saveIncome = async () => {
    const parsed = parsePkrAmount(incomeDraft);
    if (parsed === null) {
      setIncomeError("Enter a valid PKR amount.");
      return;
    }

    try {
      const current = await loadUserProfile();
      if (!current) {
        setIncomeError("Profile missing. Open profile to set up again.");
        return;
      }

      await persistUserProfileWithIncomeMirror({
        ...current,
        monthlySalary: parsed,
      });
      setMonthlyIncome(parsed);
      closeIncomeModal();
    } catch {
      setIncomeError("Could not save income. Try again.");
    }
  };

  const handleDeleteExpense = useCallback(async (item: Expense) => {
    const runDelete = async () => {
      await deleteExpenseById(item.id);
      const nextExpenses = await loadExpenses();
      setExpenses(filterCurrentMonth(nextExpenses));
    };

    Alert.alert("Are you sure?", "Delete this expense?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void runDelete();
        },
      },
    ]);
  }, []);

  const openExpenseActions = useCallback((item: Expense) => {
    setActionExpense(item);
  }, []);

  const closeExpenseActions = useCallback(() => {
    setActionExpense(null);
  }, []);

  const openEditExpenseModal = useCallback((item: Expense) => {
    const dateOnly = new Date(item.date).toISOString().slice(0, 10);
    setEditingExpenseId(item.id);
    setEditTitleDraft(item.name);
    setEditAmountDraft(String(Math.round(item.amount)));
    setEditCategoryDraft(item.category);
    setEditDateDraft(dateOnly);
    setEditDatePickerDraft(new Date(item.date));
    setEditError("");
    setIsEditModalVisible(true);
  }, []);

  const closeEditExpenseModal = useCallback(() => {
    setIsEditModalVisible(false);
    setEditingExpenseId(null);
    setIsEditDatePickerVisible(false);
    setEditError("");
  }, []);

  const openEditDatePicker = useCallback(() => {
    const parsed = new Date(editDateDraft.trim());
    setEditDatePickerDraft(Number.isNaN(parsed.getTime()) ? new Date() : parsed);
    setIsEditDatePickerVisible(true);
  }, [editDateDraft]);

  const confirmEditDatePicker = useCallback(() => {
    setEditDateDraft(editDatePickerDraft.toISOString().slice(0, 10));
    setIsEditDatePickerVisible(false);
    if (editError) {
      setEditError("");
    }
  }, [editDatePickerDraft, editError]);

  const saveEditedExpense = useCallback(async () => {
    const id = editingExpenseId;
    if (!id || isSavingEdit) {
      return;
    }
    const title = editTitleDraft.trim();
    const category = editCategoryDraft.trim();
    const amount = parsePkrAmount(editAmountDraft);
    const date = new Date(editDateDraft.trim());
    if (!title || !category || amount == null || Number.isNaN(date.getTime())) {
      setEditError("Fill all fields with valid values.");
      return;
    }
    if (amount > MAX_EXPENSE_PKR) {
      setEditError(MAX_EXPENSE_MESSAGE);
      return;
    }

    setIsSavingEdit(true);
    try {
      const updated = await updateExpenseById(id, {
        name: title,
        amountRaw: String(amount),
        category,
        dateIso: date.toISOString(),
      });
      if (!updated) {
        setEditError("Could not update expense.");
        return;
      }
      const nextExpenses = await loadExpenses();
      setExpenses(filterCurrentMonth(nextExpenses));
      closeEditExpenseModal();
    } finally {
      setIsSavingEdit(false);
    }
  }, [
    closeEditExpenseModal,
    editAmountDraft,
    editCategoryDraft,
    editDateDraft,
    editTitleDraft,
    editingExpenseId,
    isSavingEdit,
  ]);

  const renderExpenseItem = useCallback(
    ({ item }: { item: Expense }) => (
      <ExpenseListItem
        item={item}
        accentColor={pickCategoryColor(item.category || "Other")}
        onActionRequested={openExpenseActions}
      />
    ),
    [openExpenseActions]
  );

  const dismissRatingPrompt = useCallback(() => {
    setShowRatingPrompt(false);
    void AsyncStorage.setItem(RATING_PROMPT_SHOWN_KEY, "true");
  }, []);

  useEffect(() => {
    if (budgetAlertTier === "none") {
      return;
    }
    const tierRank: Record<"yellow" | "orange" | "red", number> = {
      yellow: 1,
      orange: 2,
      red: 3,
    };
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    void (async () => {
      const stored = await AsyncStorage.getItem(BUDGET_WARNING_TIER_KEY);
      const [storedMonth, storedTier] = (stored || "").split("|");
      const storedRank =
        tierRank[storedTier as "yellow" | "orange" | "red"] ?? 0;
      const currentRank = tierRank[budgetAlertTier];

      if (storedMonth !== monthKey || currentRank > storedRank) {
        await AsyncStorage.setItem(
          BUDGET_WARNING_TIER_KEY,
          `${monthKey}|${budgetAlertTier}`
        );
      }
    })();
  }, [budgetAlertTier]);

  const listHeader = useMemo(
    () => (
    <View>
      {syncFailed ? (
        <View style={styles.syncFailedBanner}>
          <Text  style={styles.syncFailedText}>
            ⚠️ Cloud sync failed — data saved locally only
          </Text>
        </View>
      ) : null}
      {isGuestMode && (showGuestBanner || trackedExpenseTotal >= 20) ? (
        <View
          style={[
            styles.guestBanner,
            trackedExpenseTotal >= 10 ? styles.guestBannerUrgent : null,
          ]}
        >
          <Text
            
            style={[
              styles.guestBannerText,
              trackedExpenseTotal >= 10 ? styles.guestBannerTextUrgent : null,
            ]}
          >
            {trackedExpenseTotal >= 10
              ? `\u26a0\ufe0f ${trackedExpenseTotal} expenses sirf phone pe saved hain \u2014 ek reset se sab khatam. Sign up karo!`
              : "\ud83d\udcbe Create an account to save your data across devices"}
          </Text>
          <View style={styles.guestBannerActions}>
            <Pressable onPress={() => router.push("/login?tab=register&fromGuest=1")}>
              <Text
                
                style={[
                  styles.guestBannerLink,
                  trackedExpenseTotal >= 10 ? styles.guestBannerLinkUrgent : null,
                ]}
              >
                Sign up
              </Text>
            </Pressable>
            {trackedExpenseTotal < 20 ? (
              <Pressable
                onPress={() => {
                  setShowGuestBanner(false);
                  void AsyncStorage.setItem(GUEST_BANNER_DISMISSED_AT_KEY, getTodayStamp());
                }}
              >
                <Text  style={styles.guestBannerDismiss}>✕</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
      {currentStreak >= 2 ? (
        <View style={styles.streakBadge}>
          <Text style={styles.streakText}>
            🔥 {currentStreak}-day streak
          </Text>
        </View>
      ) : null}
      <BudgetRingSection
        greetingLine={greetingLine}
        budgetSpendRatio={budgetSpendRatio}
        budgetAlertTier={budgetAlertTier}
        budgetRemaining={budgetRemaining}
        hasCustomBudgetLimit={hasCustomBudgetLimit}
        monthlyIncome={monthlyIncome}
        totalExpenses={totalExpenses}
        monthlyBudgetLimit={monthlyBudgetLimit}
        oneTimeTotal={oneTimeTotal}
        monthlyRecurringTotal={monthlyRecurringTotal}
        isRingEmptyState={isRingEmptyState}
        ringPulse={ringPulse}
        onIncomePress={openIncomeModal}
      />

      {budgetAlertTier !== "none" ? (
        <View
          style={[
            styles.alertBanner,
            budgetAlertTier === "yellow"
              ? styles.alertBannerYellow
              : budgetAlertTier === "orange"
                ? styles.alertBannerOrange
                : styles.alertBannerRed,
          ]}
        >
          <Text 
            style={[
              styles.alertBannerText,
              budgetAlertTier === "yellow"
                ? styles.alertBannerTextYellow
                : budgetAlertTier === "orange"
                  ? styles.alertBannerTextOrange
                  : styles.alertBannerTextRed,
            ]}
          >
            {budgetAlertTier === "yellow"
              ? `⚠️ Heads up! You've spent ${(budgetSpendRatio * 100).toFixed(0)}% of your monthly budget.`
              : budgetAlertTier === "orange"
                ? `🚨 Careful! You've spent ${(budgetSpendRatio * 100).toFixed(0)}% of your budget. Only ${formatPKR(
                    Math.max(0, budgetRemaining)
                  )} left!`
                : `🔴 Budget exceeded! You're ${formatPKR(Math.abs(budgetRemaining))} over your limit!`}
          </Text>
        </View>
      ) : null}

      {exceedsIncome ? (
        <View style={styles.incomeExceedCard}>
          <Text  style={styles.incomeExceedText}>
            ⚠️ Expenses exceed income! You've spent {formatPKR(overspendAmount)} more than your monthly income.
          </Text>
        </View>
      ) : null}

      <HomeFeatureCarousel
        lastExpense={lastExpense}
        topGoal={topGoal}
        monthlyReportTitle={monthlyReportTitle}
        totalExpenses={totalExpenses}
      />

      {expenses.length > 0 && categoryRows.length > 0 ? (
        <View style={styles.breakdownCard}>
          <Text  style={styles.breakdownTitle}>Spending by category</Text>

          <View style={styles.breakdownList}>
            {categoryRows.map((row) => (
              <View key={row.category} style={styles.breakdownRow}>
                <View style={styles.breakdownTopRow}>
                  <View style={styles.categoryLabel}>
                    <View
                      style={[styles.categoryDot, { backgroundColor: row.color }]}
                    />
                    <Text  style={styles.breakdownCategory}>
                      {row.category} {recurringCategorySet.has(row.category.trim().toLowerCase()) ? "🔄 " : ""}
                      <Text  style={styles.breakdownCategoryPercent}>{row.percent.toFixed(0)}%</Text>
                    </Text>
                  </View>
                  <Text  style={styles.breakdownAmount}>{formatPKR(row.amount)}</Text>
                </View>

                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${Math.max(row.percent, row.amount > 0 ? 2 : 0)}%`,
                        backgroundColor: row.color,
                      },
                    ]}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.searchContainer}>
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search expenses..."
          placeholderTextColor="#4a5568"
          style={styles.searchInput}
        />
        {searchQuery.length > 0 ? (
          <Pressable
            onPress={() => setSearchQuery("")}
            hitSlop={12}
            style={styles.searchClear}
          >
            <Text style={styles.searchClearText}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.recentHeaderRow}>
        <Text
          
          style={styles.recentHeaderTitle}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >
          {recentHeaderTitle}
        </Text>
        {expenses.length > 0 ? (
          <Text  style={styles.recentHeaderCount}>
            {expenses.length} {expenses.length === 1 ? "entry" : "entries"}
          </Text>
        ) : null}
      </View>
    </View>
    ),
    [
      budgetAlertTier,
      budgetRemaining,
      budgetSpendRatio,
      categoryRows,
      currentStreak,
      exceedsIncome,
      expenses.length,
      greetingLine,
      isGuestMode,
      lastExpense,
      monthlyIncome,
      monthlyRecurringTotal,
      monthlyReportTitle,
      oneTimeTotal,
      openIncomeModal,
      searchQuery,
      showGuestBlockingModal,
      overspendAmount,
      recurringCategorySet,
      hasCustomBudgetLimit,
      monthlyBudgetLimit,
      recentHeaderTitle,
      ringPulse,
      isRingEmptyState,
      trackedExpenseTotal,
      router,
      showGuestBanner,
      syncFailed,
      topGoal,
      totalExpenses,
    ]
  );

  if (!isHomeReady) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "right", "left", "bottom"]}>
        <StatusBar barStyle="light-content" />
        <View style={styles.bootstrap}>
          <ActivityIndicator color="#00ff88" size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "right", "left", "bottom"]}>
      <StatusBar barStyle="light-content" />

      <View style={[styles.homeTopBar, { paddingTop: 8 }]}>
        <View style={styles.homeTopBarSpacer} />
        <Pressable
          accessibilityLabel="Edit profile"
          onPress={() => router.push("/profile")}
          style={styles.profileEditButton}
        >
          <Text  style={styles.profileEditIcon}>✎</Text>
        </Pressable>
      </View>

      <Modal
        visible={showGuestBlockingModal}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.blockingModalOverlay}>
          <View style={styles.blockingModalCard}>
            <Text style={styles.blockingModalTitle}>
              Apna data save karo 💾
            </Text>
            <Text style={styles.blockingModalBody}>
              Tumhare 5 expenses sirf is phone pe hain. Phone reset = sab kuch gone. Free account banao — 30 seconds mein.
            </Text>
            <Pressable
              style={styles.blockingModalPrimary}
              onPress={() => {
                setShowGuestBlockingModal(false);
                router.push("/login?tab=register&fromGuest=1");
              }}
            >
              <Text style={styles.blockingModalPrimaryText}>
                Sign Up Free →
              </Text>
            </Pressable>
            <Pressable
              style={styles.blockingModalSecondary}
              onPress={() => setShowGuestBlockingModal(false)}
            >
              <Text style={styles.blockingModalSecondaryText}>
                Baad mein
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <ExpenseModals
        isIncomeModalVisible={isIncomeModalVisible}
        incomeDraft={incomeDraft}
        incomeError={incomeError}
        closeIncomeModal={closeIncomeModal}
        saveIncome={saveIncome}
        setIncomeDraft={setIncomeDraft}
        setIncomeError={setIncomeError}
        isEditModalVisible={isEditModalVisible}
        editTitleDraft={editTitleDraft}
        editAmountDraft={editAmountDraft}
        editCategoryDraft={editCategoryDraft}
        editDateDraft={editDateDraft}
        editError={editError}
        isSavingEdit={isSavingEdit}
        closeEditExpenseModal={closeEditExpenseModal}
        saveEditedExpense={saveEditedExpense}
        setEditTitleDraft={setEditTitleDraft}
        setEditAmountDraft={setEditAmountDraft}
        setEditCategoryDraft={setEditCategoryDraft}
        openEditDatePicker={openEditDatePicker}
        actionExpense={actionExpense}
        closeExpenseActions={closeExpenseActions}
        openEditExpenseModal={openEditExpenseModal}
        handleDeleteExpense={handleDeleteExpense}
        isEditDatePickerVisible={isEditDatePickerVisible}
        editDatePickerDraft={editDatePickerDraft}
        setEditDatePickerDraft={setEditDatePickerDraft}
        confirmEditDatePicker={confirmEditDatePicker}
        setIsEditDatePickerVisible={setIsEditDatePickerVisible}
      />

      <View style={styles.homeBody}>
        <FlatList
          style={styles.list}
          data={filteredExpenses}
          keyExtractor={(item) => item.id}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          removeClippedSubviews={false}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: 96 },
          ]}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            searchQuery.trim() ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>
                  No expenses matching &apos;{searchQuery}&apos;
                </Text>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <View style={styles.emptyStateIcon}>
                  <Text style={styles.emptyStateIconText}>
                    💸
                  </Text>
                </View>
                <Text style={styles.emptyTitle}>
                  Koi kharch record nahi hai
                </Text>
                <Text style={styles.emptySubtitle}>
                  Pehla expense add karo — AI batayega kahan save kar sakte ho
                </Text>
                <Pressable
                  onPress={() => router.push("/add-expense")}
                  style={styles.emptyStateButton}
                >
                  <Text style={styles.emptyStateButtonText}>
                    Add First Expense
                  </Text>
                </Pressable>
              </View>
            )
          }
          renderItem={renderExpenseItem}
        />

        {showRatingPrompt ? (
          <View style={styles.ratingPromptCard}>
            <Pressable
              style={styles.ratingPromptContent}
              onPress={() => {
                Alert.alert("Rating", "Play Store listing coming soon!");
                void AsyncStorage.setItem(RATING_PROMPT_SHOWN_KEY, "true");
                setShowRatingPrompt(false);
              }}
            >
              <Text  style={styles.ratingPromptText}>Enjoying PaisaWise? Rate us on Play Store ⭐</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Dismiss rating prompt"
              onPress={dismissRatingPrompt}
              hitSlop={10}
              style={styles.ratingPromptClose}
            >
              <Text  style={styles.ratingPromptCloseText}>✕</Text>
            </Pressable>
          </View>
        ) : null}

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#111111",
  },
  homeBody: {
    flex: 1,
  },
  bootstrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111111",
  },
  homeTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: 20,
    paddingBottom: 2,
  },
  homeTopBarSpacer: {
    flex: 1,
  },
  profileEditButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#111111",
    borderWidth: 1,
    borderColor: "rgba(0, 255, 136, 0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  profileEditIcon: {
    color: "#00ff88",
    fontSize: 20,
    fontWeight: "700",
  },
  guestBanner: {
    marginTop: 6,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0, 255, 136, 0.35)",
    backgroundColor: "#101513",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  guestBannerText: {
    color: "#ccefdc",
    fontSize: 13,
    flex: 1,
    fontWeight: "600",
  },
  guestBannerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  guestBannerLink: {
    color: "#00ff88",
    fontWeight: "800",
    fontSize: 13,
  },
  guestBannerDismiss: {
    color: "#9aa0a6",
    fontWeight: "800",
    fontSize: 14,
  },
  guestBannerUrgent: {
    borderColor: "rgba(255, 176, 32, 0.55)",
    backgroundColor: "#1a1408",
  },
  guestBannerTextUrgent: {
    color: "#ffd58a",
  },
  guestBannerLinkUrgent: {
    color: "#ffb020",
  },
  syncFailedBanner: {
    backgroundColor: "#2a1a0a",
    borderColor: "rgba(255,150,0,0.4)",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  syncFailedText: {
    color: "#ffb347",
    fontSize: 12,
    fontWeight: "700",
  },
  blockingModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  blockingModalCard: {
    backgroundColor: "#111111",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#1f1f1f",
    padding: 20,
  },
  blockingModalTitle: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 12,
  },
  blockingModalBody: {
    color: "#9ca3af",
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 20,
  },
  blockingModalPrimary: {
    backgroundColor: "#00ff88",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  blockingModalPrimaryText: {
    color: "#04170f",
    fontSize: 16,
    fontWeight: "900",
  },
  blockingModalSecondary: {
    paddingVertical: 10,
    alignItems: "center",
  },
  blockingModalSecondaryText: {
    color: "#6b7280",
    fontSize: 14,
    fontWeight: "600",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.25)",
    paddingHorizontal: 14,
    marginBottom: 10,
    marginTop: 8,
  },
  searchInput: {
    flex: 1,
    color: "#ffffff",
    fontSize: 14,
    paddingVertical: 10,
  },
  searchClear: {
    padding: 6,
  },
  searchClearText: {
    color: "#6b7280",
    fontSize: 14,
    fontWeight: "800",
  },
  streakBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,120,0,0.12)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 6,
    alignSelf: "flex-start",
  },
  streakText: {
    color: "#ff9940",
    fontSize: 13,
    fontWeight: "700",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 22,
  },
  brandLogo: {
    width: 55,
    height: 55,
  },
  brandTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  subtitle: {
    color: "#9aa0a6",
    fontSize: 15,
    marginTop: 4,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  card: {
    marginTop: 22,
    backgroundColor: "#1a1a1a",
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(0, 255, 136, 0.28)",
    ...Platform.select({
      web: {
        boxShadow: "0 0 28px rgba(0, 255, 136, 0.28)",
      },
      default: {
        shadowColor: "#00ff88",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.35,
        shadowRadius: 18,
        elevation: 10,
      },
    }),
  },
  cardTitle: {
    color: "#f1f5f9",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 18,
  },
  spendBreakdownCard: {
    marginTop: 16,
    backgroundColor: "#0f0f0f",
    borderRadius: 16,
    padding: 16,
  },
  spendBreakdownHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  spendBreakdownTitle: {
    color: "#f8fafc",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  spendBreakdownMore: {
    color: "#9aa0a6",
    fontSize: 12,
    fontWeight: "700",
    marginLeft: 8,
  },
  spendBreakdownRow: {
    marginBottom: 12,
  },
  spendBreakdownRowLast: {
    marginBottom: 0,
  },
  spendBreakdownTopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
    gap: 8,
  },
  spendBreakdownCategory: {
    color: "#e5e7eb",
    fontSize: 13,
    fontWeight: "700",
    flexShrink: 1,
    minWidth: 0,
  },
  spendBreakdownAmount: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
    flexShrink: 0,
  },
  spendBreakdownPct: {
    color: "#9aa0a6",
    fontSize: 11,
    fontWeight: "600",
  },
  spendBreakdownTrack: {
    height: 8,
    backgroundColor: "#1a1a1a",
    borderRadius: 4,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  incomeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    marginHorizontal: -6,
    paddingHorizontal: 6,
    borderRadius: 12,
  },
  incomeHint: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 6,
    fontWeight: "600",
  },
  label: {
    color: "#9ca3af",
    fontSize: 15,
    fontWeight: "500",
    flex: 1,
    minWidth: 0,
    marginRight: 10,
  },
  incomeValue: {
    color: "#00ff88",
    fontSize: 19,
    fontWeight: "800",
    flexShrink: 0,
    textAlign: "right",
    maxWidth: "58%",
  },
  incomePrompt: {
    color: "#9ca3af",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "right",
    flexShrink: 1,
    marginLeft: 12,
  },
  expenseValue: {
    color: "#ff9f6e",
    fontSize: 19,
    fontWeight: "800",
    flexShrink: 0,
    textAlign: "right",
    maxWidth: "58%",
  },
  remainingValue: {
    fontSize: 19,
    fontWeight: "900",
    flexShrink: 0,
    textAlign: "right",
    maxWidth: "58%",
  },
  divider: {
    height: 1,
    backgroundColor: "#222222",
    marginVertical: 16,
  },
  alertBanner: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  alertBannerYellow: {
    borderColor: "rgba(245, 207, 84, 0.45)",
    backgroundColor: "#2a260f",
  },
  alertBannerOrange: {
    borderColor: "rgba(255, 145, 64, 0.5)",
    backgroundColor: "#2a1d10",
  },
  alertBannerRed: {
    borderColor: "rgba(255, 77, 77, 0.55)",
    backgroundColor: "#2a1111",
    ...Platform.select({
      web: { boxShadow: "0 0 18px rgba(255,77,77,0.35)" },
      default: {
        shadowColor: "#ff4d4d",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.4,
        shadowRadius: 8,
        elevation: 8,
      },
    }),
  },
  alertBannerText: {
    fontSize: 13,
    fontWeight: "700",
  },
  alertBannerTextYellow: {
    color: "#f5cf54",
  },
  alertBannerTextOrange: {
    color: "#ffae70",
  },
  alertBannerTextRed: {
    color: "#ff8f8f",
  },
  incomeExceedCard: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 77, 77, 0.65)",
    backgroundColor: "#2a1111",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  incomeExceedText: {
    color: "#ff9c9c",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
  },
  featureSection: {
    marginTop: 16,
    marginBottom: 72,
  },
  featureTrack: {
    paddingRight: 8,
    gap: FEATURE_CARD_GAP,
  },
  featureCard: {
    width: FEATURE_CARD_WIDTH,
    height: 170,
    borderRadius: 16,
    padding: 16,
    justifyContent: "space-between",
    borderWidth: 1.5,
    backgroundColor: "#1a1a1a",
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: "#00ff88",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.05,
        shadowRadius: 12,
      },
      android: {
        elevation: 2,
      },
      web: {
        boxShadow: "0 0 12px rgba(0, 255, 136, 0.05)",
      },
    }),
  },
  featureCardOverlay: {
    ...StyleSheet.absoluteFillObject,
    top: "52%",
    backgroundColor: "rgba(10,10,10,0.6)",
  },
  featureCardGreen: {
    borderColor: "rgba(0, 255, 136, 0.4)",
  },
  featureCardRoast: {
    borderColor: "rgba(255, 92, 92, 0.45)",
    backgroundColor: "#161110",
    ...Platform.select({
      web: { boxShadow: "inset 0 -60px 100px rgba(255, 80, 20, 0.18)" },
      default: {},
    }),
  },
  featureTitle: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "900",
  },
  featureSubtitle: {
    color: "#c3fce4",
    fontSize: 12,
    fontWeight: "700",
  },
  featureMeta: {
    color: "#9ca3af",
    fontSize: 13,
    fontWeight: "600",
  },
  featureProgressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "#1e1e1e",
    overflow: "hidden",
  },
  featureProgressFill: {
    height: "100%",
    backgroundColor: "#00ff88",
  },
  featureDots: {
    flexDirection: "row",
    gap: 8,
    alignSelf: "center",
    marginTop: 10,
  },
  featureDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: "#35413b",
  },
  featureDotActive: {
    width: 16,
    backgroundColor: "#00ff88",
  },
  breakdownCard: {
    marginTop: 16,
    backgroundColor: "#1a1a1a",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1f2a24",
    ...Platform.select({
      web: {
        boxShadow: "0 10px 28px rgba(0, 255, 136, 0.1)",
      },
      default: {
        shadowColor: "#00ff88",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.08,
        shadowRadius: 18,
        elevation: 10,
      },
    }),
  },
  breakdownTitle: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 12,
    letterSpacing: 0.2,
  },
  breakdownList: {
    gap: 12,
  },
  breakdownRow: {
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#1a1a1a",
  },
  breakdownTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  categoryLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  categoryDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  breakdownCategory: {
    color: "#f3f4f6",
    fontSize: 15,
    fontWeight: "900",
    flexShrink: 1,
  },
  breakdownCategoryPercent: {
    color: "#8b93a1",
    fontSize: 12,
    fontWeight: "700",
  },
  breakdownAmount: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  breakdownPercent: {
    color: "#8b93a1",
    fontSize: 12,
    fontWeight: "800",
  },
  progressTrack: {
    height: 10,
    width: "100%",
    borderRadius: 999,
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "#222222",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 0,
    gap: 10,
  },
  recentHeaderRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 26,
    marginBottom: 4,
    paddingBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0, 255, 136, 0.12)",
  },
  recentHeaderTitle: {
    color: "#f1f5f9",
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0.3,
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  recentHeaderCount: {
    color: "#6b7280",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  expenseRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  expenseRowPressed: {
    backgroundColor: "#131313",
  },
  expenseLeft: {
    flex: 1,
  },
  expenseName: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "800",
  },
  expenseMeta: {
    color: "#9ca3af",
    fontSize: 13,
    marginTop: 6,
    fontWeight: "600",
  },
  expenseAmount: {
    color: "#FF6B35",
    fontSize: 16,
    fontWeight: "900",
  },
  expenseRight: {
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 8,
  },
  expenseMenuBtn: {
    minWidth: 34,
    minHeight: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#151515",
    borderWidth: 1,
    borderColor: "#232323",
  },
  expenseMenuBtnPressed: {
    backgroundColor: "#1b1b1b",
    borderColor: "#2f2f2f",
  },
  expenseMenuText: {
    color: "#9ca3af",
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 16,
  },
  emptyState: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0, 255, 136, 0.14)",
    backgroundColor: "#1a1a1a",
    padding: 24,
    alignItems: "center",
  },
  emptyStateIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(0, 255, 136, 0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyStateIconText: {
    fontSize: 38,
    lineHeight: 44,
  },
  emptyTitle: {
    color: "#e5e7eb",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  emptySubtitle: {
    color: "#9ca3af",
    fontSize: 14,
    marginTop: 6,
    lineHeight: 20,
    fontWeight: "500",
    textAlign: "center",
  },
  emptyStateButton: {
    marginTop: 18,
    backgroundColor: "#00ff88",
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 999,
  },
  emptyStateButtonText: {
    color: "#04170f",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  ratingPromptCard: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 98,
    marginBottom: 80,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.28)",
    backgroundColor: "#141414",
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 12,
    paddingRight: 8,
    zIndex: 997,
  },
  ratingPromptContent: {
    flex: 1,
    paddingVertical: 10,
    paddingRight: 8,
  },
  ratingPromptText: {
    color: "#f1f5f9",
    fontSize: 13,
    fontWeight: "700",
  },
  ratingPromptClose: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#202020",
    borderWidth: 1,
    borderColor: "#333333",
  },
  ratingPromptCloseText: {
    color: "#9ca3af",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 14,
  },
});

export default function Home() {
  return (
    <ScreenErrorBoundary screenName="Home">
      <Index />
    </ScreenErrorBoundary>
  );
}
