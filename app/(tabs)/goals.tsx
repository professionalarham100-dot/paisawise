import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useFocusEffect, useRouter } from "expo-router";
import { doc, setDoc } from "firebase/firestore";
import { useCallback, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import ScreenErrorBoundary from "../../components/ScreenErrorBoundary";
import { GOALS_STORAGE_KEY } from "../../constants/storage-keys";
import { auth, db } from "../../lib/firebase";
import { formatPKR, parsePkrAmount } from "../../utils/currency";
import { clamp } from "../../utils/math";

type SavingGoal = {
  id: string;
  createdAt: number;
  name: string;
  targetAmount: number;
  deadlineMonth: string;
  savedAmount: number;
  achieved: boolean;
};

const createId = () => {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

const parseDeadlineMonth = (value: string): Date | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = new Date(`1 ${trimmed}`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

const formatDeadlineMonth = (value: Date): string => {
  return value.toLocaleDateString("en-PK", { month: "short", year: "numeric" });
};

const syncGoalsToFirestore = async (goals: SavingGoal[]) => {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    return;
  }

  try {
    await setDoc(doc(db, "users", uid, "data", "goals"), { list: goals });
  } catch {
    // Best-effort cloud sync.
  }
};

const saveGoals = async (goals: SavingGoal[]) => {
  await AsyncStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(goals));
  await syncGoalsToFirestore(goals);
};

const loadGoals = async (): Promise<SavingGoal[]> => {
  const raw = await AsyncStorage.getItem(GOALS_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw) as unknown;
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

  const needsCreatedAtMigration = goals.some((goal) => goal.createdAt <= 0);
  if (needsCreatedAtMigration) {
    const now = Date.now();
    for (let index = 0; index < goals.length; index += 1) {
      const goal = goals[index];
      if (goal && goal.createdAt <= 0) {
        goal.createdAt = now - index;
      }
    }

    try {
      await saveGoals(goals);
    } catch {
      // If persistence fails, still return goals in memory order.
    }
  }

  return goals.sort((a, b) => b.createdAt - a.createdAt);
};

function GoalsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [goals, setGoals] = useState<SavingGoal[]>([]);

  const [goalName, setGoalName] = useState("");
  const [targetRaw, setTargetRaw] = useState("");
  const [deadlineMonth, setDeadlineMonth] = useState("");
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);
  const [deadlineDraftDate, setDeadlineDraftDate] = useState(new Date());
  const [formError, setFormError] = useState("");

  const [moneyDraftById, setMoneyDraftById] = useState<Record<string, string>>({});
  const [addingForId, setAddingForId] = useState<string | null>(null);
  const [moneyErrorById, setMoneyErrorById] = useState<Record<string, string>>({});
  const [refreshError, setRefreshError] = useState("");
  const [isSubmittingGoal, setIsSubmittingGoal] = useState(false);
  const [goalOpLoadingId, setGoalOpLoadingId] = useState<string | null>(null);

  const refreshGoals = useCallback(async () => {
    setRefreshError("");
    try {
      const next = await loadGoals();
      setGoals(next);
    } catch (error) {
      console.log("refreshGoals failed:", error);
      setRefreshError("Could not load goals. Pull to retry.");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshGoals();
    }, [refreshGoals])
  );

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace("/(tabs)");
  };

  const openDeadlinePicker = () => {
    const parsed = parseDeadlineMonth(deadlineMonth);
    setDeadlineDraftDate(parsed ?? new Date());
    setShowDeadlinePicker(true);
  };

  const tryApplyDeadlineDate = (date: Date): boolean => {
    const now = new Date();
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const selectedMonthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    if (selectedMonthStart < nextMonthStart) {
      setFormError("Please select a future month for your deadline.");
      return false;
    }
    setDeadlineMonth(formatDeadlineMonth(date));
    setFormError("");
    return true;
  };

  const confirmDeadlinePicker = () => {
    if (!tryApplyDeadlineDate(deadlineDraftDate)) {
      return;
    }
    setShowDeadlinePicker(false);
  };

  const handleAddGoal = async () => {
    if (isSubmittingGoal) {
      return;
    }
    setFormError("");

    const name = goalName.trim();

    if (!name) {
      setFormError("Please enter goal name");
      return;
    }

    const trimmedTarget = targetRaw.trim();
    if (!trimmedTarget) {
      setFormError("Goal amount must be greater than 0");
      return;
    }

    const target = parsePkrAmount(targetRaw);
    if (target === null) {
      setFormError("Goal amount must be greater than 0");
      return;
    }
    const deadlineDate = parseDeadlineMonth(deadlineMonth);
    if (deadlineDate) {
      const now = new Date();
      const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      if (deadlineDate < nextMonthStart) {
        setFormError("Please select a future month for your deadline.");
        return;
      }
    }

    const nextGoal: SavingGoal = {
      id: createId(),
      createdAt: Date.now(),
      name,
      targetAmount: target,
      deadlineMonth: deadlineMonth.trim(),
      savedAmount: 0,
      achieved: false,
    };

    const next = [nextGoal, ...goals];
    setGoals(next);
    setIsSubmittingGoal(true);
    try {
      await saveGoals(next);
      setGoalName("");
      setTargetRaw("");
      setDeadlineMonth("");
    } catch (error) {
      console.log("add goal failed:", error);
      setFormError("Could not save this goal. Try again.");
    } finally {
      setIsSubmittingGoal(false);
    }
  };

  const setMoneyDraft = (id: string, text: string) => {
    setMoneyDraftById((prev) => ({ ...prev, [id]: text }));
    setMoneyErrorById((prev) => {
      if (!prev[id]) {
        return prev;
      }
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const confirmDeleteGoal = (goal: SavingGoal) => {
    const runDelete = async () => {
      setGoalOpLoadingId(goal.id);
      const next = goals.filter((g) => g.id !== goal.id);
      setGoals(next);
      try {
        await saveGoals(next);
        setAddingForId((prev) => (prev === goal.id ? null : prev));
        setMoneyDraftById((prev) => {
          const copy = { ...prev };
          delete copy[goal.id];
          return copy;
        });
        setMoneyErrorById((prev) => {
          const copy = { ...prev };
          delete copy[goal.id];
          return copy;
        });
      } catch (error) {
        console.log("delete goal failed:", error);
        setFormError("Could not delete goal. Try again.");
        setGoals(goals);
      } finally {
        setGoalOpLoadingId(null);
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm("Delete this goal?")) {
        void runDelete();
      }
      return;
    }

    Alert.alert("Delete this goal?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void runDelete();
        },
      },
    ]);
  };

  const applyMoney = async (goal: SavingGoal) => {
    if (goal.achieved || goalOpLoadingId === goal.id) {
      return;
    }

    const draft = moneyDraftById[goal.id] ?? "";
    const add = parsePkrAmount(draft);
    if (!add) {
      setMoneyErrorById((prev) => ({
        ...prev,
        [goal.id]: "Enter a valid PKR amount.",
      }));
      return;
    }
    const remaining = Math.max(0, goal.targetAmount - goal.savedAmount);
    if (add > remaining) {
      setMoneyErrorById((prev) => ({
        ...prev,
        [goal.id]: `Amount exceeds remaining goal target of ${formatPKR(remaining)}`,
      }));
      return;
    }

    const nextSaved = clamp(goal.savedAmount + add, 0, goal.targetAmount);
    const achieved = nextSaved >= goal.targetAmount;

    const nextGoals = goals.map((g) =>
      g.id === goal.id
        ? {
            ...g,
            savedAmount: nextSaved,
            achieved: achieved || g.achieved,
          }
        : g
    );

    setGoals(nextGoals);
    setGoalOpLoadingId(goal.id);
    try {
      await saveGoals(nextGoals);
      setMoneyDraftById((prev) => ({ ...prev, [goal.id]: "" }));
      setAddingForId(null);
      setMoneyErrorById((prev) => {
        const copy = { ...prev };
        delete copy[goal.id];
        return copy;
      });
    } catch (error) {
      console.log("apply goal money failed:", error);
      setMoneyErrorById((prev) => ({ ...prev, [goal.id]: "Could not save. Try again." }));
      setGoals(goals);
    } finally {
      setGoalOpLoadingId(null);
    }
  };

  const sortedGoals = useMemo(() => goals, [goals]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" />
      <View style={styles.page}>
        <View style={styles.header}>
          <TouchableOpacity activeOpacity={0.85} onPress={handleBack} style={styles.backNavButton}>
            <Text  style={styles.backNavButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text
            
            style={styles.headerTitle}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.65}
          >
            Saving Goals 🎯
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <KeyboardAvoidingView
          style={[styles.keyboardFill, { paddingBottom: Math.max(12, insets.bottom) }]}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={
            Platform.OS === "ios" ? 8 : (StatusBar.currentHeight ?? 0) + 8
          }
        >
        <FlatList
          data={sortedGoals}
          keyExtractor={(goal) => goal.id}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={false}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <>
              {refreshError ? <Text  style={styles.errorText}>{refreshError}</Text> : null}
          <View style={styles.section}>
            <Text  style={styles.sectionTitle}>New goal</Text>

            <Text  style={styles.label}>Goal name</Text>
            <TextInput
              value={goalName}
              onChangeText={setGoalName}
              maxLength={30}
              placeholder="New Laptop"
              placeholderTextColor="#6b7280"
              style={styles.input}
            />
            {goalName.trim() ? (
              <Text  style={styles.charCounter}>{goalName.length}/30</Text>
            ) : null}

            <Text  style={styles.label}>Target amount (PKR)</Text>
            <TextInput
              value={targetRaw}
              onChangeText={setTargetRaw}
              placeholder="150000"
              placeholderTextColor="#6b7280"
              keyboardType="decimal-pad"
              style={styles.input}
            />

            <Text  style={styles.label}>Deadline month (optional)</Text>
            <Pressable style={styles.deadlinePressable} onPress={openDeadlinePicker}>
              <Text  style={styles.deadlinePressableText}>
                {deadlineMonth || "Select deadline month"}
              </Text>
            </Pressable>

            {formError ? <Text  style={styles.errorText}>{formError}</Text> : null}

            <TouchableOpacity
              activeOpacity={0.9}
              style={[styles.primaryButton, isSubmittingGoal && styles.disabledButton]}
              onPress={handleAddGoal}
              disabled={isSubmittingGoal}
            >
              {isSubmittingGoal ? (
                <ActivityIndicator color="#04170f" />
              ) : (
                <Text  style={styles.primaryButtonText}>Add Goal</Text>
              )}
            </TouchableOpacity>
          </View>

          <Text  style={styles.listTitle}>Your goals</Text>
            </>
          }
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text  style={styles.emptyTitle}>No goals yet</Text>
              <Text  style={styles.emptySubtitle}>
                Add your first saving goal above — PaisaWise will track your progress.
              </Text>
            </View>
          }
          renderItem={({ item: goal }) => {
            const percent = clamp((goal.savedAmount / goal.targetAmount) * 100, 0, 100);
            const isAdding = addingForId === goal.id;
            const isBusy = goalOpLoadingId === goal.id;
            const deadlineDate = goal.deadlineMonth
              ? parseDeadlineMonth(goal.deadlineMonth)
              : null;
            const isOverdue =
              !goal.achieved &&
              deadlineDate != null &&
              deadlineDate.getTime() < Date.now();
            const goalAccentColor = isOverdue
              ? "#ff4d4d"
              : percent >= 50
                ? "#00ff88"
                : "#ff9900";
            return (
              <View
                style={[
                  styles.goalCard,
                  { borderLeftWidth: 4, borderLeftColor: goalAccentColor },
                ]}
              >
                <TouchableOpacity
                  accessibilityLabel="Delete goal"
                  activeOpacity={0.85}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => confirmDeleteGoal(goal)}
                  disabled={isBusy}
                  style={styles.goalDeleteCorner}
                >
                  {isBusy ? <ActivityIndicator color="#ff6b6b" size="small" /> : <Text  style={styles.goalDeleteCornerText}>✕</Text>}
                </TouchableOpacity>

                <View style={styles.goalTopRow}>
                  <View style={styles.goalTitleBlock}>
                    <Text
                      
                      style={styles.goalName}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.65}
                    >
                      {goal.name}
                    </Text>
                    <Text
                      
                      style={styles.goalTarget}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.65}
                    >
                      {formatPKR(goal.targetAmount)}
                    </Text>
                  </View>
                  <View style={styles.goalRing}>
                    <View
                      style={[
                        styles.goalRingFill,
                        { borderColor: percent >= 100 ? "#00ff88" : "rgba(0,255,136,0.45)" },
                      ]}
                    >
                      <Text  style={styles.goalRingText}>{percent.toFixed(0)}%</Text>
                    </View>
                  </View>
                </View>

                {goal.deadlineMonth ? (
                  <Text  style={styles.goalDeadline}>Deadline: {goal.deadlineMonth}</Text>
                ) : null}

                <View style={styles.goalMetaRow}>
                  <Text  style={styles.goalSavedLabel}>Saved</Text>
                  <Text
                    
                    style={styles.goalSavedValue}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.65}
                  >
                    {formatPKR(goal.savedAmount)}
                  </Text>
                </View>

                {goal.achieved ? (
                  <View style={styles.celebration}>
                    <Text  style={styles.celebrationText}>Goal Achieved! 🎉</Text>
                  </View>
                ) : (
                  <View style={styles.actions}>
                    <TouchableOpacity
                      activeOpacity={0.9}
                      style={styles.secondaryButton}
                      disabled={isBusy}
                      onPress={() => {
                        setAddingForId((prev) => (prev === goal.id ? null : goal.id));
                        setMoneyErrorById((prev) => {
                          const copy = { ...prev };
                          delete copy[goal.id];
                          return copy;
                        });
                      }}
                    >
                      <Text  style={styles.secondaryButtonText}>
                        {isAdding ? "Close" : "+ Add Money"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                {isAdding && !goal.achieved ? (
                  <View style={styles.addMoneyBox}>
                    <Text  style={styles.addMoneyLabel}>Amount to add (PKR)</Text>
                    <TextInput
                      value={moneyDraftById[goal.id] ?? ""}
                      onChangeText={(text) => setMoneyDraft(goal.id, text)}
                      placeholder="5000"
                      placeholderTextColor="#6b7280"
                      keyboardType="decimal-pad"
                      style={styles.addMoneyInput}
                    />
                    {moneyErrorById[goal.id] ? (
                      <Text  style={styles.errorText}>{moneyErrorById[goal.id]}</Text>
                    ) : null}
                    <TouchableOpacity
                      activeOpacity={0.9}
                      style={[styles.primaryButton, isBusy && styles.disabledButton]}
                      disabled={isBusy}
                      onPress={() => applyMoney(goal)}
                    >
                      {isBusy ? <ActivityIndicator color="#04170f" /> : <Text  style={styles.primaryButtonText}>Apply</Text>}
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            );
          }}
        />
        {Platform.OS === "ios" ? (
          <Modal
            visible={showDeadlinePicker}
            transparent
            animationType="fade"
            onRequestClose={() => setShowDeadlinePicker(false)}
          >
            <View style={styles.pickerOverlay}>
              <View style={styles.pickerSheet}>
                <DateTimePicker
                  value={deadlineDraftDate}
                  mode="date"
                  display="spinner"
                  minimumDate={new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)}
                  onChange={(_, date) => {
                    if (date) {
                      setDeadlineDraftDate(date);
                    }
                  }}
                />
                <View style={styles.pickerActions}>
                  <Pressable
                    onPress={() => setShowDeadlinePicker(false)}
                    style={[styles.pickerActionButton, styles.pickerCancelButton]}
                  >
                    <Text  style={styles.pickerCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={confirmDeadlinePicker}
                    style={[styles.pickerActionButton, styles.pickerConfirmButton]}
                  >
                    <Text  style={styles.pickerConfirmText}>Confirm ✓</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        ) : showDeadlinePicker ? (
          <DateTimePicker
            value={deadlineDraftDate}
            mode="date"
            display="default"
            minimumDate={new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)}
            onChange={(event, date) => {
              setShowDeadlinePicker(false);
              if (event.type === "set" && date) {
                setDeadlineDraftDate(date);
                tryApplyDeadlineDate(date);
              }
            }}
          />
        ) : null}
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#111111",
  },
  page: {
    flex: 1,
    backgroundColor: "#111111",
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  keyboardFill: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
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
  headerTitle: {
    flex: 1,
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  headerSpacer: {
    width: 72,
  },
  content: {
    gap: 14,
    paddingBottom: 28,
  },
  section: {
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.12)",
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
  sectionTitle: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 12,
  },
  label: {
    color: "#d1d5db",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 8,
  },
  charCounter: {
    color: "#6b7280",
    fontSize: 12,
    fontWeight: "700",
    marginTop: -2,
    marginBottom: 10,
    textAlign: "right",
  },
  addMoneyInput: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderBottomWidth: 1.5,
    borderBottomColor: "#2a2a2a",
    borderRadius: 0,
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    paddingHorizontal: 4,
    paddingVertical: 10,
    marginBottom: 4,
  },
  input: {
    backgroundColor: "#0d0d0d",
    borderWidth: 1,
    borderColor: "#272727",
    borderRadius: 14,
    color: "#f8fafc",
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  deadlinePressable: {
    backgroundColor: "#0d0d0d",
    borderWidth: 1,
    borderColor: "#272727",
    borderRadius: 14,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  deadlinePressableText: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "600",
  },
  errorText: {
    color: "#ff6b6b",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 10,
  },
  primaryButton: {
    borderRadius: 16,
    backgroundColor: "#00ff88",
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#33ffa3",
  },
  disabledButton: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: "#04170f",
    fontSize: 16,
    fontWeight: "900",
  },
  listTitle: {
    color: "#e5e7eb",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 4,
  },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1f2a24",
    backgroundColor: "#1a1a1a",
    padding: 16,
  },
  emptyTitle: {
    color: "#e5e7eb",
    fontSize: 16,
    fontWeight: "900",
  },
  emptySubtitle: {
    color: "#9ca3af",
    fontSize: 14,
    marginTop: 6,
    lineHeight: 20,
    fontWeight: "600",
  },
  goalCard: {
    position: "relative",
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    padding: 16,
    paddingTop: 18,
  },
  goalDeleteCorner: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 2,
    minWidth: 32,
    minHeight: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 77, 77, 0.45)",
    backgroundColor: "#1a0a0a",
    alignItems: "center",
    justifyContent: "center",
  },
  goalDeleteCornerText: {
    color: "#ff6b6b",
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 18,
  },
  goalTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingRight: 36,
  },
  goalTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  goalName: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  goalTarget: {
    color: "#9ca3af",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
  },
  goalRing: {
    width: 64,
    height: 64,
    borderRadius: 999,
    backgroundColor: "#0f0f0f",
    alignItems: "center",
    justifyContent: "center",
  },
  goalRingFill: {
    width: 56,
    height: 56,
    borderRadius: 999,
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  goalRingText: {
    color: "#f8fafc",
    fontSize: 12,
    fontWeight: "900",
  },
  goalDeadline: {
    color: "#9ca3af",
    fontSize: 13,
    marginTop: 8,
    fontWeight: "700",
  },
  goalMetaRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  goalSavedLabel: {
    color: "#9ca3af",
    fontSize: 13,
    fontWeight: "700",
    flex: 1,
    minWidth: 0,
    marginRight: 10,
  },
  goalSavedValue: {
    color: "#9ca3af",
    fontSize: 13,
    fontWeight: "700",
    flexShrink: 0,
    textAlign: "right",
    maxWidth: "55%",
  },
  progressTrack: { display: "none" },
  progressFill: { display: "none" },
  progressPercent: { display: "none" },
  actions: {
    marginTop: 14,
  },
  secondaryButton: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#00ff88",
    backgroundColor: "transparent",
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#00ff88",
    fontSize: 13,
    fontWeight: "800",
  },
  addMoneyBox: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#1a1a1a",
    gap: 8,
  },
  addMoneyLabel: {
    color: "#d1d5db",
    fontSize: 13,
    fontWeight: "800",
  },
  celebration: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1f2a24",
    backgroundColor: "#0f1b16",
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  celebrationText: {
    color: "#00ff88",
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
    paddingBottom: Platform.OS === "android" ? 24 : 12,
  },
  pickerSheet: {
    backgroundColor: "#1a1a1a",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 10,
    paddingBottom: 18,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,255,136,0.2)",
  },
  pickerActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  pickerActionButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  pickerCancelButton: {
    backgroundColor: "#242424",
    borderColor: "#383838",
  },
  pickerConfirmButton: {
    backgroundColor: "#00ff88",
    borderColor: "#33ffa3",
  },
  pickerCancelText: {
    color: "#d1d5db",
    fontSize: 15,
    fontWeight: "800",
  },
  pickerConfirmText: {
    color: "#04170f",
    fontSize: 15,
    fontWeight: "900",
  },
});

export default function Goals() {
  return (
    <ScreenErrorBoundary screenName="Goals">
      <GoalsScreen />
    </ScreenErrorBoundary>
  );
}
