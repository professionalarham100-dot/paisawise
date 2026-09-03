import * as Print from "expo-print";
import { useFocusEffect, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Platform,
    Pressable,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import ScreenErrorBoundary from "../../components/ScreenErrorBoundary";
import { Expense, loadExpenses, sumExpenses } from "../../storage/expenses";
import {
    formatGenderLabel,
    getAgeFromDob,
    loadUserProfile,
    type UserProfile,
} from "../../storage/userProfile";
import { getMonthlyAnalysis } from "../../utils/aiService";
import { cleanAIText } from "../../utils/aiText";
import { getCategoryColor } from "../../utils/categoryColors";
import { formatPKR } from "../../utils/currency";

const DEFAULT_MONTHLY_INCOME = 250000;

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

const monthKeyFromExpense = (expense: Expense): string | null => {
  const d = new Date(expense.date);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};

const formatMonthLabel = (key: string) => {
  const [y, m] = key.split("-").map((v) => Number.parseInt(v, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m)) {
    return key;
  }
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("en-PK", {
    month: "long",
    year: "numeric",
  });
};

const formatExpenseDateFull = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "—";
  }
  return d.toLocaleDateString("en-PK", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const escapeHtml = (raw: string) => {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const barColorForPercent = (pct: number) => {
  if (pct < 50) {
    return "#00ff88";
  }
  if (pct <= 80) {
    return "#f5c400";
  }
  return "#ff4d4d";
};

type MonthGroup = {
  key: string;
  label: string;
  expenses: Expense[];
  total: number;
};

const buildMonthGroups = (expenses: Expense[]): MonthGroup[] => {
  const map = new Map<string, Expense[]>();
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  for (const expense of expenses) {
    const key = monthKeyFromExpense(expense);
    if (!key) {
      continue;
    }
    // History excludes the current month; current month is shown on home.
    if (key >= currentMonthKey) {
      continue;
    }
    const list = map.get(key) ?? [];
    list.push(expense);
    map.set(key, list);
  }

  const keys = [...map.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  return keys.map((key) => {
    const list = map.get(key) ?? [];
    list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return {
      key,
      label: formatMonthLabel(key),
      expenses: list,
      total: sumExpenses(list),
    };
  });
};

const buildMonthlyReportHtml = (
  monthLabel: string,
  group: MonthGroup,
  monthlyIncome: number,
  analysis: string,
  profile: UserProfile | null
) => {
  const name = escapeHtml(profile?.fullName?.trim() || "User");
  const derivedAge = profile ? getAgeFromDob(profile.dob) ?? profile.age : null;
  const age = derivedAge != null && Number.isFinite(derivedAge) ? escapeHtml(String(derivedAge)) : "—";
  const gender = escapeHtml(profile ? formatGenderLabel(profile.gender) : "—");
  const city = escapeHtml(profile?.city?.trim() || "—");
  const incomeStr = escapeHtml(formatPKR(monthlyIncome));
  const totalStr = escapeHtml(formatPKR(group.total));
  const analysisHtml = escapeHtml(analysis).replace(/\n/g, "<br/>");

  const rows = group.expenses
    .map(
      (e) =>
        `<tr><td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.category)}</td><td>${escapeHtml(
          formatPKR(e.amount)
        )}</td><td>${escapeHtml(formatExpenseDateFull(e.date))}</td></tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>PaisaWise — ${escapeHtml(monthLabel)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 24px; background: #f4f4f5; color: #111; }
    .sheet { max-width: 720px; margin: 0 auto; background: #fff; padding: 28px 32px; border-radius: 12px; border: 1px solid #e4e4e7; }
    .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .brand-mark { font-size: 28px; }
    .brand-name { font-size: 26px; font-weight: 800; color: #00a866; letter-spacing: 0.02em; }
    .tag { font-size: 12px; color: #71717a; margin-bottom: 20px; }
    h1 { font-size: 20px; margin: 0 0 16px; color: #18181b; }
    .meta { font-size: 13px; line-height: 1.6; color: #3f3f46; margin-bottom: 20px; }
    .meta strong { color: #18181b; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 24px; }
    th, td { border: 1px solid #d4d4d8; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #f4f4f5; font-weight: 700; }
    .section-title { font-size: 14px; font-weight: 800; margin: 20px 0 8px; color: #18181b; }
    .analysis { font-size: 12px; line-height: 1.55; color: #27272a; white-space: normal; }
    @media print {
      body { background: #fff; padding: 0; }
      .sheet { border: none; border-radius: 0; max-width: none; padding: 16px 20px; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="brand"><span class="brand-mark">💰</span><span class="brand-name">PaisaWise</span></div>
    <div class="tag">Monthly spending report</div>
    <h1>${escapeHtml(monthLabel)}</h1>
    <div class="meta">
      <strong>User:</strong> ${name} &nbsp;|&nbsp; <strong>Age:</strong> ${age} &nbsp;|&nbsp;
      <strong>Gender:</strong> ${gender} &nbsp;|&nbsp; <strong>City:</strong> ${city}<br/>
      <strong>Monthly income:</strong> ${incomeStr} &nbsp;|&nbsp; <strong>Total spent:</strong> ${totalStr}
    </div>
    <table>
      <thead><tr><th>Expense</th><th>Category</th><th>Amount</th><th>Date</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="section-title">🤖 AI Analysis</div>
    <div class="analysis">${analysisHtml}</div>
  </div>
</body>
</html>`;

};

function HistoryScreen() {
  const router = useRouter();
  const [groups, setGroups] = useState<MonthGroup[]>([]);
  const [monthlyIncome, setMonthlyIncome] = useState(DEFAULT_MONTHLY_INCOME);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [refreshError, setRefreshError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [analysisByMonth, setAnalysisByMonth] = useState<Record<string, string>>({});
  const [analysisSourceByMonth, setAnalysisSourceByMonth] = useState<
    Record<string, "claude" | "groq" | "offline">
  >({});
  const [analysisLoadingKey, setAnalysisLoadingKey] = useState<string | null>(null);
  const [analysisErrorByMonth, setAnalysisErrorByMonth] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setRefreshError("");
    try {
      const [expenseList, loadedProfile] = await Promise.all([
        loadExpenses(),
        loadUserProfile(),
      ]);

      setGroups(buildMonthGroups(expenseList));
      setProfile(loadedProfile);
      setMonthlyIncome(loadedProfile?.monthlySalary ?? DEFAULT_MONTHLY_INCOME);
    } catch (error) {
      console.log("history refresh failed:", error);
      setRefreshError("Could not load history. Pull to retry.");
    } finally {
      setIsInitialLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)");
  };

  const toggleMonth = (key: string) => {
    setExpanded((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const incomeForBar = useMemo(() => {
    return Math.max(monthlyIncome, 1);
  }, [monthlyIncome]);

  const runMonthlyAnalysis = async (group: MonthGroup) => {
    if (analysisLoadingKey) {
      return;
    }

    setAnalysisLoadingKey(group.key);
    setAnalysisErrorByMonth((prev) => {
      const next = { ...prev };
      delete next[group.key];
      return next;
    });

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
      const result = await getMonthlyAnalysis(
        effectiveProfile,
        group.expenses,
        group.label
      );
      const aiText = cleanAIText(result.text);

      if (!aiText) {
        throw new Error("No analysis text received.");
      }

      setAnalysisByMonth((prev) => ({ ...prev, [group.key]: aiText }));
      setAnalysisSourceByMonth((prev) => ({ ...prev, [group.key]: result.source }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not generate analysis. Try again.";
      setAnalysisErrorByMonth((prev) => ({ ...prev, [group.key]: message }));
    } finally {
      setAnalysisLoadingKey(null);
    }
  };

  const handleDownloadPdf = async (group: MonthGroup) => {
    const analysis = analysisByMonth[group.key];
    if (!analysis) {
      return;
    }
    try {
      const html = buildMonthlyReportHtml(group.label, group, monthlyIncome, analysis, profile);
      const file = await Print.printToFileAsync({ html, base64: false });
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert("Sharing unavailable", "PDF sharing is not available on this device.");
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: "application/pdf",
        dialogTitle: `Save ${group.label} report`,
        UTI: "com.adobe.pdf",
      });
    } catch {
      Alert.alert("Could not create PDF", "Please try again.");
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" />
      <View style={styles.page}>
        <View style={styles.screenHeader}>
          <View style={styles.navRow}>
            <TouchableOpacity activeOpacity={0.85} onPress={handleBack} style={styles.backNavButton} hitSlop={8}>
              <Text  style={styles.backNavButtonText}>← Back</Text>
            </TouchableOpacity>
            <Text
              
              style={styles.headerTitle}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.65}
            >
              Monthly History 📅
            </Text>
            <View style={styles.headerSpacer} />
          </View>
          <Text
            
            style={styles.headerSubtitle}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.65}
          >
            Spending by month vs your monthly income
          </Text>
        </View>

        <FlatList
        data={groups}
        keyExtractor={(group) => group.key}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        ListHeaderComponent={
          <>
            {isInitialLoading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color="#00ff88" />
                <Text  style={styles.loadingText}>Loading history...</Text>
              </View>
            ) : null}
            {refreshError ? <Text  style={styles.refreshError}>{refreshError}</Text> : null}
          </>
        }
        ListEmptyComponent={
          !isInitialLoading ? (
            <View style={styles.emptyCard}>
              <Text  style={styles.emptyTitle}>No history yet</Text>
              <Text  style={styles.emptySubtitle}>
                Add expenses from the home screen — they will appear here grouped by month.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item: group }) => {
            const isOpen = Boolean(expanded[group.key]);
            const pct = Math.min(100, (group.total / incomeForBar) * 100);
            const barColor = barColorForPercent(pct);
            const isLoadingThis = analysisLoadingKey === group.key;
            const analysis = analysisByMonth[group.key];
            const analysisSource = analysisSourceByMonth[group.key];
            const analysisError = analysisErrorByMonth[group.key];

            return (
              <View key={group.key}>
                <View
                  style={[
                    styles.monthCard,
                    pct > 100 ? styles.monthCardOverBudget : styles.monthCardUnderBudget,
                  ]}
                >
                  <Pressable
                    onPress={() => toggleMonth(group.key)}
                    style={({ pressed }) => [
                      styles.monthHeader,
                      pressed && styles.monthHeaderPressed,
                    ]}
                  >
                    <View style={styles.monthHeaderLeft}>
                      <Text  style={styles.chevron}>{isOpen ? "▼" : "▶"}</Text>
                      <Text
                        
                        style={styles.monthTitle}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.65}
                      >
                        {group.label}
                      </Text>
                    </View>
                    <Text
                      
                      style={styles.monthTotal}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.65}
                    >
                      {formatPKR(group.total)}
                    </Text>
                  </Pressable>

                  <View style={styles.barSection}>
                    <View style={styles.barLabels}>
                      <Text  style={styles.barHint}>of monthly income</Text>
                      <Text  style={styles.barPct}>{pct.toFixed(0)}%</Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            width: `${Math.max(pct, group.total > 0 ? 2 : 0)}%`,
                            backgroundColor: barColor,
                          },
                        ]}
                      />
                    </View>
                  </View>

                  <TouchableOpacity
                    activeOpacity={0.88}
                    style={[styles.reportButton, isLoadingThis && styles.reportButtonDisabled]}
                    onPress={() => {
                      void runMonthlyAnalysis(group);
                    }}
                    disabled={Boolean(analysisLoadingKey)}
                  >
                    {isLoadingThis ? (
                      <View style={styles.reportButtonInner}>
                        <ActivityIndicator color="#00ff88" size="small" />
                        <Text  style={styles.reportButtonText}>Analyzing…</Text>
                      </View>
                    ) : (
                      <Text  style={styles.reportButtonText}>Generate Report 📄</Text>
                    )}
                  </TouchableOpacity>

                  {analysisError ? (
                    <Text  style={styles.analysisError}>{analysisError}</Text>
                  ) : null}

                  {isOpen ? (
                    <FlatList
                      data={group.expenses}
                      keyExtractor={(expense) => expense.id}
                      scrollEnabled={false}
                      style={styles.expenseList}
                      renderItem={({ item: expense }) => (
                        <View style={styles.expenseRow}>
                          <View
                            style={[
                              styles.categoryDot,
                              { backgroundColor: getCategoryColor(expense.category) },
                            ]}
                          />
                          <View style={styles.expenseMiddle}>
                            <Text  style={styles.expenseName} numberOfLines={2}>
                              {expense.name}
                            </Text>
                            <Text  style={styles.expenseDate}>
                              {formatExpenseDateFull(expense.date)}
                            </Text>
                          </View>
                          <Text  style={styles.expenseAmount}>{formatPKR(expense.amount)}</Text>
                        </View>
                      )}
                    />
                  ) : null}
                </View>

                {analysis ? (
                  <View style={styles.aiCard}>
                    <Text  style={styles.aiCardTitle}>🤖 AI Analysis</Text>
                    <Text  style={styles.aiCardBody}>{analysis}</Text>
                    {analysisSource ? (
                      <Text 
                        style={[
                          styles.aiSourceTag,
                          analysisSource === "claude"
                            ? styles.aiSourceClaude
                            : analysisSource === "groq"
                            ? styles.aiSourceGroq
                            : styles.aiSourceOffline,
                        ]}
                      >
                        {analysisSource === "claude"
                          ? "⚡ Powered by Claude"
                          : analysisSource === "groq"
                          ? "⚡ Powered by Groq"
                          : "💾 Offline suggestion"}
                      </Text>
                    ) : null}
                    <TouchableOpacity
                      activeOpacity={0.88}
                      style={styles.pdfButton}
                      onPress={() => {
                        void handleDownloadPdf(group);
                      }}
                    >
                      <Text  style={styles.pdfButtonText}>Save as PDF 🖨️</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            );
          }}
      />
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
  },
  screenHeader: {
    paddingHorizontal: 20,
    paddingTop: 24,
    marginBottom: 12,
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
    letterSpacing: 0.2,
    textAlign: "center",
  },
  headerSpacer: {
    width: 72,
  },
  headerSubtitle: {
    color: "#8b939e",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 10,
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  loadingWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
    gap: 8,
  },
  loadingText: {
    color: "#9ca3af",
    fontSize: 13,
    fontWeight: "600",
  },
  refreshError: {
    color: "#ff6b6b",
    fontSize: 13,
    fontWeight: "700",
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 14,
  },
  emptyCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(0, 255, 136, 0.16)",
    backgroundColor: "#1a1a1a",
    padding: 20,
  },
  emptyTitle: {
    color: "#f1f5f9",
    fontSize: 17,
    fontWeight: "900",
  },
  emptySubtitle: {
    color: "#9ca3af",
    fontSize: 14,
    marginTop: 8,
    lineHeight: 21,
    fontWeight: "600",
  },
  monthCard: {
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0, 255, 136, 0.2)",
    overflow: "hidden",
    ...Platform.select({
      web: {
        boxShadow: "0 4px 20px rgba(0, 255, 136, 0.12)",
      },
      default: {
        shadowColor: "#00ff88",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
        elevation: 6,
      },
    }),
  },
  monthCardUnderBudget: {
    backgroundColor: "#1a1a1a",
  },
  monthCardOverBudget: {
    backgroundColor: "#1a1111",
    borderColor: "rgba(255, 77, 77, 0.22)",
  },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 12,
  },
  monthHeaderPressed: {
    backgroundColor: "#151515",
  },
  monthHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  chevron: {
    color: "#00ff88",
    fontSize: 12,
    fontWeight: "900",
    width: 18,
  },
  monthTitle: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "900",
    flex: 1,
    minWidth: 0,
  },
  monthTotal: {
    color: "#00ff88",
    fontSize: 15,
    fontWeight: "900",
    flexShrink: 0,
    marginLeft: 8,
    textAlign: "right",
    maxWidth: "44%",
  },
  barSection: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 8,
  },
  barLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  barHint: {
    color: "#6b7280",
    fontSize: 11,
    fontWeight: "700",
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  barPct: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "800",
    flexShrink: 0,
  },
  barTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 999,
  },
  reportButton: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0, 255, 136, 0.35)",
    backgroundColor: "#0f1b16",
    paddingVertical: 12,
    alignItems: "center",
  },
  reportButtonDisabled: {
    opacity: 0.65,
  },
  reportButtonInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  reportButtonText: {
    color: "#00ff88",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  analysisError: {
    color: "#ff6b6b",
    fontSize: 13,
    fontWeight: "700",
    marginHorizontal: 16,
    marginBottom: 12,
  },
  expenseList: {
    borderTopWidth: 1,
    borderTopColor: "#1f2a24",
    paddingTop: 4,
    paddingBottom: 8,
  },
  expenseRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  categoryDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    marginTop: 6,
  },
  expenseMiddle: {
    flex: 1,
    minWidth: 0,
  },
  expenseName: {
    color: "#f8fafc",
    fontSize: 15,
    fontWeight: "800",
  },
  expenseDate: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 6,
    fontWeight: "600",
  },
  expenseAmount: {
    color: "#00ff88",
    fontSize: 14,
    fontWeight: "900",
    textAlign: "right",
  },
  aiCard: {
    marginTop: 4,
    marginBottom: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0, 255, 136, 0.22)",
    borderLeftWidth: 4,
    borderLeftColor: "#00ff88",
    backgroundColor: "#1a1a1a",
    padding: 16,
  },
  aiCardTitle: {
    color: "#00ff88",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 10,
  },
  aiCardBody: {
    color: "#e4e4e7",
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "500",
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
  pdfButton: {
    marginTop: 16,
    borderRadius: 12,
    backgroundColor: "#00ff88",
    paddingVertical: 12,
    alignItems: "center",
  },
  pdfButtonText: {
    color: "#04170f",
    fontSize: 14,
    fontWeight: "900",
  },
});

export default function History() {
  return (
    <ScreenErrorBoundary screenName="History">
      <HistoryScreen />
    </ScreenErrorBoundary>
  );
}
