import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { formatPKR } from "../utils/currency";

const formatTodayHeading = () => {
  return new Date().toLocaleDateString("en-PK", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

type BudgetRingProps = {
  ratio: number;
  color: string;
  trackColor?: string;
  size?: number;
  stroke?: number;
};

/**
 * Pure-View circular progress ring (no SVG / external libs).
 *
 * Technique: two clip wrappers (right half / left half) each containing a
 * 200x200 inner view rotated around the parent center. Inside each rotated
 * inner view sits a top-half clip of a fully-bordered circle, producing a
 * 180° arc that sweeps to a new quadrant as the rotation changes.
 */
const BudgetRing = ({
  ratio,
  color,
  trackColor = "#1a1a1a",
  size = 200,
  stroke = 14,
}: BudgetRingProps) => {
  const half = size / 2;
  const pct = Math.max(0, Math.min(1, ratio));
  // First half arc sweeps as pct goes 0 -> 0.5 (rotation -90 -> +90).
  const r1 = pct <= 0.5 ? -90 + pct * 360 : 90;
  // Second half arc sweeps as pct goes 0.5 -> 1 (rotation +90 -> -90).
  const r2 = pct > 0.5 ? 90 - (pct - 0.5) * 360 : 90;

  const ringStyle = {
    width: size,
    height: size,
    borderRadius: half,
    borderWidth: stroke,
    borderColor: color,
  } as const;

  const renderHalfRingTop = () => (
    <View
      style={{
        position: "absolute",
        width: size,
        height: half,
        top: 0,
        left: 0,
        overflow: "hidden",
      }}
    >
      <View style={ringStyle} />
    </View>
  );

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: half,
          borderWidth: stroke,
          borderColor: trackColor,
        }}
      />

      <View
        style={{
          position: "absolute",
          width: half,
          height: size,
          left: half,
          top: 0,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            position: "absolute",
            width: size,
            height: size,
            left: -half,
            top: 0,
            transform: [{ rotate: `${r1}deg` }],
          }}
        >
          {renderHalfRingTop()}
        </View>
      </View>

      {pct > 0.5 ? (
        <View
          style={{
            position: "absolute",
            width: half,
            height: size,
            left: 0,
            top: 0,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              position: "absolute",
              width: size,
              height: size,
              left: 0,
              top: 0,
              transform: [{ rotate: `${r2}deg` }],
            }}
          >
            {renderHalfRingTop()}
          </View>
        </View>
      ) : null}
    </View>
  );
};

export type BudgetRingSectionProps = {
  greetingLine: string;
  budgetSpendRatio: number;
  budgetAlertTier: "none" | "yellow" | "orange" | "red";
  budgetRemaining: number;
  hasCustomBudgetLimit: boolean;
  monthlyIncome: number;
  totalExpenses: number;
  monthlyBudgetLimit: number;
  oneTimeTotal: number;
  monthlyRecurringTotal: number;
  isRingEmptyState: boolean;
  ringPulse: Animated.Value;
  onIncomePress: () => void;
};

