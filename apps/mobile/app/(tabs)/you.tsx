import { View, Text, StyleSheet } from "react-native";

// Placeholder — mobile auth (expo-auth-session) and the profile view are a
// later deliverable. The Feed tab is this phase's mobile scope.
export default function You() {
  return (
    <View style={styles.screen}>
      <Text style={styles.wordmark}>
        SOUND<Text style={styles.gold}>LOG</Text>
      </Text>
      <Text style={styles.sub}>Sign in and profiles arrive with mobile auth.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0c", alignItems: "center", justifyContent: "center" },
  wordmark: { color: "#edeae2", fontSize: 22, fontWeight: "800", letterSpacing: 3 },
  gold: { color: "#c8a24b" },
  sub: { color: "#9c978b", marginTop: 8 },
});
