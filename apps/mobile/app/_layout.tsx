import { Stack } from "expo-router";

export default function RootLayout() {
  // The (tabs) group provides its own headers and tab bar.
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#0a0a0c" },
      }}
    />
  );
}
