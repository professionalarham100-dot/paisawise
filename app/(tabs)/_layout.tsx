import { Tabs } from "expo-router";
import { Text } from "react-native";

/**
 * Tab-bar layout for the 5 primary screens. Anything outside this route
 * group (welcome, login, profile, onboarding, privacy-policy) renders
 * full-screen via the root Stack and never shows the tab bar.
 */
const tabIcon = (emoji: string) => {
  const TabBarIcon = ({ color }: { color: string }) => (
    <Text style={{ fontSize: 20, color }}>{emoji}</Text>
  );
  TabBarIcon.displayName = `TabBarIcon(${emoji})`;
  return TabBarIcon;
};

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#0a0a0a",
          borderTopColor: "rgba(0,255,136,0.15)",
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: "#00ff88",
        tabBarInactiveTintColor: "#4a5568",
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Home", tabBarIcon: tabIcon("🏠") }}
      />
      <Tabs.Screen
        name="add-expense"
        options={{ title: "Add", tabBarIcon: tabIcon("➕") }}
      />
      <Tabs.Screen
        name="roast"
        options={{ title: "Roast", tabBarIcon: tabIcon("🔥") }}
      />
      <Tabs.Screen
        name="goals"
        options={{ title: "Goals", tabBarIcon: tabIcon("🎯") }}
      />
      <Tabs.Screen
        name="history"
        options={{ title: "History", tabBarIcon: tabIcon("📊") }}
      />
    </Tabs>
  );
}
