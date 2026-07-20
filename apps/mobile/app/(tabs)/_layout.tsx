import { Tabs } from "expo-router";

const gold = "#c8a24b";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: "#131316" },
        headerTintColor: gold,
        tabBarStyle: { backgroundColor: "#131316", borderTopColor: "#2a2a30" },
        tabBarActiveTintColor: gold,
        tabBarInactiveTintColor: "#6b675e",
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Feed" }} />
      <Tabs.Screen name="you" options={{ title: "You" }} />
    </Tabs>
  );
}
