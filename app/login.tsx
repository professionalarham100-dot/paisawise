import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
    createUserWithEmailAndPassword,
    reload,
    sendEmailVerification,
    sendPasswordResetEmail,
    signInWithEmailAndPassword,
    signOut,
} from "firebase/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Image,
    KeyboardAvoidingView,
    Linking,
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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { auth } from "../lib/firebase";
import { EXPENSES_STORAGE_KEY } from "../storage/expenses";
import {
    fetchCloudUserDataBundleForCurrentUser,
    restoreUserDataFromFirestoreIfSignedIn,
    type CloudUserDataBundle,
} from "../storage/firestoreRestore";
import {
    clearGuestMode,
    hasMeaningfulGuestLocalData,
    isGuestModeEnabled,
    mergeGuestLocalWithCloudBundle,
    migrateGuestLocalDataToFirestoreForCurrentUser,
} from "../storage/guestMode";
import {
    MONTHLY_INCOME_SYNC_KEY,
    USER_PROFILE_STORAGE_KEY,
} from "../storage/userProfile";

type Tab = "login" | "register";

const syncAndRouteAfterLogin = async (router: ReturnType<typeof useRouter>) => {
  // Clear both canonical and legacy keys so one account cannot see another account's local cache.
  await AsyncStorage.multiRemove([
    USER_PROFILE_STORAGE_KEY,
    EXPENSES_STORAGE_KEY,
    "paisawise.savingGoals.v1",
    MONTHLY_INCOME_SYNC_KEY,
    "paisawise.expenseNameHistory.v1",
    // Legacy keys kept for backward compatibility cleanup:
    "paisawise_expenses",
    "paisawise_goals",
    "paisawise_budgets",
    "paisawise_history",
  ]);
  await restoreUserDataFromFirestoreIfSignedIn();
  await clearGuestMode();
  const profile = await AsyncStorage.getItem(USER_PROFILE_STORAGE_KEY);
  if (profile == null) {
    router.replace("/profile");
    return;
  }
  router.replace("/(tabs)");
};

const BG = "#0a0a0a";
const ACCENT = "#00ff88";
const CARD = "#0f0f0f";
const BORDER = "#1a1a1a";
const PLACEHOLDER = "#00ff8866";

type PostVerifiedLoginResult =
  | { outcome: "ok" }
  | { outcome: "modal"; bundle: CloudUserDataBundle }
  | { outcome: "error" };

const runPostVerifiedLogin = async (
  router: ReturnType<typeof useRouter>,
  setErrorMsg: (msg: string) => void
): Promise<PostVerifiedLoginResult> => {
  const bundle = await fetchCloudUserDataBundleForCurrentUser();
  if (bundle === null) {
    setErrorMsg("Could not reach the cloud to check your saved data. Check your connection and try again.");
    await signOut(auth);
    return { outcome: "error" };
  }
  const hasCloud = bundle.presence.hasAny;
  const guest = await isGuestModeEnabled();
  const meaningful = await hasMeaningfulGuestLocalData();

  if (guest && meaningful && hasCloud) {
    return { outcome: "modal", bundle };
  }

  if (meaningful && !hasCloud) {
    await migrateGuestLocalDataToFirestoreForCurrentUser();
  }
  await clearGuestMode();
  await syncAndRouteAfterLogin(router);
  return { outcome: "ok" };
};

const getMailProviderOpen = (
  addr: string
): { label: string; url: string } | null => {
  const lower = addr.trim().toLowerCase();
  if (lower.endsWith("@gmail.com")) {
    return { label: "Open Gmail 📩", url: "https://mail.google.com" };
  }
  if (lower.endsWith("@outlook.com") || lower.endsWith("@hotmail.com")) {
    return { label: "Open Outlook 📩", url: "https://outlook.live.com" };
  }
  return null;
};

const openInboxUrl = (url: string) => {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  } else {
    void Linking.openURL(url);
  }
};

