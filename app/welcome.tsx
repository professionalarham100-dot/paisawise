import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Animated,
    Image,
    Linking,
    Platform,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { setGuestModeEnabled } from "../storage/guestMode";

const BG = "#0a0a0a";
const ACCENT = "#00ff88";

export default function WelcomeScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const pulse = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.9, duration: 1200, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const startGuestMode = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await setGuestModeEnabled(true);
      router.replace("/profile");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.topCluster}>
          <View style={styles.brandWrap}>
            <Animated.View style={[styles.logoGlow, { transform: [{ scale: pulse }] }]} />
            <Image source={require("../assets/PW_Center_1_Neon.png")} style={styles.logoImage} />
            <Text
              
              style={styles.title}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              PaisaWise
            </Text>
            <Text
              
              style={styles.subtitle}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.65}
            >
              Smart budgeting for real Pakistanis
            </Text>
            <View style={styles.highlights}>
              <View style={styles.highlightPill}>
                <Text  style={styles.highlightText}>🤖 AI-powered advice</Text>
              </View>
              <View style={styles.highlightPill}>
                <Text  style={styles.highlightText}>🔥 Roast your spending</Text>
              </View>
              <View style={styles.highlightPill}>
                <Text  style={styles.highlightText}>🎯 Track saving goals</Text>
              </View>
            </View>
          </View>

          <View style={styles.ctaWrap}>
            <Pressable style={[styles.primaryBtn, busy && styles.disabled]} onPress={startGuestMode}>
              {busy ? (
                <ActivityIndicator color={BG} />
              ) : (
                <Text  style={styles.primaryText}>Start without account 🚀</Text>
              )}
            </Pressable>

            <Pressable
              style={[styles.secondaryBtn, busy && styles.disabled]}
              onPress={() => router.push("/login")}
              disabled={busy}
            >
              <Text  style={styles.secondaryText}>I already have an account → Sign in</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.footerBlock}>
          <Text  style={styles.footnote}>No signup needed. Your data is stored on your device.</Text>
          <Text  style={styles.version}>v1.0.0</Text>
          <Pressable onPress={() => Linking.openURL('https://forest-basil-446.notion.site/PaisaWise-Privacy-Policy-3641da6a734380bbaae8e094431d7414')} hitSlop={8}>
            <Text  style={styles.privacyLink}>Privacy Policy</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 24,
    paddingBottom: 24,
  },
  topCluster: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  brandWrap: {
    alignItems: "center",
    gap: 8,
    position: "relative",
  },
  logoGlow: {
    position: "absolute",
    top: -6,
    width: 90,
    height: 90,
    borderRadius: 999,
    backgroundColor: "rgba(0,255,136,0.18)",
    ...Platform.select({
      web: { boxShadow: "0 0 34px rgba(0,255,136,0.36)" },
      default: {
        shadowColor: "#00ff88",
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.4,
        shadowRadius: 16,
        elevation: 8,
      },
    }),
  },
  logoImage: {
    width: 80,
    height: 80,
    alignSelf: "center",
  },
  title: {
    color: "#fff",
    fontSize: 42,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  subtitle: {
    color: "#c3c3c3",
    fontSize: 16,
    textAlign: "center",
  },
  highlights: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    width: "100%",
    maxWidth: 420,
  },
  highlightPill: {
    backgroundColor: "#111111",
    borderColor: "rgba(0,255,136,0.12)",
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    minHeight: 44,
    justifyContent: "center",
  },
  highlightText: {
    color: "#d8fff0",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  ctaWrap: {
    width: "100%",
    maxWidth: 420,
    gap: 16,
    marginTop: 40,
  },
  primaryBtn: {
    backgroundColor: ACCENT,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      web: { boxShadow: "0 6px 20px rgba(0,255,136,0.28)" },
      default: {
        shadowColor: "#00ff88",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.28,
        shadowRadius: 14,
        elevation: 8,
      },
    }),
  },
  primaryText: {
    color: BG,
    fontSize: 17,
    fontWeight: "900",
  },
  secondaryBtn: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: `${ACCENT}80`,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111",
  },
  secondaryText: {
    color: "#ddffef",
    fontSize: 15,
    fontWeight: "700",
  },
  footnote: {
    color: "#808080",
    fontSize: 13,
    textAlign: "center",
  },
  footerBlock: {
    alignItems: "center",
    gap: 8,
  },
  version: {
    color: "#606060",
    fontSize: 10,
    letterSpacing: 0.4,
  },
  disabled: {
    opacity: 0.7,
  },
  privacyLink: {
    color: "#606060",
    fontSize: 11,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
