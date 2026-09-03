import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useRouter } from "expo-router";
import { deleteUser, signOut } from "firebase/auth";
import { deleteDoc, doc } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    BackHandler,
    KeyboardAvoidingView,
    Linking,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth, db } from "../lib/firebase";
import {
    loadExpenses,
    parsePkrAmount,
    replaceAllExpenses
} from "../storage/expenses";
import { isGuestModeEnabled } from "../storage/guestMode";
import {
    getAgeFromDob,
    loadUserProfile,
    MONTHLY_INCOME_SYNC_KEY,
    pushUserProfileToFirestore,
    USER_PROFILE_STORAGE_KEY,
    type UserGender,
    type UserProfile,
} from "../storage/userProfile";
import {
    cancelDailyReminder,
    getNotificationsEnabled,
    isNotificationRuntimeSupported,
    requestNotificationPermission,
    scheduleDailyReminder,
    setNotificationsEnabled,
} from "../utils/notifications";

const GENDER_OPTIONS: { key: UserGender; label: string }[] = [
  { key: "male", label: "Male" },
  { key: "female", label: "Female" },
  { key: "other", label: "Other" },
];
const MIN_SALARY_PKR = 1000;
const PLACEHOLDER_GREEN = "#00ff8880";
const FIELD_BORDER = "#00ff8840";
const FIELD_BG = "#1a1a1a";
// Strip everything except digits so internal state stays parser-friendly.
const sanitizeDigits = (raw: string) => raw.replace(/[^0-9]/g, "");

