import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { AppState, Platform } from "react-native";

import { NOTIFICATIONS_ENABLED_KEY } from "../constants/storage-keys";

export { NOTIFICATIONS_ENABLED_KEY };

const ANDROID_DAILY_CHANNEL_ID = "paisawise-daily-reminder";
const NOTIFICATION_ACCENT_COLOR = "#00FF88";

const DAILY_REMINDER_BODIES = [
  "PaisaWise wait kar raha hai! 👀",
  "Kal pachtaoge, abhi record karo! 📝",
  "Ek minute, ek expense — kar lo abhi! ⚡",
  "Budget track nahi karoge toh paisa udta rahega! 🌬️",
  "Aaj ka kharch abhi tak zero hai kya? 💸",
];

const randomBody = () => {
  const idx = Math.floor(Math.random() * DAILY_REMINDER_BODIES.length);
  return DAILY_REMINDER_BODIES[idx] ?? DAILY_REMINDER_BODIES[0];
};

const isExpoGo = Constants.executionEnvironment === "storeClient";
export const isNotificationRuntimeSupported = !isExpoGo;

const getNotificationsModule = async () => {
  if (isExpoGo) {
    return null;
  }
  const mod = await import("expo-notifications");
  return mod;
};

const configureForegroundSuppression = async () => {
  const Notifications = await getNotificationsModule();
  if (!Notifications) {
    return;
  }
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      const isForeground = AppState.currentState === "active";
      return {
        shouldShowBanner: !isForeground,
        shouldShowList: !isForeground,
        shouldPlaySound: !isForeground,
        shouldSetBadge: false,
      };
    },
  });
};

void configureForegroundSuppression();

export const requestNotificationPermission = async (): Promise<boolean> => {
  const Notifications = await getNotificationsModule();
  if (!Notifications) {
    return false;
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) {
    return true;
  }
  const requested = await Notifications.requestPermissionsAsync();
  return Boolean(requested.granted);
};

export const cancelDailyReminder = async () => {
  const Notifications = await getNotificationsModule();
  if (!Notifications) {
    return;
  }
  await Notifications.cancelAllScheduledNotificationsAsync();
};

export const scheduleDailyReminder = async () => {
  const Notifications = await getNotificationsModule();
  if (!Notifications) {
    return;
  }
  await cancelDailyReminder();

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(ANDROID_DAILY_CHANNEL_ID, {
      name: "Daily reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
      // Channel LED / light color (Android); notification accent uses `color` on content below.
      lightColor: NOTIFICATION_ACCENT_COLOR,
      enableLights: true,
    });
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: "💰 Aaj ka kharch record kiya?",
      body: randomBody(),
      sound: true,
      color: NOTIFICATION_ACCENT_COLOR,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 21,
      minute: 0,
      ...(Platform.OS === "android" ? { channelId: ANDROID_DAILY_CHANNEL_ID } : {}),
    },
  });
};

export const getNotificationsEnabled = async (): Promise<boolean> => {
  const raw = await AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY);
  return raw === "true";
};

export const setNotificationsEnabled = async (value: boolean) => {
  await AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, value ? "true" : "false");
  if (value) {
    await scheduleDailyReminder();
    return;
  }
  await cancelDailyReminder();
};
