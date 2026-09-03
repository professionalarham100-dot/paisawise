import AsyncStorage from "@react-native-async-storage/async-storage";

const STREAK_KEY = "paisawise.streak.v1";

type StreakData = {
  currentStreak: number;
  lastLogDate: string | null;
};

export const getStreakData = async (): Promise<StreakData> => {
  try {
    const raw = await AsyncStorage.getItem(STREAK_KEY);
    if (!raw) return { currentStreak: 0, lastLogDate: null };
    return JSON.parse(raw) as StreakData;
  } catch {
    return { currentStreak: 0, lastLogDate: null };
  }
};

export const updateStreak = async (): Promise<number> => {
  const today = new Date().toISOString().slice(0, 10);
  const data = await getStreakData();

  if (data.lastLogDate === today) return data.currentStreak;

  const yesterday = new Date(Date.now() - 86400000)
    .toISOString().slice(0, 10);

  const newStreak = data.lastLogDate === yesterday
    ? data.currentStreak + 1
    : 1;

  await AsyncStorage.setItem(STREAK_KEY, JSON.stringify({
    currentStreak: newStreak,
    lastLogDate: today,
  }));

  return newStreak;
};
