import AsyncStorage from "@react-native-async-storage/async-storage";
import { initializeApp, getApps, getApp } from "firebase/app";
// `getReactNativePersistence` is exported on the RN auth build; default `firebase/auth` types follow the web entry.
import {
  getAuth,
  initializeAuth,
  // @ts-expect-error RN-only — persistence works at runtime in Expo native
  getReactNativePersistence,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { Platform } from "react-native";

const firebaseConfig = {
  apiKey: "AIzaSyD0Yw4xb91hF1O5zrWz7p_Mypp9osyTnhQ",
  authDomain: "paisawise-78933.firebaseapp.com",
  projectId: "paisawise-78933",
  storageBucket: "paisawise-78933.firebasestorage.app",
  messagingSenderId: "61794989011",
  appId: "1:61794989011:web:97c2225cc63a97ce04f526",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

const createAuth = () => {
  if (Platform.OS === "web") {
    return getAuth(app);
  }

  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (e: unknown) {
    const code =
      e && typeof e === "object" && "code" in e
        ? String((e as { code?: string }).code)
        : "";
    if (code === "auth/already-initialized") {
      return getAuth(app);
    }
    throw e;
  }
};

export const auth = createAuth();
export const db = getFirestore(app);
