import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation } from "@react-navigation/native";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { EXPENSE_CATEGORIES as categories } from "../../constants/categories";
import { EXPENSE_NAME_HISTORY_KEY } from "../../constants/storage-keys";
import { addExpense, loadExpenses, parsePkrAmount, sumExpenses } from "../../storage/expenses";
import {
    getEffectiveMonthlyBudgetLimit,
    loadUserProfile,
} from "../../storage/userProfile";
import { getExpenseAdvice } from "../../utils/aiService";
import { cleanAIText } from "../../utils/aiText";

const MAX_EXPENSE_NAME_HISTORY = 200;
const MAX_EXPENSE_PKR = 9_999_999;
const MAX_EXPENSE_MESSAGE = "Maximum amount is PKR 99,99,999";

export default function AddExpenseScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [expenseName, setExpenseName] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Food");
  const [frequency, setFrequency] = useState<"one_time" | "monthly">("one_time");
  const [isSaving, setIsSaving] = useState(false);
  const [isAmountFocused, setIsAmountFocused] = useState(false);
  const [aiAdvice, setAiAdvice] = useState("");
  const [aiSource, setAiSource] = useState<"claude" | "groq" | "offline" | null>(
    null
  );
  const [successMessage, setSuccessMessage] = useState("");
  const [expenseNameHistory, setExpenseNameHistory] = useState<string[]>([]);
  const [isExpenseNameFocused, setIsExpenseNameFocused] = useState(false);
  const [amountCapNotice, setAmountCapNotice] = useState("");
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef(false);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)");
  };

  useFocusEffect(
    useCallback(() => {
      setAiAdvice("");
      setAiSource(null);
    }, [])
  );

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      try {
        const raw = await AsyncStorage.getItem(EXPENSE_NAME_HISTORY_KEY);
        if (!raw) {
          return;
        }

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          return;
        }

        const names = parsed
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean);

        if (!cancelled) {
          setExpenseNameHistory(names);
        }
      } catch {
        // Ignore corrupt storage; history is optional UX sugar.
      }
    };

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (!expenseName.trim() && !amount.trim()) {
        return;
      }
      e.preventDefault();
      Alert.alert("Discard changes?", "Your unsaved changes will be lost.", [
        { text: "Stay", style: "cancel", onPress: () => {} },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => navigation.dispatch(e.data.action),
        },
      ]);
    });
    return unsubscribe;
  }, [navigation, expenseName, amount]);

  const recordExpenseNameSubmission = useCallback(
    async (name: string, currentHistory: string[]) => {
      const trimmed = name.trim();
      if (!trimmed) {
        return;
      }

      const withoutDup = currentHistory.filter(
        (item) => item.toLowerCase() !== trimmed.toLowerCase()
      );
      const nextHistory = [trimmed, ...withoutDup].slice(
        0,
        MAX_EXPENSE_NAME_HISTORY
      );

      setExpenseNameHistory(nextHistory);

      try {
        await AsyncStorage.setItem(
          EXPENSE_NAME_HISTORY_KEY,
          JSON.stringify(nextHistory)
        );
      } catch {
        // If persistence fails, keep in-memory history for this session.
      }
    },
    []
  );

  const suggestionMatches = useMemo(() => {
    const query = expenseName.trim().toLowerCase();
    if (!query || !isExpenseNameFocused) {
      return [];
    }

    return expenseNameHistory
      .filter((item) => item.toLowerCase().includes(query))
      .slice(0, 8);
  }, [expenseName, expenseNameHistory, isExpenseNameFocused]);

  const handleAddExpense = async () => {
    if (saveInFlightRef.current || isSaving) {
      return;
    }

    const trimmedExpenseName = expenseName.trim();
    const trimmedAmount = amount.trim();

    if (!trimmedExpenseName) {
      setAiAdvice("Please enter expense name");
      setAiSource(null);
      return;
    }

    if (!trimmedAmount) {
      setAiAdvice("Amount must be greater than 0");
      setAiSource(null);
      return;
    }

    const parsedAmount = parsePkrAmount(trimmedAmount);
    if (parsedAmount === null || parsedAmount <= 0) {
      setAiAdvice("Amount must be greater than 0");
      setAiSource(null);
      return;
    }

    const cappedAmount =
      parsedAmount > MAX_EXPENSE_PKR ? MAX_EXPENSE_PKR : parsedAmount;
    if (parsedAmount > MAX_EXPENSE_PKR) {
      setAmountCapNotice(MAX_EXPENSE_MESSAGE);
    } else {
      setAmountCapNotice("");
    }

    saveInFlightRef.current = true;
    setIsSaving(true);
    setAiAdvice("");
    setAiSource(null);
    setSuccessMessage("");

    try {
      const historySnapshot = expenseNameHistory;
      const profile = await loadUserProfile();
      const result = await getExpenseAdvice(
        profile,
        expenseName,
        cappedAmount,
        selectedCategory,
        frequency,
        await loadExpenses()
      );
      const cleanedText = cleanAIText(result.text);

      if (profile) {
        const currentExpenses = await loadExpenses();
        const currentTotal = sumExpenses(currentExpenses);
        const budgetLimit = getEffectiveMonthlyBudgetLimit(profile);
        const projectedTotal = currentTotal + cappedAmount;
        if (projectedTotal > budgetLimit) {
          const confirmed = await new Promise<boolean>((resolve) => {
            Alert.alert(
              "Budget warning",
              "This expense will put you over your monthly budget. Add anyway?",
              [
                { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
                { text: "Add", style: "destructive", onPress: () => resolve(true) },
              ],
              { cancelable: true, onDismiss: () => resolve(false) }
            );
          });
          if (!confirmed) {
            setAiAdvice(cleanedText);
            setAiSource(result.source);
            return;
          }
        }
      }

      setAiAdvice(cleanedText);
      setAiSource(result.source);
      await recordExpenseNameSubmission(expenseName, historySnapshot);
      await addExpense({
        name: expenseName,
        amountRaw: String(Math.round(cappedAmount)),
        category: selectedCategory,
        frequency,
      });
      setSuccessMessage("✅ Expense added!");
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
      successTimeoutRef.current = setTimeout(() => {
        setSuccessMessage("");
      }, 2000);
      setExpenseName("");
      setAmount("");
      setAmountCapNotice("");
      setSelectedCategory("Food");
      setFrequency("one_time");
      setIsExpenseNameFocused(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not fetch AI advice right now. Please try again.";
      setAiAdvice(message);
      setAiSource(null);
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  };

  const isAddExpenseDisabled =
    isSaving || !expenseName.trim() || !amount.trim();

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" />
      <View style={styles.page}>
        <View style={styles.header}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleBack}
            style={styles.backNavButton}
          >
            <Text  style={styles.backNavButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text
            
            style={styles.headerTitle}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.65}
          >
            Add Expense
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <KeyboardAvoidingView
          style={[styles.keyboardFill, { paddingBottom: Math.max(12, insets.bottom) }]}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={
            Platform.OS === "ios" ? 12 : (StatusBar.currentHeight ?? 0) + 8
          }
        >
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
          <View style={styles.formCard}>
            <View style={styles.section}>
              <Text  style={styles.label}>Expense Name</Text>
              <View style={styles.autocompleteWrap}>
                <TextInput
                  value={expenseName}
                  onChangeText={setExpenseName}
                  maxLength={30}
                  placeholder="Netflix, Smoking, Bike Maintenance"
                  placeholderTextColor="#555"
                  style={styles.input}
                  onFocus={() => {
                    if (blurTimeoutRef.current) {
                      clearTimeout(blurTimeoutRef.current);
                      blurTimeoutRef.current = null;
                    }
                    setIsExpenseNameFocused(true);
                  }}
                  onBlur={() => {
                    if (blurTimeoutRef.current) {
                      clearTimeout(blurTimeoutRef.current);
                    }
                    blurTimeoutRef.current = setTimeout(() => {
                      setIsExpenseNameFocused(false);
                    }, 120);
                  }}
                />
                {expenseName.trim() ? (
                  <Text  style={styles.charCounter}>{expenseName.length}/30</Text>
                ) : null}

                {suggestionMatches.length > 0 ? (
                  <View style={styles.suggestionsDropdown} pointerEvents="box-none">
                    {suggestionMatches.map((item) => (
                      <Pressable
                        key={item}
                        onPressIn={() => {
                          if (blurTimeoutRef.current) {
                            clearTimeout(blurTimeoutRef.current);
                            blurTimeoutRef.current = null;
                          }
                        }}
                        onPress={() => {
                          setExpenseName(item);
                          setIsExpenseNameFocused(false);
                        }}
                        style={({ pressed }) => [
                          styles.suggestionRow,
                          pressed && styles.suggestionRowPressed,
                        ]}
                      >
                        <Text  style={styles.suggestionText}>{item}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.section}>
              <Text  style={styles.label}>Amount (PKR)</Text>
              <TextInput
                value={amount}
                onChangeText={(text) => {
                  setAmount(text);
                  if (amountCapNotice) {
                    setAmountCapNotice("");
                  }
                }}
                placeholder="5000"
                placeholderTextColor="#555"
                keyboardType="decimal-pad"
                onFocus={() => setIsAmountFocused(true)}
                onBlur={() => setIsAmountFocused(false)}
                style={[
                  styles.amountInput,
                  isAmountFocused && styles.amountInputFocused,
                ]}
              />
              {amountCapNotice ? (
                <Text  style={styles.fieldNotice}>{amountCapNotice}</Text>
              ) : null}
            </View>

            <View style={styles.section}>
              <Text  style={styles.label}>Category</Text>
              <View style={styles.categoryContainer}>
                {categories.map((category) => {
                  const selected = selectedCategory === category;
                  return (
                    <TouchableOpacity
                      key={category}
                      activeOpacity={0.85}
                      onPress={() => setSelectedCategory(category)}
                      style={[
                        styles.categoryChip,
                        selected && styles.categoryChipSelected,
                      ]}
                    >
                      <Text 
                        style={[
                          styles.categoryText,
                          selected && styles.categoryTextSelected,
                        ]}
                      >
                        {category}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            <View style={styles.section}>
              <Text  style={styles.label}>Frequency</Text>
              <View style={styles.frequencyRow}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => setFrequency("one_time")}
                  style={[styles.frequencyChip, frequency === "one_time" && styles.frequencyChipSelected]}
                >
                  <Text 
                    style={[
                      styles.frequencyChipText,
                      frequency === "one_time" && styles.frequencyChipTextSelected,
                    ]}
                  >
                    One Time
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => setFrequency("monthly")}
                  style={[styles.frequencyChip, frequency === "monthly" && styles.frequencyChipSelected]}
                >
                  <Text 
                    style={[
                      styles.frequencyChipText,
                      frequency === "monthly" && styles.frequencyChipTextSelected,
                    ]}
                  >
                    Monthly
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
          <TouchableOpacity
            activeOpacity={0.9}
            style={[
              styles.addButton,
              isSaving && styles.addButtonSaving,
              isAddExpenseDisabled && !isSaving && styles.addButtonDisabled,
            ]}
            onPress={handleAddExpense}
            disabled={isAddExpenseDisabled}
          >
            <Text  style={styles.addButtonText}>
              {isSaving ? "Adding..." : "Add Expense"}
            </Text>
          </TouchableOpacity>
          {successMessage ? <Text  style={styles.successText}>{successMessage}</Text> : null}

          {aiAdvice ? (
            <View style={styles.adviceCard}>
              <Text  style={styles.adviceTitle}>💡 PaisaWise says:</Text>
              {(() => {
                const sections = aiAdvice
                  .split(/\n{2,}/)
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0);
                return sections.map((section, idx) => {
                  const isVerdict = /^[✅⚠❌]\s*Verdict/u.test(section);
                  const isLast = idx === sections.length - 1;
                  return (
                    <Text
                      key={idx}
                      
                      style={[
                        isVerdict ? styles.adviceVerdict : styles.adviceText,
                        !isLast && styles.adviceSectionSpacing,
                      ]}
                    >
                      {section}
                    </Text>
                  );
                });
              })()}
              {aiSource ? (
                <Text 
                  style={[
                    styles.aiSourceTag,
                    aiSource === "claude"
                      ? styles.aiSourceClaude
                      : aiSource === "groq"
                      ? styles.aiSourceGroq
                      : styles.aiSourceOffline,
                  ]}
                >
                  {aiSource === "claude"
                    ? "⚡ Powered by Claude"
                    : aiSource === "groq"
                    ? "⚡ Powered by Groq"
                    : "Offline suggestion"}
                </Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
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
    marginBottom: 16,
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
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  headerSpacer: {
    width: 72,
  },
  content: {
    flexGrow: 1,
    paddingTop: 2,
    paddingBottom: 32,
    gap: 18,
  },
  formCard: {
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.12)",
    padding: 16,
    gap: 14,
  },
  section: {
    backgroundColor: "transparent",
  },
  label: {
    color: "#d1d5db",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 10,
  },
  charCounter: {
    color: "#6b7280",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
    marginBottom: 2,
    textAlign: "right",
  },
  fieldNotice: {
    color: "#f59e0b",
    fontSize: 13,
    fontWeight: "700",
    marginTop: -4,
    marginBottom: 4,
  },
  input: {
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.2)",
    borderRadius: 12,
    color: "#fff",
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  amountInput: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderBottomWidth: 1.5,
    borderBottomColor: "#2a2a2a",
    borderRadius: 0,
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    paddingHorizontal: 4,
    paddingVertical: 12,
  },
  amountInputFocused: {
    borderBottomColor: "#00ff88",
  },
  autocompleteWrap: {
    position: "relative",
    zIndex: 20,
  },
  suggestionsDropdown: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "100%",
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1f2a24",
    backgroundColor: "#0b120f",
    overflow: "hidden",
    ...Platform.select({
      web: {
        boxShadow: "0 10px 24px rgba(0, 255, 136, 0.14)",
      },
      default: {
        shadowColor: "#00ff88",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
        elevation: 12,
      },
    }),
  },
  suggestionRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#132018",
  },
  suggestionRowPressed: {
    backgroundColor: "#0f1b16",
  },
  suggestionText: {
    color: "#e5e7eb",
    fontSize: 15,
    fontWeight: "600",
  },
  categoryContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  categoryChip: {
    width: "48%",
    borderRadius: 12,
    borderWidth: 0,
    backgroundColor: "transparent",
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  categoryChipSelected: {
    backgroundColor: "#00ff88",
  },
  categoryText: {
    color: "#9ca3af",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  categoryTextSelected: {
    color: "#04170f",
    fontWeight: "800",
  },
  frequencyRow: {
    flexDirection: "row",
    gap: 8,
  },
  frequencyChip: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.2)",
    backgroundColor: "#1a1a1a",
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  frequencyChipSelected: {
    borderColor: "#00ff88",
    backgroundColor: "#00ff88",
  },
  frequencyChipText: {
    color: "#9ca3af",
    fontSize: 14,
    fontWeight: "700",
  },
  frequencyChipTextSelected: {
    color: "#04170f",
    fontWeight: "900",
  },
  addButton: {
    marginTop: 14,
    borderRadius: 18,
    backgroundColor: "#00ff88",
    paddingVertical: 18,
    alignItems: "center",
    ...Platform.select({
      web: {
        boxShadow: "0 6px 20px rgba(0, 255, 136, 0.28)",
      },
      default: {
        shadowColor: "#00ff88",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 14,
        elevation: 8,
      },
    }),
  },
  addButtonDisabled: {
    opacity: 0.75,
  },
  addButtonSaving: {
    opacity: 0.55,
  },
  addButtonText: {
    color: "#04170f",
    fontSize: 17,
    fontWeight: "900",
  },
  successText: {
    marginTop: 10,
    color: "#00ff88",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },
  adviceCard: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.12)",
    borderLeftWidth: 4,
    borderLeftColor: "#00ff88",
    backgroundColor: "#1a1a1a",
    padding: 20,
  },
  adviceTitle: {
    color: "#00ff88",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 8,
  },
  adviceText: {
    color: "#e5e7eb",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500",
    textAlign: "justify",
    paddingHorizontal: 16,
  },
  adviceVerdict: {
    color: "#e5e7eb",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "bold",
    textAlign: "justify",
    paddingHorizontal: 16,
  },
  adviceSectionSpacing: {
    marginBottom: 8,
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
});
