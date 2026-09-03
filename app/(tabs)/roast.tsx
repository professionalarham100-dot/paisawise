import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Platform,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ViewShot from "react-native-view-shot";

import ScreenErrorBoundary from "../../components/ScreenErrorBoundary";
import { GOALS_STORAGE_KEY } from "../../constants/storage-keys";
import { Expense, loadExpenses, sumExpenses } from "../../storage/expenses";
import {
    loadUserProfile,
    MONTHLY_INCOME_SYNC_KEY,
    type UserProfile,
} from "../../storage/userProfile";
import { getRoast } from "../../utils/aiService";
import { cleanAIText } from "../../utils/aiText";
import { formatPKR } from "../../utils/currency";

const DEFAULT_MONTHLY_INCOME = 250000;

type SavingGoal = {
  id: string;
  createdAt: number;
  name: string;
  targetAmount: number;
  deadlineMonth: string;
  savedAmount: number;
  achieved: boolean;
};

const clampGoalAmount = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value));
};

const loadGoalsForRoast = async (): Promise<SavingGoal[]> => {
  const raw = await AsyncStorage.getItem(GOALS_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const goals: SavingGoal[] = [];

  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    const record = item as Partial<SavingGoal>;
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
    const saved = clampGoalAmount(record.savedAmount, 0, target);
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

const parseStoredMonthlyIncome = (raw: string | null): number => {
  if (!raw) {
    return DEFAULT_MONTHLY_INCOME;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_MONTHLY_INCOME;
  }

  return parsed;
};

const RoastCard = ({
  userName,
  city,
  roastText,
}: {
  userName: string;
  city: string;
  roastText: string;
}) => {
  const paragraphs = roastText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const useHeader = paragraphs.length > 1;

  return (
    <View style={styles.roastShareCard}>
      <View style={styles.roastGridOverlay}>
        {Array.from({ length: 7 }).map((_, index) => (
          <View key={`grid-v-${index}`} style={[styles.gridVLine, { left: `${index * 16}%` }]} />
        ))}
        {Array.from({ length: 8 }).map((_, index) => (
          <View key={`grid-h-${index}`} style={[styles.gridHLine, { top: `${index * 14}%` }]} />
        ))}
      </View>
      <View style={styles.roastShareHeader}>
        <Text  style={styles.roastShareLogo}>💰 PaisaWise</Text>
        <Text  style={styles.roastCardTitle}>Roasted by PaisaWise 🔥</Text>
      </View>
      <Text  style={styles.roastNameCity}>
        {userName} {city ? `• ${city}` : ""}
      </Text>
      {paragraphs.map((para, idx) => {
        const isHeader = useHeader && idx === 0;
        const isLast = idx === paragraphs.length - 1;
        return (
          <Text
            key={idx}
            
            style={[
              isHeader ? styles.roastCardHeader : styles.roastCardText,
              !isLast && styles.roastParagraphSpacing,
            ]}
          >
            {para}
          </Text>
        );
      })}
      <View style={styles.roastBottomStrip}>
        <Text  style={styles.roastBottomStripText}>paisawise.app</Text>
      </View>
    </View>
  );
};

function RoastScreen() {
  const router = useRouter();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [goals, setGoals] = useState<SavingGoal[]>([]);
  const [excludedGoalIds, setExcludedGoalIds] = useState<string[]>([]);
  const [monthlyIncome, setMonthlyIncome] = useState(DEFAULT_MONTHLY_INCOME);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isExpensesLoading, setIsExpensesLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [roastText, setRoastText] = useState("");
  const [isShareBusy, setIsShareBusy] = useState(false);
  const viewShotRef = useRef<ViewShot | null>(null);
  const [roastSource, setRoastSource] = useState<
    "claude" | "groq" | "offline" | null
  >(null);

  const totalSpent = useMemo(() => sumExpenses(expenses), [expenses]);

  const goalsForRoast = useMemo(
    () => goals.filter((goal) => !excludedGoalIds.includes(goal.id)),
    [goals, excludedGoalIds]
  );

  const roastHydratedRef = useRef(false);

  const refreshRoastContext = useCallback(async () => {
    if (!roastHydratedRef.current) {
      setIsExpensesLoading(true);
    }
    try {
      const [nextExpenses, incomeRaw, nextGoals, profileLoaded] = await Promise.all([
        loadExpenses(),
        AsyncStorage.getItem(MONTHLY_INCOME_SYNC_KEY),
        loadGoalsForRoast(),
        loadUserProfile(),
      ]);
      setExpenses(nextExpenses);
      setMonthlyIncome(
        profileLoaded?.monthlySalary ?? parseStoredMonthlyIncome(incomeRaw)
      );
      setProfile(profileLoaded);
      setGoals(nextGoals);
      setExcludedGoalIds([]);
    } finally {
      roastHydratedRef.current = true;
      setIsExpensesLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshRoastContext();
    }, [refreshRoastContext])
  );

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace("/(tabs)");
  };

  const handleRoast = async () => {
    if (isLoading) {
      return;
    }

    if (expenses.length === 0) {
      Alert.alert(
        "No expenses yet!",
        "Add at least one expense before getting roasted 😄"
      );
      return;
    }

    setIsLoading(true);
    setRoastText("");
    setRoastSource(null);

    try {
      const effectiveProfile =
        profile ??
        ({
          fullName: "",
          city: "",
          dob: null,
          age: null,
          gender: "male",
          monthlySalary: monthlyIncome,
          monthlyBudgetLimit: null,
          email: null,
        } as UserProfile);
      const result = await getRoast(
        effectiveProfile,
        expenses,
        goalsForRoast
      );
      setRoastText(cleanAIText(result.text));
      setRoastSource(result.source);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not fetch roast right now. Please try again.";
      setRoastText(message);
      setRoastSource(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleShareRoast = async () => {
    if (!roastText.trim()) {
      return;
    }
    setIsShareBusy(true);
    try {
      if (!viewShotRef.current) {
        return;
      }
      const captureUri = await viewShotRef.current.capture?.();
      if (!captureUri) {
        throw new Error("Could not capture roast card image.");
      }
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert("Sharing unavailable", "Sharing is not available on this device.");
        return;
      }
      await Sharing.shareAsync(captureUri, {
        mimeType: "image/png",
        dialogTitle: "🔥 Share My Roast",
        UTI: "public.png",
      });
    } catch (error) {
      Alert.alert("Could not share roast", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setIsShareBusy(false);
    }
  };

  const excludeGoalFromRoast = (goalId: string) => {
    setExcludedGoalIds((prev) => (prev.includes(goalId) ? prev : [...prev, goalId]));
  };

  const canRoast = expenses.length > 0 && !isExpensesLoading;
  const isRoastButtonDisabled = !canRoast || isLoading;

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        <View style={styles.screenHeader}>
          <View style={styles.navRow}>
            <TouchableOpacity activeOpacity={0.85} onPress={handleBack} style={styles.backNavButton}>
              <Text  style={styles.backNavButtonText}>← Back</Text>
            </TouchableOpacity>
            <Text
              
              style={styles.headerTitle}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              🔥 Roast Me 🔥
            </Text>
            <View style={styles.headerSpacer} />
          </View>
          <Text
            
            style={styles.headerSubtitle}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.65}
          >
            Let AI judge your spending habits
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >

          <View style={styles.previewCard}>
            <Text  style={styles.previewCardTitle}>What will get roasted</Text>
            <Text  style={styles.previewCardHint}>
              Income and expenses are read-only. ✕ on a goal drops it from this roast only
              — it is stored in Saving Goals.
            </Text>

            {isExpensesLoading ? (
              <View style={styles.previewLoading}>
                <ActivityIndicator color="#00ff88" />
                <Text  style={styles.previewLoadingText}>Loading your data…</Text>
              </View>
            ) : expenses.length === 0 ? (
              <Text  style={styles.emptyMessage}>
                Add some expenses first so I have something to roast 😏
              </Text>
            ) : (
              <>
                <View style={styles.totalPill}>
                  <Text  style={styles.totalPillLabel}>Total in list</Text>
                  <Text
                    
                    style={styles.totalPillValue}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.6}
                  >
                    {formatPKR(totalSpent)}
                  </Text>
                </View>
                <FlatList
                  data={expenses}
                  keyExtractor={(expense) => expense.id}
                  scrollEnabled={false}
                  style={styles.expenseList}
                  renderItem={({ item: expense }) => (
                    <View style={styles.expenseRow}>
                      <View style={styles.expenseRowMain}>
                        <Text
                          
                          style={styles.expenseName}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.6}
                        >
                          {expense.name}
                        </Text>
                        <Text
                          
                          style={styles.expenseAmount}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.6}
                        >
                          {formatPKR(expense.amount)}
                        </Text>
                      </View>
                      <Text  style={styles.expenseMeta}>
                        {expense.category} · {formatExpenseDate(expense.date)}
                      </Text>
                    </View>
                  )}
                />

                <Text  style={styles.goalsPreviewTitle}>Saving goals</Text>
                {goals.length === 0 ? (
                  <Text  style={styles.goalsPreviewEmpty}>
                    No goals saved yet — Claude will hear crickets here.
                  </Text>
                ) : goalsForRoast.length === 0 ? (
                  <Text  style={styles.goalsPreviewEmpty}>
                    All goals removed from this roast — add them back by leaving and
                    re-opening this screen.
                  </Text>
                ) : (
                  <FlatList
                    data={goalsForRoast}
                    keyExtractor={(goal) => goal.id}
                    scrollEnabled={false}
                    style={styles.goalPreviewList}
                    renderItem={({ item: goal }) => (
                      <View style={styles.goalPreviewRow}>
                        <View style={styles.goalPreviewRowBody}>
                          <Text  style={styles.goalPreviewName} numberOfLines={2}>
                            {goal.name}
                            {goal.achieved ? " ✓" : ""}
                          </Text>
                          <Text  style={styles.goalPreviewAmounts}>
                            {formatPKR(goal.savedAmount)} /{" "}
                            {formatPKR(goal.targetAmount)}
                          </Text>
                        </View>
                        <TouchableOpacity
                          accessibilityLabel="Remove goal from this roast"
                          activeOpacity={0.85}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          onPress={() => excludeGoalFromRoast(goal.id)}
                          style={styles.goalPreviewRemove}
                        >
                          <Text  style={styles.goalPreviewRemoveText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  />
                )}
              </>
            )}
          </View>
          <TouchableOpacity
            activeOpacity={0.9}
            style={[
              styles.roastButton,
              isRoastButtonDisabled && styles.roastButtonDisabled,
            ]}
            onPress={handleRoast}
            disabled={isRoastButtonDisabled}
          >
            <Text  style={styles.roastButtonText}>
              {isLoading ? "Roasting…" : "Roast Me 🔥"}
            </Text>
          </TouchableOpacity>

          {roastText ? (
            <>
              <ViewShot ref={viewShotRef} options={{ format: "png", quality: 1 }}>
                <RoastCard
                  userName={profile?.fullName?.trim() || "User"}
                  city={profile?.city?.trim() || ""}
                  roastText={roastText}
                />
              </ViewShot>
              {roastSource ? (
                <Text 
                  style={[
                    styles.aiSourceTag,
                    roastSource === "claude"
                      ? styles.aiSourceClaude
                      : roastSource === "groq"
                      ? styles.aiSourceGroq
                      : styles.aiSourceOffline,
                  ]}
                >
                  {roastSource === "claude"
                    ? "⚡ Powered by Claude"
                    : roastSource === "groq"
                      ? "⚡ Powered by Groq"
                      : "Offline suggestion"}
                </Text>
              ) : null}
              <TouchableOpacity
                activeOpacity={0.9}
                style={styles.shareButton}
                onPress={() => {
                  void handleShareRoast();
                }}
                disabled={isShareBusy}
              >
                <Text  style={styles.shareButtonText}>
                  {isShareBusy ? "Preparing image..." : "🔥 Share My Roast"}
                </Text>
              </TouchableOpacity>
            </>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#111111",
  },
  container: {
    flex: 1,
    backgroundColor: "#111111",
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
  },
  screenHeader: {
    marginBottom: 16,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headerTitle: {
    flex: 1,
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 0.4,
    textAlign: "center",
  },
  headerSpacer: {
    width: 72,
  },
  headerSubtitle: {
    color: "#9aa0a6",
    fontSize: 14,
    marginTop: 10,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 4,
  },
  backNavButton: {
    backgroundColor: "#00FF88",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    ...Platform.select({
      android: { elevation: 2 },
      default: {},
    }),
  },
  backNavButtonText: {
    color: "#04110a",
    fontSize: 16,
    fontWeight: "800",
  },
  scrollContent: {
    paddingBottom: 112,
  },
  previewCard: {
    backgroundColor: "#1a1a1a",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(0, 255, 136, 0.22)",
    ...Platform.select({
      web: {
        boxShadow: "0 0 24px rgba(0, 255, 136, 0.18)",
      },
      default: {
        shadowColor: "#00ff88",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.2,
        shadowRadius: 16,
        elevation: 8,
      },
    }),
  },
  previewCardTitle: {
    color: "#f1f5f9",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  previewCardHint: {
    color: "#6b7280",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 6,
    marginBottom: 14,
  },
  previewLoading: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 28,
    gap: 10,
  },
  previewLoadingText: {
    color: "#9aa0a6",
    fontSize: 14,
    fontWeight: "600",
  },
  emptyMessage: {
    color: "#cbd5e1",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
    paddingVertical: 8,
  },
  totalPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#0c1612",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(0, 255, 136, 0.16)",
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  totalPillLabel: {
    color: "#9aa0a6",
    fontSize: 13,
    fontWeight: "700",
    flex: 1,
    minWidth: 0,
    marginRight: 10,
  },
  totalPillValue: {
    color: "#00ff88",
    fontSize: 16,
    fontWeight: "900",
    flexShrink: 0,
    textAlign: "right",
    maxWidth: "52%",
  },
  expenseList: {
    gap: 10,
  },
  expenseRow: {
    backgroundColor: "#1a1a1a",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1a2420",
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  expenseRowMain: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  expenseName: {
    flex: 1,
    minWidth: 0,
    color: "#f8fafc",
    fontSize: 15,
    fontWeight: "800",
  },
  expenseAmount: {
    color: "#00ff88",
    fontSize: 14,
    fontWeight: "900",
    flexShrink: 0,
    marginLeft: 8,
    textAlign: "right",
    maxWidth: "42%",
  },
  expenseMeta: {
    color: "#6b7280",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 6,
  },
  goalsPreviewTitle: {
    color: "#e2e8f0",
    fontSize: 14,
    fontWeight: "900",
    marginTop: 18,
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  goalsPreviewEmpty: {
    color: "#6b7280",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 20,
  },
  goalPreviewList: {
    gap: 8,
  },
  goalPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1a2420",
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 8,
  },
  goalPreviewRowBody: {
    flex: 1,
    minWidth: 0,
  },
  goalPreviewName: {
    color: "#f1f5f9",
    fontSize: 14,
    fontWeight: "800",
  },
  goalPreviewAmounts: {
    color: "#00ff88",
    fontSize: 13,
    fontWeight: "900",
    marginTop: 4,
  },
  goalPreviewRemove: {
    minWidth: 36,
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 77, 77, 0.4)",
    backgroundColor: "#1a0a0a",
    alignItems: "center",
    justifyContent: "center",
  },
  goalPreviewRemoveText: {
    color: "#ff6b6b",
    fontSize: 15,
    fontWeight: "900",
    lineHeight: 17,
  },
  roastButton: {
    marginTop: 14,
    borderRadius: 18,
    backgroundColor: "#00ff88",
    paddingVertical: 18,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(0, 255, 136, 0.45)",
    ...Platform.select({
      web: {
        boxShadow: "0 8px 24px rgba(0, 255, 136, 0.28)",
      },
      default: {
        shadowColor: "#00ff88",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
        elevation: 10,
      },
    }),
  },
  roastButtonDisabled: {
    opacity: 0.45,
  },
  roastButtonText: {
    color: "#04170f",
    fontSize: 17,
    fontWeight: "900",
  },
  roastShareCard: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.26)",
    backgroundColor: "#060d08",
    padding: 20,
    overflow: "hidden",
    ...Platform.select({
      web: {
        boxShadow:
          "0 20px 40px rgba(0,0,0,0.42), inset 0 -90px 120px rgba(0,255,136,0.1)",
      },
      default: {
        shadowColor: "#00ff88",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.12,
        shadowRadius: 18,
        elevation: 10,
      },
    }),
  },
  roastGridOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.2,
  },
  gridVLine: {
    position: "absolute",
    width: 1,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(0,255,136,0.1)",
  },
  gridHLine: {
    position: "absolute",
    height: 1,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,255,136,0.08)",
  },
  roastShareHeader: {
    marginBottom: 10,
    gap: 4,
  },
  roastShareLogo: {
    color: "#9cf6cf",
    fontSize: 14,
    fontWeight: "800",
  },
  roastCardTitle: {
    color: "#d4ffe9",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 4,
  },
  roastNameCity: {
    color: "#f7fff9",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 12,
  },
  roastCardText: {
    color: "#f3fff8",
    fontSize: 15,
    lineHeight: 24,
    fontWeight: "600",
    textAlign: "justify",
    paddingHorizontal: 16,
  },
  roastCardHeader: {
    color: "#f3fff8",
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "bold",
    textAlign: "justify",
    paddingHorizontal: 16,
  },
  roastParagraphSpacing: {
    marginBottom: 12,
  },
  roastBottomStrip: {
    marginTop: 16,
    borderRadius: 10,
    backgroundColor: "#00ff88",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  roastBottomStripText: {
    color: "#032113",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  aiSourceTag: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: "800",
  },
  aiSourceClaude: {
    color: "#00ff88",
  },
  aiSourceGroq: {
    color: "#60a5fa",
  },
  aiSourceOffline: {
    color: "#9ca3af",
  },
  shareButton: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#00ff88",
    backgroundColor: "#00ff88",
    paddingVertical: 16,
    alignItems: "center",
  },
  shareButtonText: {
    color: "#04170f",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
});

export default function Roast() {
  return (
    <ScreenErrorBoundary screenName="Roast">
      <RoastScreen />
    </ScreenErrorBoundary>
  );
}
