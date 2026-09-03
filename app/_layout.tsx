import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Stack, usePathname, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { setBackgroundColorAsync } from "expo-system-ui";
import * as Updates from "expo-updates";
import { onAuthStateChanged, type User } from "firebase/auth";
import { Component, type ErrorInfo, type ReactNode, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Image,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { auth } from "../lib/firebase";
import {
    restoreUserDataFromFirestoreIfSignedIn,
    subscribeFirestoreSyncStatus,
} from "../storage/firestoreRestore";
import { GUEST_MODE_KEY, shouldDeferFirestoreRestoreForGuestLogin } from "../storage/guestMode";
import {
    getNotificationsEnabled,
    requestNotificationPermission,
    scheduleDailyReminder,
} from "../utils/notifications";
import { HAS_SEEN_ONBOARDING_KEY } from "./onboarding";

/** Matches screen surfaces so stack transitions do not flash React Navigation’s default white card. */
const APP_SURFACE = "#111111";

const NAVIGATION_THEME = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: APP_SURFACE,
    card: APP_SURFACE,
  },
};

void SplashScreen.preventAutoHideAsync();

// Cap accessibility font scaling so large system font settings on old phones
// can't blow up the layout. Applies to every <Text /> and <TextInput /> globally.
type ComponentWithDefaults = { defaultProps?: { maxFontSizeMultiplier?: number } };
const TextWithDefaults = Text as unknown as ComponentWithDefaults;
TextWithDefaults.defaultProps = TextWithDefaults.defaultProps ?? {};
TextWithDefaults.defaultProps.maxFontSizeMultiplier = 1.2;
const TextInputWithDefaults = TextInput as unknown as ComponentWithDefaults;
TextInputWithDefaults.defaultProps = TextInputWithDefaults.defaultProps ?? {};
TextInputWithDefaults.defaultProps.maxFontSizeMultiplier = 1.2;