export default function BudgetRingSection({
  greetingLine,
  budgetSpendRatio,
  budgetAlertTier,
  budgetRemaining,
  hasCustomBudgetLimit,
  monthlyIncome,
  totalExpenses,
  monthlyBudgetLimit,
  oneTimeTotal,
  monthlyRecurringTotal,
  isRingEmptyState,
  ringPulse,
  onIncomePress,
}: BudgetRingSectionProps) {
  return (
    <View style={styles.heroSection}>
      <Text
        
        style={styles.greeting}
        numberOfLines={2}
        ellipsizeMode="tail"
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {greetingLine}
      </Text>
      <Text  style={styles.todayDate}>{formatTodayHeading()}</Text>

      <View style={styles.budgetRingWrap}>
        <Animated.View style={{ transform: [{ scale: ringPulse }] }}>
          <BudgetRing
            ratio={Math.min(1, budgetSpendRatio)}
            color={
              budgetAlertTier === "red"
                ? "#ff4d4d"
                : budgetAlertTier === "orange"
                  ? "#ff9900"
                  : "#00ff88"
            }
          />
        </Animated.View>
        <View style={styles.budgetRingCenter} pointerEvents="none">
          {isRingEmptyState ? (
            <>
              <Text
                
                style={[styles.budgetRingValue, styles.remainingPositive]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.5}
              >
                {formatPKR(monthlyIncome)}
              </Text>
              <Text  style={styles.budgetRingLabel}>
                full budget available
              </Text>
            </>
          ) : (
            <>
              <Text
                
                style={[
                  styles.budgetRingValue,
                  budgetRemaining >= 0 ? styles.remainingPositive : styles.remainingNegative,
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.5}
              >
                {formatPKR(Math.abs(budgetRemaining))}
              </Text>
              <Text  style={styles.budgetRingLabel}>
                {budgetRemaining >= 0
                  ? hasCustomBudgetLimit
                    ? "remaining"
                    : "est. remaining"
                  : "over budget"}
              </Text>
            </>
          )}
        </View>
      </View>

      <Text  style={styles.budgetSpentLine}>
        {formatPKR(totalExpenses)} of {formatPKR(monthlyBudgetLimit)} spent
      </Text>

      <View style={styles.budgetStatsGrid}>
        <View style={styles.budgetStatsRow}>
          <Pressable onPress={onIncomePress} style={styles.budgetStatCol}>
            <Text  style={styles.budgetStatLabel}>Income</Text>
            <Text
              
              style={styles.budgetStatValue}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {monthlyIncome > 0 ? formatPKR(monthlyIncome) : "Tap to set"}
            </Text>
          </Pressable>
          <View style={styles.budgetStatCol}>
            <Text  style={styles.budgetStatLabel}>Spent</Text>
            <Text
              
              style={styles.budgetStatValue}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {formatPKR(totalExpenses)}
            </Text>
          </View>
        </View>
        <View style={styles.budgetStatsRow}>
          <View style={styles.budgetStatCol}>
            <Text  style={styles.budgetStatLabel}>One-time</Text>
            <Text
              
              style={styles.budgetStatValue}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {formatPKR(oneTimeTotal)}
            </Text>
          </View>
          <View style={styles.budgetStatCol}>
            <Text  style={styles.budgetStatLabel}>Monthly</Text>
            <Text
              
              style={styles.budgetStatValue}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {formatPKR(monthlyRecurringTotal)}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroSection: {
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderRadius: 20,
    backgroundColor: "#0c0c0c",
    ...Platform.select({
      web: {
        backgroundImage: "linear-gradient(180deg, #0f0f0f 0%, #0a0a0a 100%)",
      },
      default: {},
    }),
  },
  greeting: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 0.2,
    lineHeight: 30,
    alignSelf: "stretch",
    width: "100%",
    flexShrink: 1,
    paddingRight: 8,
  },
  todayDate: {
    color: "#8b939e",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 8,
    letterSpacing: 0.15,
  },
  budgetRingWrap: {
    alignSelf: "center",
    width: 200,
    height: 200,
    marginTop: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  budgetRingCenter: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  budgetRingValue: {
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 0.2,
    textAlign: "center",
  },
  budgetRingLabel: {
    color: "#9aa0a6",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
    textTransform: "lowercase",
  },
  budgetSpentLine: {
    color: "#9aa0a6",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 14,
  },
  budgetStatsGrid: {
    marginTop: 18,
    gap: 10,
  },
  budgetStatsRow: {
    flexDirection: "row",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
    paddingBottom: 8,
  },
  budgetStatCol: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
    minWidth: 0,
  },
  budgetStatLabel: {
    color: "#6b7280",
    fontSize: 12,
    fontWeight: "600",
  },
  budgetStatValue: {
    color: "#e5e7eb",
    fontSize: 12,
    fontWeight: "800",
    flexShrink: 1,
    textAlign: "right",
    marginLeft: 8,
  },
  remainingPositive: {
    color: "#00ff88",
  },
  remainingNegative: {
    color: "#ff4d4d",
  },
});