// Render digits with thousands separators (e.g. "50000" -> "50,000").
const formatAmount = (raw: string) => {
  const digits = sanitizeDigits(raw);
  if (!digits) {
    return "";
  }
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

export default function ProfileScreen() {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [dobIso, setDobIso] = useState<string | null>(null);
  const [showDobPicker, setShowDobPicker] = useState(false);
  const [dobDraftDate, setDobDraftDate] = useState(new Date(2000, 0, 1));
  const [city, setCity] = useState("");
  const [gender, setGender] = useState<UserGender>("male");
  const [salaryRaw, setSalaryRaw] = useState("");
  const [budgetLimitRaw, setBudgetLimitRaw] = useState("");
  const [formError, setFormError] = useState("");
  const [salaryFieldError, setSalaryFieldError] = useState("");
  const [budgetFieldError, setBudgetFieldError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isGuestMode, setIsGuestMode] = useState(false);
  const [notificationsEnabled, setNotificationsEnabledState] = useState(false);
  const [isTogglingNotifications, setIsTogglingNotifications] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState<{
    fullName: string;
    dobIso: string | null;
    city: string;
    gender: UserGender;
    salaryRaw: string;
    budgetLimitRaw: string;
  } | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteInputText, setDeleteInputText] = useState("");
  const [isFirstTime, setIsFirstTime] = useState(false);

  const hydrate = useCallback(async () => {
    try {
      const guest = await isGuestModeEnabled();
      setIsGuestMode(guest);
      const enabled = await getNotificationsEnabled();
      setNotificationsEnabledState(enabled);
      const existing = await loadUserProfile();
      setIsFirstTime(!existing);
      if (!existing) {
        setDobIso(null);
        setFullName("");
        setCity("");
        setGender("male");
        setSalaryRaw("");
        setBudgetLimitRaw("");
        setInitialSnapshot({
          fullName: "",
          dobIso: null,
          city: "",
          gender: "male",
          salaryRaw: "",
          budgetLimitRaw: "",
        });
        return;
      }

      setFullName(existing.fullName);
      setCity(existing.city);
      setGender(existing.gender);
      setSalaryRaw(String(Math.round(existing.monthlySalary)));
      setDobIso(existing.dob);
      setBudgetLimitRaw(
        existing.monthlyBudgetLimit != null
          ? String(Math.round(existing.monthlyBudgetLimit))
          : ""
      );
      setInitialSnapshot({
        fullName: existing.fullName,
        dobIso: existing.dob,
        city: existing.city,
        gender: existing.gender,
        salaryRaw: String(Math.round(existing.monthlySalary)),
        budgetLimitRaw:
          existing.monthlyBudgetLimit != null
            ? String(Math.round(existing.monthlyBudgetLimit))
            : "",
      });
    } catch {
      // ignore hydrate errors
    }
  }, [router]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const hasUnsavedChanges = useMemo(() => {
    if (!initialSnapshot) {
      return (
        fullName.trim() !== "" ||
        city.trim() !== "" ||
        salaryRaw.trim() !== "" ||
        budgetLimitRaw.trim() !== "" ||
        dobIso !== null
      );
    }
    return (
      fullName.trim() !== initialSnapshot.fullName.trim() ||
      city.trim() !== initialSnapshot.city.trim() ||
      salaryRaw.trim() !== initialSnapshot.salaryRaw.trim() ||
      budgetLimitRaw.trim() !== initialSnapshot.budgetLimitRaw.trim() ||
      gender !== initialSnapshot.gender ||
      (dobIso ?? "") !== (initialSnapshot.dobIso ?? "")
    );
  }, [budgetLimitRaw, city, dobIso, fullName, gender, initialSnapshot, salaryRaw]);

  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!hasUnsavedChanges) {
        return false;
      }
      Alert.alert(
        "Discard changes?",
        "Your unsaved changes will be lost.",
        [
          { text: "Stay", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => {
              if (router.canGoBack()) {
                router.back();
                return;
              }
              router.replace("/(tabs)");
            },
          },
        ]
      );
      return true;
    });
    return () => sub.remove();
  }, [hasUnsavedChanges, router]);

  const goHome = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace("/(tabs)");
  };

  const handleLogout = async () => {
    try {
      await cancelDailyReminder();
    } catch {
      // ignore
    }
    try {
      if (!isGuestMode) {
        await signOut(auth);
      }
    } catch {
      // still leave the app auth shell
    }
    try {
      await AsyncStorage.clear();
    } catch {
      // ignore
    }
    router.replace("/welcome");
  };

  const handleSubmit = async () => {
    setFormError("");
    setSalaryFieldError("");
    setBudgetFieldError("");

    const name = fullName.trim();
    const cityTrim = city.trim();
    const salary = parsePkrAmount(salaryRaw);
    const budgetLimit = budgetLimitRaw.trim() ? parsePkrAmount(budgetLimitRaw) : null;

    if (!name) {
      setFormError("Please enter your full name.");
      return;
    }

    if (!isFirstTime && !cityTrim) {
      setFormError("Please enter your city.");
      return;
    }

    if (salary === null) {
      setFormError("Please enter a valid monthly income in PKR.");
      return;
    }
    if (!isFirstTime && budgetLimitRaw.trim() && budgetLimit === null) {
      setFormError("Please enter a valid monthly budget limit in PKR.");
      return;
    }

    if (salary <= 0) {
      setSalaryFieldError("Income must be greater than 0.");
      return;
    }

    if (salary < MIN_SALARY_PKR) {
      setSalaryFieldError("Minimum salary is PKR 1,000");
      return;
    }

    if (!isFirstTime && budgetLimit != null && budgetLimit > salary) {
      setBudgetFieldError("Budget limit cannot be greater than your income.");
      return;
    }

    let ageValue: number | null = null;
    if (!isFirstTime) {
      if (!dobIso) {
        setFormError("Please select your date of birth.");
        return;
      }
      ageValue = getAgeFromDob(dobIso);
      if (ageValue === null) {
        setFormError("Please choose a valid date of birth.");
        return;
      }
      const dobDate = new Date(dobIso);
      if (dobDate.getTime() > Date.now()) {
        setFormError("Date of birth cannot be in the future.");
        return;
      }
    }

    // Catch-all safety: if any required field is still invalid past the
    // per-field checks above, surface a generic message instead of silently
    // proceeding (or silently bailing).
    if (!name || salary === null || salary <= 0) {
      setFormError("Please fill in all required fields");
      return;
    }

    setIsSaving(true);

    try {
      const accountEmail = auth.currentUser?.email?.trim() ?? null;

      const effectiveCity = isFirstTime ? "" : cityTrim;
      const effectiveGender = isFirstTime ? "male" : gender;
      const effectiveDob = isFirstTime ? null : dobIso;
      const effectiveBudgetLimit = isFirstTime ? null : budgetLimit;

      const payload = {
        name,
        dob: effectiveDob,
        city: effectiveCity,
        salary,
        ...(effectiveBudgetLimit != null ? { monthlyBudgetLimit: effectiveBudgetLimit } : {}),
        gender: effectiveGender,
        ...(accountEmail ? { email: accountEmail } : {}),
      };

      await AsyncStorage.setItem(USER_PROFILE_STORAGE_KEY, JSON.stringify(payload));
      await AsyncStorage.setItem(MONTHLY_INCOME_SYNC_KEY, String(salary));

      const userProfile: UserProfile = {
        fullName: name,
        city: effectiveCity,
        monthlySalary: salary,
        monthlyBudgetLimit: effectiveBudgetLimit,
        gender: effectiveGender,
        dob: effectiveDob,
        age: ageValue,
        email: accountEmail,
      };
      await pushUserProfileToFirestore(userProfile);

      router.replace("/(tabs)");
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Could not save. Please try again.";
      setFormError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleDailyReminder = async (value: boolean) => {
    if (isTogglingNotifications) {
      return;
    }
    if (value && !isNotificationRuntimeSupported) {
      Alert.alert(
        "Notifications unavailable here",
        "Daily reminders need a development build or production app. Expo Go does not fully support this flow on SDK 53+."
      );
      setNotificationsEnabledState(false);
      return;
    }
    setIsTogglingNotifications(true);
    try {
      if (value) {
        const granted = await requestNotificationPermission();
        if (!granted) {
          Alert.alert(
            "Permission needed",
            "Phone ki Settings mein notifications enable karo is feature ke liye."
          );
          return;
        }
        setNotificationsEnabledState(true);
        await setNotificationsEnabled(true);
        await scheduleDailyReminder();
      } else {
        setNotificationsEnabledState(false);
        await setNotificationsEnabled(false);
        await cancelDailyReminder();
      }
    } catch {
      setNotificationsEnabledState(!value);
    } finally {
      setIsTogglingNotifications(false);
    }
  };

  const handleDeleteAccount = () => {
    if (isGuestMode) {
      Alert.alert(
        "Clear All Data",
        "This will permanently delete all your local data. This cannot be undone.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Clear",
            style: "destructive",
            onPress: () => {
              void (async () => {
                setIsDeletingAccount(true);
                try {
                  await AsyncStorage.clear();
                } catch {
                  // ignore
                }
                router.replace("/welcome");
                setIsDeletingAccount(false);
              })();
            },
          },
        ]
      );
      return;
    }

    Alert.alert(
      "Delete Account",
      "Are you sure? This will permanently delete your account and all your data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setDeleteInputText("");
            setShowDeleteModal(true);
          },
        },
      ]
    );
  };

  const confirmAccountDeletion = () => {
    if (deleteInputText !== "DELETE") {
      return;
    }
    setShowDeleteModal(false);
    setIsDeletingAccount(true);
    void (async () => {
      const uid = auth.currentUser?.uid;

      // Delete Firestore data — best effort
      if (uid) {
        await Promise.allSettled([
          deleteDoc(doc(db, `users/${uid}/data/expenses`)),
          deleteDoc(doc(db, `users/${uid}/data/profile`)),
          deleteDoc(doc(db, `users/${uid}/data/goals`)),
          deleteDoc(doc(db, `users/${uid}/data/meta`)),
        ]);
      }

      // Clear local storage — best effort
      try {
        await AsyncStorage.clear();
      } catch {
        // ignore
      }

      // Delete auth user
      try {
        if (auth.currentUser) {
          await deleteUser(auth.currentUser);
        }
        router.replace("/welcome");
      } catch (e: unknown) {
        const code =
          e && typeof e === "object" && "code" in e
            ? String((e as { code?: string }).code)
            : "";
        if (code === "auth/requires-recent-login") {
          try {
            await signOut(auth);
          } catch {
            // ignore
          }
          Alert.alert(
            "Security Check Required",
            "Please sign in again and retry account deletion for security.",
            [{ text: "OK", onPress: () => router.replace("/welcome") }]
          );
        } else {
          Alert.alert("Error", "Could not delete account. Please try again.");
        }
      } finally {
        setIsDeletingAccount(false);
      }
    })();
  };

  const handleResetCurrentMonth = () => {
    Alert.alert(
      "Reset Current Month",
      "Are you sure? This will delete all expenses for this month. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                const allExpenses = await loadExpenses();
                const now = new Date();
                const filtered = allExpenses.filter((expense) => {
                  const d = new Date(expense.date);
                  if (Number.isNaN(d.getTime())) {
                    return true;
                  }
                  const sameMonth =
                    d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                  return !sameMonth;
                });
                await replaceAllExpenses(filtered);
                Alert.alert("✅ Month reset successfully");
              } catch {
                Alert.alert("Could not reset month", "Please try again.");
              }
            })();
          },
        },
      ]
    );
  };

  const isEditMode = router.canGoBack();
  const pageTitle = isFirstTime
    ? "Quick Setup"
    : isEditMode
      ? "Edit Profile"
      : "Set up your profile";
  const selectedDobDate = dobIso ? new Date(dobIso) : new Date(2000, 0, 1);
  const selectedDobAge = getAgeFromDob(dobIso);
  const selectedDobLabel =
    dobIso && !Number.isNaN(new Date(dobIso).getTime())
      ? new Date(dobIso).toLocaleDateString("en-PK", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "Select date of birth";

  const openDobPicker = () => {
    setDobDraftDate(selectedDobDate);
    setShowDobPicker(true);
  };

  const confirmDobPicker = () => {
    setDobIso(dobDraftDate.toISOString());
    if (formError) {
      setFormError("");
    }
    setShowDobPicker(false);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        style={styles.keyboardRoot}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={
          Platform.OS === "ios" ? 8 : (StatusBar.currentHeight ?? 0) + 8
        }
      >
        <View style={styles.rootColumn}>
          <View style={styles.headerBar}>
            {router.canGoBack() ? (
              <Pressable onPress={goHome} style={styles.backOnHero} hitSlop={8}>
                <Text  style={styles.backButtonText}>← Back</Text>
              </Pressable>
            ) : (
              <View />
            )}
            <Text
              
              style={styles.pageTitle}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.65}
            >
              {pageTitle}
            </Text>
            <View style={styles.headerSpacer} />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {isFirstTime ? (
              <Text  style={styles.fieldHelper}>
                Baaki details baad mein add kar sakte ho
              </Text>
            ) : null}
            <Text  style={styles.sectionMicro}>Personal Info</Text>
            <View style={styles.fieldsStack}>
              <Text  style={styles.fieldLabel}>Full Name</Text>
              <View style={styles.fieldRow}>
                <TextInput
                  accessibilityLabel="Full name"
                  value={fullName}
                  maxLength={30}
                  onChangeText={(text) => {
                    setFullName(text);
                    if (formError) {
                      setFormError("");
                    }
                  }}
                  placeholder="Full name"
                  placeholderTextColor={PLACEHOLDER_GREEN}
                  autoCapitalize="words"
                  style={styles.fieldInput}
                />
              </View>

              <View style={styles.fieldRow}>
                <View style={styles.ageLockedBody}>
                  <View style={styles.ageLockedTopRow}>
                    <Text  style={[styles.ageLockedValue, styles.emailLockedText]} numberOfLines={1}>
                      {auth.currentUser?.email ?? "Guest mode (no account yet)"}
                    </Text>
                    <Text  style={styles.ageLockGlyph}>{auth.currentUser ? "LOCK" : "GUEST"}</Text>
                  </View>
                  <Text  style={styles.ageLockNote}>
                    {auth.currentUser
                      ? "Email cannot be changed"
                      : "Create an account to sync across devices"}
                  </Text>
                </View>
              </View>

              {!isFirstTime ? (
                <>
                  <Text  style={styles.fieldLabel}>Date of Birth</Text>
                  <View style={styles.fieldRow}>
                    <Pressable
                      accessibilityLabel="Date of birth"
                      style={styles.dobPressable}
                      onPress={openDobPicker}
                    >
                      <Text  style={styles.dobText}>{selectedDobLabel}</Text>
                      <Text  style={styles.dobAgeText}>
                        {selectedDobAge != null ? `Age ${selectedDobAge}` : "Age will auto-calculate"}
                      </Text>
                    </Pressable>
                    <View style={styles.calendarBadge}>
                      <Text  style={styles.calendarBadgeText}>DOB</Text>
                    </View>
                  </View>
                </>
              ) : null}

            </View>

            <Text  style={styles.sectionMicro}>Budget Setup</Text>
            <View style={styles.fieldsStack}>
              {!isFirstTime ? (
                <>
                  <Text  style={styles.fieldLabel}>City</Text>
                  <View style={styles.fieldRow}>
                    <TextInput
                      accessibilityLabel="City"
                      value={city}
                      onChangeText={(text) => {
                        setCity(text);
                        if (formError) {
                          setFormError("");
                        }
                      }}
                      placeholder="City"
                      placeholderTextColor={PLACEHOLDER_GREEN}
                      autoCapitalize="words"
                      style={styles.fieldInput}
                    />
                  </View>

                  <View style={styles.genderSection}>
                    <Text  style={styles.fieldLabel}>Gender</Text>
                    <View style={styles.genderChips}>
                      {GENDER_OPTIONS.map(({ key, label }) => {
                        const selected = gender === key;
                        return (
                          <Pressable
                            key={key}
                            onPress={() => {
                              setGender(key);
                              if (formError) {
                                setFormError("");
                              }
                            }}
                            style={[
                              styles.genderChip,
                              selected ? styles.genderChipSelected : styles.genderChipUnselected,
                            ]}
                          >
                            <Text 
                              style={[
                                styles.genderChipText,
                                selected
                                  ? styles.genderChipTextSelected
                                  : styles.genderChipTextUnselected,
                              ]}
                              numberOfLines={2}
                            >
                              {label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                </>
              ) : null}

              <Text  style={styles.fieldLabel}>Monthly Income (PKR)</Text>
              <View style={styles.fieldRow}>
                <TextInput
                  accessibilityLabel="Monthly income PKR"
                  value={formatAmount(salaryRaw)}
                  onChangeText={(text) => {
                    setSalaryRaw(sanitizeDigits(text));
                    if (formError) {
                      setFormError("");
                    }
                    if (salaryFieldError) {
                      setSalaryFieldError("");
                    }
                  }}
                  placeholder="Monthly Income (PKR)"
                  placeholderTextColor={PLACEHOLDER_GREEN}
                  keyboardType="decimal-pad"
                  style={styles.fieldInput}
                />
              </View>
              {salaryFieldError ? (
                <Text  style={styles.inlineFieldError}>{salaryFieldError}</Text>
              ) : null}

              {!isFirstTime ? (
                <>
                  <Text  style={styles.fieldLabel}>Monthly Budget Limit (PKR)</Text>
                  <View style={styles.fieldRow}>
                    <TextInput
                      accessibilityLabel="Monthly budget limit PKR"
                      value={formatAmount(budgetLimitRaw)}
                      onChangeText={(text) => {
                        setBudgetLimitRaw(sanitizeDigits(text));
                        if (formError) {
                          setFormError("");
                        }
                        if (budgetFieldError) {
                          setBudgetFieldError("");
                        }
                      }}
                      placeholder="Budget limit (PKR)"
                      placeholderTextColor={PLACEHOLDER_GREEN}
                      keyboardType="decimal-pad"
                      style={styles.fieldInput}
                    />
                  </View>
                  <Text  style={styles.fieldHelper}>
                    Leave empty to use 80% of income
                  </Text>
                  {budgetFieldError ? (
                    <Text  style={styles.inlineFieldError}>{budgetFieldError}</Text>
                  ) : null}

                  <View style={styles.reminderRow}>
                    <View style={styles.reminderTextWrap}>
                      <Text  style={styles.reminderTitle}>Daily Reminder</Text>
                      <Text  style={styles.reminderSubtitle}>
                        Roz raat 9:00 PM pe kharch record reminder
                      </Text>
                    </View>
                    <Switch
                      value={notificationsEnabled}
                      onValueChange={(value) => {
                        void handleToggleDailyReminder(value);
                      }}
                      disabled={isTogglingNotifications}
                      trackColor={{ false: "#374151", true: "#00ff88" }}
                      thumbColor={notificationsEnabled ? "#04170f" : "#f9fafb"}
                    />
                  </View>
                </>
              ) : null}
            </View>

            {formError ? <Text  style={styles.errorText}>{formError}</Text> : null}

            <TouchableOpacity
              activeOpacity={0.92}
              style={[styles.ctaButton, isSaving && styles.ctaButtonDisabled]}
              onPress={() => {
                void handleSubmit();
              }}
              disabled={isSaving}
            >
              <Text  style={styles.ctaButtonText}>
                {isSaving ? "Saving…" : "Let's Go 🚀"}
              </Text>
            </TouchableOpacity>

            {isGuestMode ? (
              <Pressable
                onPress={() => router.push("/login?tab=register&fromGuest=1")}
                style={styles.upgradePressable}
              >
                <Text  style={styles.upgradeText}>Sign up to back up this data →</Text>
              </Pressable>
            ) : null}

            <View style={styles.settingsBlock}>

              {/* ACCOUNT */}
              <View style={styles.settingsSectionHeader}>
                <Text style={styles.settingsSectionHeaderText}>ACCOUNT</Text>
                <View style={styles.settingsSectionHeaderLine} />
              </View>
              <Pressable
                style={({ pressed }) => [styles.settingsRow, styles.settingsRowLast, pressed && styles.settingsRowPressed]}
                onPress={() => {
                  void handleLogout();
                }}
              >
                <Text style={styles.settingsRowIcon}>🚪</Text>
                <Text style={[styles.settingsRowLabel, styles.settingsRowLabelLogout]}>
                  {isGuestMode ? "Exit guest mode" : "Logout"}
                </Text>
                <Text style={styles.settingsRowChevron}>›</Text>
              </Pressable>

              {/* DATA */}
              <View style={[styles.settingsSectionHeader, { marginTop: 24 }]}>
                <Text style={styles.settingsSectionHeaderText}>DATA</Text>
                <View style={styles.settingsSectionHeaderLine} />
              </View>
              <Pressable
                style={({ pressed }) => [styles.settingsRow, styles.settingsRowLast, pressed && styles.settingsRowPressed]}
                onPress={handleResetCurrentMonth}
              >
                <Text style={styles.settingsRowIcon}>🔄</Text>
                <Text style={[styles.settingsRowLabel, styles.settingsRowLabelReset]}>Reset Current Month</Text>
                <Text style={styles.settingsRowChevron}>›</Text>
              </Pressable>

              {/* LEGAL */}
              <View style={[styles.settingsSectionHeader, { marginTop: 24 }]}>
                <Text style={styles.settingsSectionHeaderText}>LEGAL</Text>
                <View style={styles.settingsSectionHeaderLine} />
              </View>
              <Pressable
                style={({ pressed }) => [styles.settingsRow, styles.settingsRowLast, pressed && styles.settingsRowPressed]}
                onPress={() => Linking.openURL('https://forest-basil-446.notion.site/PaisaWise-Privacy-Policy-3641da6a734380bbaae8e094431d7414')}
              >
                <Text style={styles.settingsRowIcon}>📄</Text>
                <Text style={[styles.settingsRowLabel, styles.settingsRowLabelPrivacy]}>Privacy Policy</Text>
                <Text style={styles.settingsRowChevron}>›</Text>
              </Pressable>

              {/* DANGER ZONE */}
              <View style={[styles.settingsSectionHeader, { marginTop: 24 }]}>
                <Text style={styles.settingsSectionHeaderText}>DANGER ZONE</Text>
                <View style={styles.settingsSectionHeaderLine} />
              </View>
              <Pressable
                style={({ pressed }) => [styles.settingsRow, styles.settingsRowLast, pressed && styles.settingsRowPressed]}
                onPress={handleDeleteAccount}
                disabled={isDeletingAccount}
              >
                <Text style={styles.settingsRowIcon}>⚠️</Text>
                {isDeletingAccount ? (
                  <ActivityIndicator size="small" color="#ff4444" style={{ flex: 1 }} />
                ) : (
                  <Text style={[styles.settingsRowLabel, styles.settingsRowLabelDelete]}>
                    {isGuestMode ? "Clear All Data" : "Delete Account"}
                  </Text>
                )}
                <Text style={styles.settingsRowChevron}>›</Text>
              </Pressable>

            </View>
          </ScrollView>

          <Text  style={styles.footerNote}>Your data is stored on your device</Text>
        </View>
      </KeyboardAvoidingView>
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <View style={styles.deleteModalOverlay}>
          <View style={styles.deleteModalSheet}>
            <Text  style={styles.deleteModalTitle}>Confirm Account Deletion</Text>
            <Text  style={styles.deleteModalBody}>
              Type <Text style={styles.deleteModalKeyword}>DELETE</Text> to permanently delete your account and all data.
            </Text>
            <TextInput
              value={deleteInputText}
              onChangeText={setDeleteInputText}
              placeholder="Type DELETE here"
              placeholderTextColor="#6b7280"
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.deleteModalInput}
            />
            <View style={styles.deleteModalActions}>
              <Pressable
                onPress={() => setShowDeleteModal(false)}
                style={[styles.deleteModalButton, styles.deleteModalCancelButton]}
              >
                <Text  style={styles.deleteModalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={confirmAccountDeletion}
                style={[
                  styles.deleteModalButton,
                  styles.deleteModalConfirmButton,
                  deleteInputText !== "DELETE" && styles.deleteModalConfirmDisabled,
                ]}
                disabled={deleteInputText !== "DELETE"}
              >
                <Text  style={styles.deleteModalConfirmText}>Delete Forever</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {Platform.OS === "ios" ? (
        <Modal
          visible={showDobPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowDobPicker(false)}
        >
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerSheet}>
              <DateTimePicker
                value={dobDraftDate}
                mode="date"
                display="spinner"
                maximumDate={new Date()}
                onChange={(_, date) => {
                  if (date) {
                    setDobDraftDate(date);
                  }
                }}
              />
              <View style={styles.pickerActions}>
                <Pressable
                  onPress={() => setShowDobPicker(false)}
                  style={[styles.pickerActionButton, styles.pickerCancelButton]}
                >
                  <Text  style={styles.pickerCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={confirmDobPicker}
                  style={[styles.pickerActionButton, styles.pickerConfirmButton]}
                >
                  <Text  style={styles.pickerConfirmText}>Confirm ✓</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : showDobPicker ? (
        <DateTimePicker
          value={dobDraftDate}
          mode="date"
          display="default"
          maximumDate={new Date()}
          onChange={(event, date) => {
            setShowDobPicker(false);
            if (event.type === "set" && date) {
              setDobIso(date.toISOString());
              if (formError) {
                setFormError("");
              }
            }
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#111111",
  },
  keyboardRoot: {
    flex: 1,
    backgroundColor: "#111111",
    paddingTop: 18,
  },
  rootColumn: {
    flex: 1,
    backgroundColor: "#111111",
  },
  heroCard: { display: "none" },
  headerBar: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backOnHero: {
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  backButtonText: {
    color: "#00ff88",
    fontSize: 16,
    fontWeight: "800",
  },
  pageTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  headerSpacer: {
    width: 48,
  },
  heroInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingTop: 44,
  },
  heroEmoji: {
    fontSize: 60,
    lineHeight: 68,
    marginBottom: 12,
  },
  brandTitle: {
    color: "#ffffff",
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  brandTagline: {
    marginTop: 8,
    color: "#8b939e",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 18,
    maxWidth: 280,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    flexGrow: 1,
  },
  sectionMicro: {
    color: "#00ff88",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    marginBottom: 8,
    marginTop: 4,
  },
  fieldsStack: {
    gap: 12,
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.12)",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  genderSection: {
    gap: 8,
  },
  fieldLabel: {
    color: "#00ff8899",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
    marginTop: 2,
  },
  fieldHelper: {
    color: "#6b7280",
    fontSize: 12,
    fontWeight: "500",
    marginTop: 6,
    marginBottom: 2,
    fontStyle: "italic",
  },
  genderLabel: {
    color: "#8b939e",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
    marginBottom: 2,
  },
  genderChips: {
    flexDirection: "row",
    gap: 8,
  },
  genderChip: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  genderChipSelected: {
    backgroundColor: "#00ff88",
  },
  genderChipUnselected: {
    backgroundColor: FIELD_BG,
    borderWidth: 1,
    borderColor: FIELD_BORDER,
  },
  genderChipText: {
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 16,
  },
  genderChipTextSelected: {
    color: "#000000",
  },
  genderChipTextUnselected: {
    color: "#8b939e",
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.2)",
    borderRadius: 12,
    paddingVertical: 0,
    paddingHorizontal: 12,
    gap: 10,
  },
  fieldInput: {
    flex: 1,
    minHeight: 54,
    paddingVertical: 14,
    paddingHorizontal: 8,
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
    backgroundColor: "transparent",
  },
  reminderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.2)",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 10,
  },
  reminderTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  reminderTitle: {
    color: "#e5e7eb",
    fontSize: 15,
    fontWeight: "800",
  },
  reminderSubtitle: {
    color: "#8b939e",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 3,
  },
  ageLockedBody: {
    flex: 1,
    paddingVertical: 6,
    gap: 4,
  },
  ageLockedTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  ageLockedValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#8b939e",
  },
  emailLockedText: {
    flex: 1,
    minWidth: 0,
  },
  ageLockGlyph: {
    fontSize: 10,
    fontWeight: "800",
    color: "#6b7280",
  },
  ageLockNote: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6b7280",
    letterSpacing: 0.1,
  },
  errorText: {
    color: "#ff6b6b",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 14,
    marginBottom: 4,
    textAlign: "center",
  },
  inlineFieldError: {
    color: "#ff6b6b",
    fontSize: 12,
    fontWeight: "700",
    marginTop: -4,
    marginBottom: 2,
    marginLeft: 4,
  },
  ctaButton: {
    marginTop: 22,
    width: "100%",
    alignSelf: "stretch",
    borderRadius: 14,
    backgroundColor: "#00ff88",
    paddingVertical: 17,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      web: {
        boxShadow: "0 10px 28px rgba(0, 255, 136, 0.4)",
      },
      default: {
        shadowColor: "#00ff88",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.45,
        shadowRadius: 20,
        elevation: 14,
      },
    }),
  },
  ctaButtonDisabled: {
    opacity: 0.65,
  },
  ctaButtonText: {
    color: "#000000",
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  upgradePressable: {
    marginTop: 16,
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  upgradeText: {
    color: "#00ff88",
    fontSize: 14,
    fontWeight: "800",
  },
  logoutPressable: {
    marginTop: 28,
    alignItems: "center",
    paddingVertical: 10,
  },
  logoutText: {
    color: "#ff6b6b",
    fontSize: 14,
    fontWeight: "800",
  },
  resetMonthPressable: {
    marginTop: 8,
    alignItems: "center",
    paddingVertical: 10,
  },
  resetMonthText: {
    color: "#f59e0b",
    fontSize: 14,
    fontWeight: "800",
  },
  footerNote: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 12,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
    color: "#6b7280",
    letterSpacing: 0.15,
  },
  dobPressable: {
    flex: 1,
    minHeight: 54,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  dobText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  dobAgeText: {
    marginTop: 2,
    color: "#8b939e",
    fontSize: 12,
    fontWeight: "600",
  },
  calendarBadge: {
    minWidth: 48,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(0,255,136,0.4)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  calendarBadgeText: {
    color: "#00ff88",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.2,
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
  privacyPolicyPressable: {
    marginTop: 8,
    alignItems: "center",
    paddingVertical: 10,
  },
  privacyPolicyText: {
    color: "#6b7280",
    fontSize: 13,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  deleteAccountPressable: {
    marginTop: 4,
    marginBottom: 8,
    alignItems: "center",
    paddingVertical: 10,
    minHeight: 36,
    justifyContent: "center",
  },
  deleteAccountText: {
    color: "#ff4444",
    fontSize: 14,
    fontWeight: "800",
  },
  deleteModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  deleteModalSheet: {
    backgroundColor: "#1a1a1a",
    borderRadius: 18,
    padding: 24,
    width: "100%",
    borderWidth: 1,
    borderColor: "rgba(255,68,68,0.3)",
  },
  deleteModalTitle: {
    color: "#ff4444",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 10,
    textAlign: "center",
  },
  deleteModalBody: {
    color: "#d1d5db",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
    marginBottom: 18,
    textAlign: "center",
  },
  deleteModalKeyword: {
    color: "#ff4444",
    fontWeight: "900",
  },
  deleteModalInput: {
    backgroundColor: "#111111",
    borderWidth: 1,
    borderColor: "rgba(255,68,68,0.4)",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 18,
    textAlign: "center",
    letterSpacing: 2,
  },
  deleteModalActions: {
    flexDirection: "row",
    gap: 10,
  },
  deleteModalButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  deleteModalCancelButton: {
    backgroundColor: "#242424",
    borderColor: "#383838",
  },
  deleteModalCancelText: {
    color: "#d1d5db",
    fontSize: 15,
    fontWeight: "800",
  },
  deleteModalConfirmButton: {
    backgroundColor: "#ff4444",
    borderColor: "#ff6666",
  },
  deleteModalConfirmDisabled: {
    opacity: 0.35,
  },
  deleteModalConfirmText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
  },
  settingsBlock: {
    marginTop: 28,
  },
  settingsSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 18,
    marginBottom: 4,
    paddingHorizontal: 4,
    gap: 10,
  },
  settingsSectionHeaderText: {
    color: "#666666",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  settingsSectionHeaderLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#1f1f1f",
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#161616",
    gap: 12,
  },
  settingsRowLast: {
    borderBottomWidth: 0,
  },
  settingsRowPressed: {
    opacity: 0.6,
  },
  settingsRowIcon: {
    fontSize: 18,
  },
  settingsRowLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
  },
  settingsRowLabelLogout: {
    color: "#ff8a4c",
  },
  settingsRowLabelReset: {
    color: "#f5cf54",
  },
  settingsRowLabelPrivacy: {
    color: "#9ca3af",
  },
  settingsRowLabelDelete: {
    color: "#ff4444",
  },
  settingsRowChevron: {
    color: "#4b5563",
    fontSize: 22,
    fontWeight: "300",
  },
});