type ErrorBoundaryState = {
  hasError: boolean;
};

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.log("AppErrorBoundary caught:", error?.message, info?.componentStack);
  }

  handleRestart = () => {
    void (async () => {
      try {
        await Updates.reloadAsync();
      } catch {
        // If reload is unavailable (e.g. dev client), reset boundary to retry render.
        this.setState({ hasError: false });
      }
    })();
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorScreen}>
          <Image
            source={require("../assets/PW_Center_1_Neon.png")}
            style={styles.errorLogo}
            accessibilityLabel="PaisaWise"
          />
          <Text style={styles.errorBrand}>PaisaWise</Text>
          <Text style={styles.errorMessage}>
            Something went wrong. Please restart the app.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Restart app"
            onPress={this.handleRestart}
            style={styles.errorRestartButton}
          >
            <Text style={styles.errorRestartButtonText}>Restart</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  useEffect(() => {
    void setBackgroundColorAsync(APP_SURFACE);
  }, []);

  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [authResolved, setAuthResolved] = useState(false);
  const [guestModeEnabled, setGuestModeEnabled] = useState<boolean | undefined>(undefined);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | undefined>(undefined);
  const [firestoreSyncFailed, setFirestoreSyncFailed] = useState(false);
  const [networkBannerState, setNetworkBannerState] = useState<"offline" | "online" | null>(null);
  const wasOfflineRef = useRef(false);
  const onlineHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (next) => {
      setUser(next);
      setAuthResolved(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    return subscribeFirestoreSyncStatus((ok) => {
      setFirestoreSyncFailed(!ok);
    });
  }, []);

  useEffect(() => {
    const clearOnlineHideTimer = () => {
      if (onlineHideTimeoutRef.current) {
        clearTimeout(onlineHideTimeoutRef.current);
        onlineHideTimeoutRef.current = null;
      }
    };

    const subscription = NetInfo.addEventListener((state) => {
      const offline = state.isConnected === false || state.isInternetReachable === false;

      if (offline) {
        clearOnlineHideTimer();
        wasOfflineRef.current = true;
        setNetworkBannerState("offline");
        return;
      }

      if (!wasOfflineRef.current) {
        return;
      }

      wasOfflineRef.current = false;
      setNetworkBannerState("online");
      clearOnlineHideTimer();
      onlineHideTimeoutRef.current = setTimeout(() => {
        setNetworkBannerState(null);
      }, 2000);
    });

    return () => {
      subscription();
      clearOnlineHideTimer();
    };
  }, []);

  useEffect(() => {
    if (!user?.emailVerified) {
      setFirestoreSyncFailed(false);
      return;
    }
    void (async () => {
      if (await shouldDeferFirestoreRestoreForGuestLogin()) {
        return;
      }
      void restoreUserDataFromFirestoreIfSignedIn();
    })();
  }, [user?.uid, user?.emailVerified]);

  useEffect(() => {
    let alive = true;
    const loadFlags = async () => {
      try {
        const [guestRaw, onboardingRaw] = await Promise.all([
          AsyncStorage.getItem(GUEST_MODE_KEY),
          AsyncStorage.getItem(HAS_SEEN_ONBOARDING_KEY),
        ]);
        if (alive) {
          setGuestModeEnabled(guestRaw === "true");
          setHasSeenOnboarding(onboardingRaw === "true");
        }
      } catch {
        if (alive) {
          setGuestModeEnabled(false);
          setHasSeenOnboarding(false);
        }
      }
    };
    void loadFlags();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (user === undefined || guestModeEnabled === undefined || hasSeenOnboarding === undefined) {
      return;
    }

    const id = setTimeout(() => {
      const runRouting = async () => {
      const onWelcome = pathname === "/welcome";
      const onLogin = pathname === "/login";
      const onOnboarding = pathname === "/onboarding";

      // Hard gate: onboarding must be completed before any other route.
      if (!hasSeenOnboarding) {
        // Re-check persisted flag in case onboarding was just completed.
        const persisted = await AsyncStorage.getItem(HAS_SEEN_ONBOARDING_KEY);
        if (persisted === "true") {
          setHasSeenOnboarding(true);
          return;
        }
        if (!onOnboarding) {
          router.replace("/onboarding");
        }
        return;
      }

      if (user && user.emailVerified) {
        if (onWelcome || onOnboarding) {
          router.replace("/(tabs)");
          return;
        }
        if (onLogin) {
          if (await shouldDeferFirestoreRestoreForGuestLogin()) {
            return;
          }
          router.replace("/(tabs)");
          return;
        }
        return;
      }

      if (user && !user.emailVerified) {
        if (!onLogin) {
          router.replace("/login");
        }
        return;
      }

      // Re-check guest flag live and treat persisted value as source of truth.
      const persistedGuest = await AsyncStorage.getItem(GUEST_MODE_KEY);
      const persistedGuestEnabled = persistedGuest === "true";
      if (guestModeEnabled !== persistedGuestEnabled) {
        setGuestModeEnabled(persistedGuestEnabled);
        return;
      }
      const isGuestNow = persistedGuestEnabled;

      if (isGuestNow) {
        if (onWelcome || onOnboarding) {
          router.replace("/(tabs)");
        }
        return;
      }

      // No auth and not guest: show the landing experience.
      if (!onWelcome && !onLogin && !onOnboarding) {
        router.replace("/welcome");
      }
      };
      void runRouting();
    }, 0);

    return () => clearTimeout(id);
  }, [user, guestModeEnabled, hasSeenOnboarding, pathname, router]);

  useEffect(() => {
    if (user === undefined || guestModeEnabled === undefined || hasSeenOnboarding === undefined) {
      return;
    }
    let alive = true;
    const hideSplash = async () => {
      if (!alive) {
        return;
      }
      await SplashScreen.hideAsync();
    };
    void hideSplash();
    return () => {
      alive = false;
    };
  }, [user, guestModeEnabled, hasSeenOnboarding]);

  useEffect(() => {
    if (hasSeenOnboarding === undefined || hasSeenOnboarding === false) {
      return;
    }
    let alive = true;
    const bootNotifications = async () => {
      try {
        const granted = await requestNotificationPermission();
        if (!granted || !alive) {
          return;
        }
        const enabled = await getNotificationsEnabled();
        if (enabled && alive) {
          await scheduleDailyReminder();
        }
      } catch {
        // keep app boot resilient
      }
    };
    void bootNotifications();
    return () => {
      alive = false;
    };
  }, [hasSeenOnboarding]);

  if (!authResolved || guestModeEnabled === undefined || hasSeenOnboarding === undefined) {
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: APP_SURFACE }}>
        <ThemeProvider value={NAVIGATION_THEME}>
          <AppErrorBoundary>
            <View style={styles.loadingScreen}>
              <Image source={require("../assets/PW_Center_1_Neon.png")} style={styles.loadingLogo} />
              <Text style={styles.loadingBrand}>PaisaWise</Text>
              <ActivityIndicator color="#00ff88" size="large" />
              <Text style={styles.loadingText}>Loading...</Text>
            </View>
          </AppErrorBoundary>
        </ThemeProvider>
      </GestureHandlerRootView>
    );
  }

  const showSyncBanner = Boolean(user?.emailVerified && firestoreSyncFailed);
  const showNetworkBanner = networkBannerState !== null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: APP_SURFACE }}>
      <ThemeProvider value={NAVIGATION_THEME}>
        <AppErrorBoundary>
          <View style={{ flex: 1, backgroundColor: APP_SURFACE }}>
          {showNetworkBanner || showSyncBanner ? (
          <View style={{ zIndex: 20 }}>
            {showNetworkBanner ? (
              <View
                style={[
                  styles.networkBanner,
                  networkBannerState === "offline"
                    ? styles.networkBannerOffline
                    : styles.networkBannerOnline,
                  {
                    paddingTop: Math.max(insets.top, 10),
                    paddingBottom: 10,
                  },
                ]}
              >
                <Text style={styles.networkBannerText}>
                  {networkBannerState === "offline"
                    ? "No internet — showing stored data"
                    : "Back online ✅"}
                </Text>
              </View>
            ) : null}
            {showSyncBanner ? (
              <View
                style={[
                  styles.syncBanner,
                  {
                    paddingTop: 8,
                    paddingBottom: 10,
                  },
                ]}
              >
                <Text style={styles.syncBannerText}>
                  {"Couldn't sync data. Using local data."}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: APP_SURFACE },
            }}
          />
        </View>
        </AppErrorBoundary>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    backgroundColor: APP_SURFACE,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingLogo: {
    width: 64,
    height: 64,
    borderRadius: 14,
  },
  loadingBrand: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  loadingText: {
    color: "#9ca3af",
    fontSize: 14,
    fontWeight: "600",
  },
  syncBanner: {
    backgroundColor: "#2a2618",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(245, 207, 84, 0.35)",
    paddingHorizontal: 14,
  },
  syncBannerText: {
    color: "#f5cf54",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 17,
  },
  networkBanner: {
    borderBottomWidth: 1,
    paddingHorizontal: 14,
  },
  networkBannerOffline: {
    backgroundColor: "#3b0d0d",
    borderBottomColor: "rgba(255, 99, 99, 0.4)",
  },
  networkBannerOnline: {
    backgroundColor: "#0f2d18",
    borderBottomColor: "rgba(53, 226, 123, 0.45)",
  },
  networkBannerText: {
    color: "#f8fafc",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 17,
  },
  errorScreen: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 14,
  },
  errorLogo: {
    width: 96,
    height: 96,
    borderRadius: 18,
  },
  errorBrand: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  errorMessage: {
    color: "#cbd5e1",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 22,
    marginTop: 4,
    marginBottom: 12,
  },
  errorRestartButton: {
    minWidth: 180,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: "#00ff88",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  errorRestartButtonText: {
    color: "#04170f",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
});