const mapError = (err: unknown): string => {
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code?: string }).code);
    switch (code) {
      case "auth/email-already-in-use":
        return "That email is already registered.";
      case "auth/invalid-email":
        return "Enter a valid email address.";
      case "auth/weak-password":
        return "Use a stronger password (at least 6 characters).";
      case "auth/user-disabled":
        return "This account has been disabled.";
      case "auth/user-not-found":
      case "auth/wrong-password":
      case "auth/invalid-credential":
        return "Invalid email or password.";
      case "auth/too-many-requests":
        return "Too many attempts. Try again shortly.";
      case "auth/network-request-failed":
        return "Network error. Check your connection.";
      default:
        break;
    }
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return "Something went wrong. Try again.";
};

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [busy, setBusy] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [successResendBusy, setSuccessResendBusy] = useState(false);

  const [error, setError] = useState("");
  const [infoGreen, setInfoGreen] = useState("");
  const [showResendLink, setShowResendLink] = useState(false);
  const [registerSuccessEmail, setRegisterSuccessEmail] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState("");
  const [showLoginInstead, setShowLoginInstead] = useState(false);

  const authActionBusyRef = useRef(false);
  const guestDiscardBusyRef = useRef(false);
  const guestModalLockedRef = useRef(false);
  const [showGuestDiscardModal, setShowGuestDiscardModal] = useState(false);
  const [pendingBundle, setPendingBundle] = useState<CloudUserDataBundle | null>(null);

  useEffect(() => {
    if (guestModalLockedRef.current) {
      return;
    }
    if (params.tab === "register") {
      setTab("register");
    } else if (params.tab === "login") {
      setTab("login");
    }
  }, [params.tab]);

  const goTab = (next: Tab) => {
    if (guestModalLockedRef.current) {
      return;
    }
    setTab(next);
    setError("");
    setInfoGreen("");
    setShowResendLink(false);
    setRegisterSuccessEmail(null);
    setSuccessToast("");
    setShowLoginInstead(false);
    setShowGuestDiscardModal(false);
  };

  const handleGuestDiscardContinue = useCallback(async () => {
    if (guestDiscardBusyRef.current || !guestModalLockedRef.current) {
      return;
    }
    guestDiscardBusyRef.current = true;
    setBusy(true);
    try {
      if (pendingBundle) {
        await mergeGuestLocalWithCloudBundle(pendingBundle);
      }
      await clearGuestMode();
      await syncAndRouteAfterLogin(router);
    } catch (e) {
      setError(mapError(e));
    } finally {
      guestDiscardBusyRef.current = false;
      setBusy(false);
      guestModalLockedRef.current = false;
      setShowGuestDiscardModal(false);
      setPendingBundle(null);
    }
  }, [pendingBundle, router]);

  const handleGuestDiscardCancel = useCallback(async () => {
    if (guestDiscardBusyRef.current) {
      return;
    }
    guestDiscardBusyRef.current = true;
    setBusy(true);
    try {
      await signOut(auth);
    } catch {
      // ignore
    } finally {
      guestDiscardBusyRef.current = false;
      setBusy(false);
      guestModalLockedRef.current = false;
      setShowGuestDiscardModal(false);
      router.replace("/welcome");
    }
  }, [router]);

  const trimmedEmail = email.trim();

  const createAccount = useCallback(async () => {
    if (authActionBusyRef.current) {
      return;
    }
    setError("");
    setInfoGreen("");
    setShowResendLink(false);
    setShowLoginInstead(false);
    setSuccessToast("");
    if (!trimmedEmail || !password) {
      setError("Enter your email and password.");
      return;
    }
    authActionBusyRef.current = true;
    setBusy(true);
    try {
      const { user } = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
      await sendEmailVerification(user);
      // Stay signed in until "Go to Login" so RootLayout does not replace("/") away
      // from this screen while unverified (see app/_layout.tsx).
      setRegisterSuccessEmail(user.email ?? trimmedEmail);
    } catch (e) {
      const code =
        e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
      if (code === "auth/email-already-in-use") {
        setError("This email is already registered");
        setShowLoginInstead(true);
      } else {
        setError(mapError(e));
      }
    } finally {
      authActionBusyRef.current = false;
      setBusy(false);
    }
  }, [trimmedEmail, password]);

  const signIn = useCallback(async () => {
    if (authActionBusyRef.current) {
      return;
    }
    setError("");
    setInfoGreen("");
    setShowResendLink(false);
    if (!trimmedEmail || !password) {
      setError("Enter your email and password.");
      return;
    }
    authActionBusyRef.current = true;
    setBusy(true);
    try {
      const { user } = await signInWithEmailAndPassword(auth, trimmedEmail, password);
      await reload(user);
      if (!user.emailVerified) {
        await signOut(auth);
        setError("Please verify your email first. Check your inbox.");
        setShowResendLink(true);
        return;
      }
      const result = await runPostVerifiedLogin(router, setError);
      if (result.outcome === "error") {
        return;
      }
      if (result.outcome === "modal") {
        setPendingBundle(result.bundle);
        guestModalLockedRef.current = true;
        setShowGuestDiscardModal(true);
        return;
      }
    } catch (error: unknown) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code: string }).code)
          : "";
      const message =
        error instanceof Error ? error.message : String(error);
      console.log("LOGIN ERROR", code, message);
      setError(mapError(error));
    } finally {
      authActionBusyRef.current = false;
      setBusy(false);
    }
  }, [password, trimmedEmail, router]);

  const resendVerification = useCallback(async () => {
    if (authActionBusyRef.current) {
      return;
    }
    setError("");
    setInfoGreen("");
    if (!trimmedEmail || !password) {
      setError("Enter your email and password to resend.");
      return;
    }
    authActionBusyRef.current = true;
    setResendBusy(true);
    try {
      const { user } = await signInWithEmailAndPassword(auth, trimmedEmail, password);
      await reload(user);
      if (user.emailVerified) {
        const result = await runPostVerifiedLogin(router, setError);
        if (result.outcome === "error") {
          return;
        }
        if (result.outcome === "modal") {
          setPendingBundle(result.bundle);
          guestModalLockedRef.current = true;
          setShowGuestDiscardModal(true);
          return;
        }
        return;
      }
      await sendEmailVerification(user);
      await signOut(auth);
      setInfoGreen("Verification email sent. Check your inbox.");
      setShowResendLink(false);
    } catch (e) {
      setError(mapError(e));
    } finally {
      authActionBusyRef.current = false;
      setResendBusy(false);
    }
  }, [trimmedEmail, password, router]);

  const resendFromSuccessScreen = useCallback(async () => {
    if (authActionBusyRef.current) {
      return;
    }
    if (!registerSuccessEmail || !password) {
      setSuccessToast("");
      return;
    }
    authActionBusyRef.current = true;
    setSuccessResendBusy(true);
    setSuccessToast("");
    try {
      const { user } = await signInWithEmailAndPassword(
        auth,
        registerSuccessEmail,
        password
      );
      await sendEmailVerification(user);
      await signOut(auth);
      setSuccessToast("EMAIL_SENT");
    } catch (e) {
      setSuccessToast(`ERR:${mapError(e)}`);
    } finally {
      authActionBusyRef.current = false;
      setSuccessResendBusy(false);
    }
  }, [registerSuccessEmail, password]);

  const goToLoginFromSuccess = useCallback(async () => {
    const addr = registerSuccessEmail;
    try {
      await signOut(auth);
    } catch {
      // ignore sign-out errors (e.g. already signed out after resend)
    }
    setRegisterSuccessEmail(null);
    setSuccessToast("");
    setTab("login");
    if (addr) {
      setEmail(addr);
    }
    setPassword("");
  }, [registerSuccessEmail]);

  const forgotPassword = useCallback(async () => {
    if (authActionBusyRef.current) {
      return;
    }
    setError("");
    setInfoGreen("");
    if (!trimmedEmail) {
      setError("Enter your email first");
      return;
    }
    authActionBusyRef.current = true;
    setForgotBusy(true);
    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
      setInfoGreen("Reset email sent!");
    } catch (e) {
      setError(mapError(e));
    } finally {
      authActionBusyRef.current = false;
      setForgotBusy(false);
    }
  }, [trimmedEmail]);

  const inputsLocked = busy || forgotBusy || resendBusy || showGuestDiscardModal;

  const mailProvider = registerSuccessEmail ? getMailProviderOpen(registerSuccessEmail) : null;

  if (registerSuccessEmail) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <StatusBar barStyle="light-content" />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={
            Platform.OS === "ios" ? 8 : (StatusBar.currentHeight ?? 0) + 8
          }
        >
          <ScrollView
            contentContainerStyle={[
              styles.successScroll,
              { paddingBottom: Math.max(32, 24 + insets.bottom) },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text  style={styles.successCheck}>✅</Text>
            <Text  style={styles.successTitle}>Account Created!</Text>

            {mailProvider ? (
              <Pressable
                style={styles.openMailButton}
                onPress={() => openInboxUrl(mailProvider.url)}
              >
                <Text  style={styles.openMailButtonText}>{mailProvider.label}</Text>
              </Pressable>
            ) : null}

            <Text  style={styles.verifyIntro}>
              📧 We sent a verification email to
            </Text>
            <Text  style={styles.verifyEmail}>{registerSuccessEmail}</Text>

            <View style={styles.nextStepsCard}>
              <Text  style={styles.nextStepsHeading}>Next Steps</Text>
              <Text  style={styles.stepLine}>
                <Text  style={styles.stepNum}>1.</Text> Open your email inbox
              </Text>
              <Text  style={styles.stepLine}>
                <Text  style={styles.stepNum}>2.</Text> Click the verification link
              </Text>
              <Text  style={styles.stepLine}>
                <Text  style={styles.stepNum}>3.</Text> Come back and login
              </Text>
            </View>

            <Text  style={styles.spamHint}>
              {"⏱️ Don't see the email? Check your spam folder."}
            </Text>

            {successToast ? (
              <Text 
                style={[
                  styles.successToast,
                  successToast === "EMAIL_SENT" ? styles.successToastOk : styles.feedbackErr,
                ]}
              >
                {successToast === "EMAIL_SENT" ? "Email sent!" : successToast.replace(/^ERR:/, "")}
              </Text>
            ) : null}

            <View style={styles.successButtonRow}>
              <Pressable
                style={[styles.btnOutline, successResendBusy && styles.ctaMuted]}
                onPress={() => {
                  void resendFromSuccessScreen();
                }}
                disabled={successResendBusy}
              >
                {successResendBusy ? (
                  <ActivityIndicator color={ACCENT} />
                ) : (
                  <Text  style={styles.btnOutlineText}>Resend Email 📩</Text>
                )}
              </Pressable>
              <Pressable
                style={styles.btnFilled}
                onPress={() => {
                  void goToLoginFromSuccess();
                }}
              >
                <Text  style={styles.btnFilledText}>Go to Login →</Text>
              </Pressable>
            </View>

            <Text  style={styles.footerSuccess}>Secure sign-in powered by Firebase 🔒</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={
          Platform.OS === "ios" ? 8 : (StatusBar.currentHeight ?? 0) + 8
        }
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            {
              paddingTop: Math.max(12, 8 + insets.top),
              paddingBottom: Math.max(40, 28 + insets.bottom),
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Image source={require("../assets/PW_Center_1_Neon.png")} style={styles.logoImage} />
            <Text
              
              style={styles.title}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.65}
            >
              PaisaWise
            </Text>
            <Text
              
              style={styles.subtitle}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              Your money, clearly.
            </Text>
          </View>

          <View style={styles.tabs}>
            <View style={[styles.tabIndicator, tab === "login" ? styles.indicatorLeft : styles.indicatorRight]} />
            <Pressable
              style={styles.tab}
              onPress={() => goTab("login")}
            >
              <Text  style={[styles.tabLabel, tab === "login" && styles.tabLabelOn]}>Login</Text>
            </Pressable>
            <Pressable
              style={styles.tab}
              onPress={() => goTab("register")}
            >
              <Text  style={[styles.tabLabel, tab === "register" && styles.tabLabelOn]}>
                Register
              </Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <Text  style={styles.fieldLabel}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={PLACEHOLDER}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              style={styles.input}
              editable={!inputsLocked}
            />

            <Text  style={[styles.fieldLabel, styles.fieldGap]}>Password</Text>
            <View style={styles.passwordRow}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={PLACEHOLDER}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete={tab === "register" ? "password-new" : "password"}
                style={styles.passwordInput}
                editable={!inputsLocked}
              />
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                style={styles.eye}
                hitSlop={8}
                accessibilityLabel={showPassword ? "Hide password" : "Show password"}
              >
                <Text  style={styles.eyeText}>{showPassword ? "Hide" : "Show"}</Text>
              </Pressable>
            </View>

            <Pressable
              style={[styles.cta, inputsLocked && styles.ctaMuted]}
              disabled={inputsLocked}
              onPress={() => {
                if (inputsLocked) {
                  return;
                }
                void (tab === "login" ? signIn() : createAccount());
              }}
            >
              {busy ? (
                <ActivityIndicator color="#03140c" />
              ) : (
                <Text  style={styles.ctaText}>
                  {tab === "login" ? "Sign In" : "Create Account"}
                </Text>
              )}
            </Pressable>

            {tab === "login" ? (
              <Pressable
                style={styles.forgotRow}
                onPress={() => {
                  void forgotPassword();
                }}
                disabled={forgotBusy || busy || resendBusy}
              >
                {forgotBusy ? (
                  <ActivityIndicator color={ACCENT} size="small" />
                ) : (
                  <Text  style={styles.linkAccent}>Forgot Password?</Text>
                )}
              </Pressable>
            ) : null}

            {infoGreen ? (
              <View style={styles.infoCardOk}>
                <Text  style={styles.infoOk}>{infoGreen}</Text>
              </View>
            ) : null}
            {error ? (
              <View style={styles.infoCardErr}>
                <Text  style={styles.infoErr}>{error}</Text>
              </View>
            ) : null}

            {showLoginInstead && tab === "register" ? (
              <Pressable
                style={styles.loginInsteadRow}
                onPress={() => {
                  setTab("login");
                  setEmail(trimmedEmail);
                  setShowLoginInstead(false);
                  setError("");
                }}
              >
                <Text  style={styles.linkAccentSmall}>Login instead →</Text>
              </Pressable>
            ) : null}

            {showResendLink && tab === "login" ? (
              <Pressable
                style={styles.resendRow}
                onPress={() => {
                  void resendVerification();
                }}
                disabled={resendBusy || busy}
              >
                {resendBusy ? (
                  <ActivityIndicator color={ACCENT} size="small" />
                ) : (
                  <Text  style={styles.linkAccentSmall}>Resend verification email</Text>
                )}
              </Pressable>
            ) : null}
          </View>

          <Text  style={styles.footer}>Secure sign-in powered by Firebase 🔒</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={showGuestDiscardModal}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={[styles.guestModalOverlay, { paddingBottom: 20 + insets.bottom }]}>
          <View style={styles.guestModalCard}>
            <Text  style={styles.guestModalTitle}>Tumhara guest data cloud se merge kar dein?</Text>
            <Text  style={styles.guestModalBody}>
              Tumhare guest expenses aur account ka data dono save ho jayenge. Koi cheez delete nahi hogi.
            </Text>
            <Pressable
              style={[styles.guestModalBtn, styles.guestModalBtnPrimary, busy && styles.ctaMuted]}
              disabled={busy}
              onPress={() => {
                void handleGuestDiscardContinue();
              }}
            >
              <Text  style={styles.guestModalBtnPrimaryText}>Merge & Continue</Text>
            </Pressable>
            <Pressable
              style={[styles.guestModalBtn, styles.guestModalBtnGhost, busy && styles.ctaMuted]}
              disabled={busy}
              onPress={() => {
                void handleGuestDiscardCancel();
              }}
            >
              <Text  style={styles.guestModalBtnGhostText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    justifyContent: "center",
  },
  successScroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 32,
    backgroundColor: BG,
  },
  successCheck: {
    fontSize: 64,
    textAlign: "center",
    lineHeight: 72,
  },
  successTitle: {
    marginTop: 28,
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: -0.3,
  },
  openMailButton: {
    marginTop: 20,
    alignSelf: "center",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#174f39",
    backgroundColor: "#0f1b16",
  },
  openMailButtonText: {
    color: ACCENT,
    fontSize: 15,
    fontWeight: "800",
  },
  verifyIntro: {
    marginTop: 28,
    color: "#d1d5db",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  verifyEmail: {
    marginTop: 10,
    color: ACCENT,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  nextStepsCard: {
    marginTop: 28,
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
    gap: 12,
  },
  nextStepsHeading: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 4,
  },
  stepLine: {
    color: "#e5e7eb",
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 22,
  },
  stepNum: {
    color: ACCENT,
    fontWeight: "900",
  },
  spamHint: {
    marginTop: 18,
    color: "#6b7280",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 20,
  },
  successToast: {
    marginTop: 16,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  successToastOk: {
    color: ACCENT,
  },
  feedbackErr: {
    color: "#ff6b6b",
  },
  successButtonRow: {
    marginTop: 28,
    flexDirection: "row",
    gap: 12,
    alignItems: "stretch",
  },
  btnOutline: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: ACCENT,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
    backgroundColor: "transparent",
  },
  btnOutlineText: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  btnFilled: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: ACCENT,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  btnFilledText: {
    color: "#03140c",
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  footerSuccess: {
    marginTop: 36,
    textAlign: "center",
    color: "#52525b",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
  },
  header: { alignItems: "center", marginBottom: 28 },
  logoImage: {
    width: 80,
    height: 80,
    marginBottom: 8,
    alignSelf: "center",
  },
  title: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  subtitle: {
    marginTop: 8,
    color: "#9ca3af",
    fontSize: 15,
    fontWeight: "600",
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: "#111111",
    borderRadius: 16,
    padding: 0,
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.12)",
    marginBottom: 20,
    position: "relative",
    overflow: "hidden",
  },
  tabIndicator: {
    position: "absolute",
    bottom: 0,
    width: "50%",
    height: 3,
    backgroundColor: ACCENT,
  },
  indicatorLeft: { left: 0 },
  indicatorRight: { right: 0 },
  tabOn: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 0,
  },
  tabLabel: { color: "#6b7280", fontSize: 15, fontWeight: "800" },
  tabLabelOn: { color: ACCENT },
  card: {
    backgroundColor: "#111111",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.12)",
    padding: 20,
    ...Platform.select({
      web: { boxShadow: "0 0 24px rgba(0,255,136,0.12)" },
      default: {},
    }),
  },
  fieldLabel: {
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  fieldGap: { marginTop: 16 },
  input: {
    marginTop: 8,
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.2)",
    borderRadius: 12,
    color: "#fff",
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === "ios" ? 16 : 14,
    fontWeight: "600",
  },
  passwordRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.2)",
    borderRadius: 12,
    paddingRight: 4,
  },
  passwordInput: {
    flex: 1,
    color: "#fff",
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === "ios" ? 16 : 14,
    fontWeight: "600",
  },
  eye: { paddingHorizontal: 12, paddingVertical: 10 },
  eyeText: { fontSize: 12, fontWeight: "800", color: "#9ca3af" },
  cta: {
    marginTop: 22,
    backgroundColor: ACCENT,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
    ...Platform.select({
      web: { boxShadow: "0 6px 20px rgba(0,255,136,0.28)" },
      default: {
        shadowColor: "#00ff88",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.24,
        shadowRadius: 14,
        elevation: 8,
      },
    }),
  },
  ctaMuted: { opacity: 0.55 },
  ctaText: { color: "#03140c", fontSize: 17, fontWeight: "900" },
  forgotRow: {
    marginTop: 14,
    alignItems: "center",
    minHeight: 22,
    justifyContent: "center",
  },
  linkAccent: { color: ACCENT, fontSize: 14, fontWeight: "800" },
  linkAccentSmall: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: "800",
    textDecorationLine: "underline",
  },
  loginInsteadRow: {
    marginTop: 12,
    alignItems: "center",
  },
  resendRow: { marginTop: 10, alignItems: "center" },
  infoOk: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  infoErr: {
    color: "#ff6b6b",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  infoCardOk: {
    marginTop: 14,
    backgroundColor: "rgba(0,255,136,0.1)",
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.3)",
    borderRadius: 12,
    padding: 10,
  },
  infoCardErr: {
    marginTop: 14,
    backgroundColor: "rgba(255,50,50,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,50,50,0.35)",
    borderRadius: 12,
    padding: 10,
  },
  footer: {
    marginTop: 28,
    marginBottom: 8,
    textAlign: "center",
    color: "#52525b",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
  },
  guestModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  guestModalCard: {
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.25)",
    padding: 20,
    gap: 12,
  },
  guestModalTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  guestModalBody: {
    color: "#b8c0c9",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 4,
  },
  guestModalBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  guestModalBtnPrimary: {
    backgroundColor: ACCENT,
  },
  guestModalBtnPrimaryText: {
    color: "#03140c",
    fontSize: 15,
    fontWeight: "900",
  },
  guestModalBtnGhost: {
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#333",
  },
  guestModalBtnGhostText: {
    color: "#9ca3af",
    fontSize: 15,
    fontWeight: "800",
  },
});
