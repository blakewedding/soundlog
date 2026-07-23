import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
} from "react-native";
import { API_BASE_SOURCE, API_BASE_URL, login, UnauthenticatedError } from "../../src/api";
import { devTokenSource, loadDevToken, setDevToken } from "../../src/devAuth";

// Mobile auth (expo-auth-session) and the profile view are a later deliverable —
// Phase 7. Until then this tab is the placeholder in production, and a
// DEVELOPMENT-ONLY sign-in in dev so a real device can exercise the
// authenticated feed.
export default function You() {
  // `__DEV__` is a build-time constant, so the dev screen is dead-code
  // eliminated from a release bundle rather than merely hidden at runtime.
  return __DEV__ ? <DevSignIn /> : <Placeholder />;
}

function Placeholder() {
  return (
    <View style={styles.placeholder}>
      <Text style={styles.wordmark}>
        SOUND<Text style={styles.gold}>LOG</Text>
      </Text>
      <Text style={styles.sub}>Sign in and profiles arrive with mobile auth.</Text>
    </View>
  );
}

function DevSignIn() {
  const [email, setEmail] = useState("demo_blake@demo.local");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [source, setSource] = useState(devTokenSource());

  useEffect(() => {
    loadDevToken().then(() => setSource(devTokenSource()));
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { accessToken, username } = await login(email.trim(), password);
      await setDevToken(accessToken);
      setSignedInAs(username ?? email.trim());
      setPassword("");
      setSource(devTokenSource());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await setDevToken(null);
    setSignedInAs(null);
    setSource(devTokenSource());
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.form}>
      <Text style={styles.badge}>DEVELOPMENT BUILD ONLY</Text>
      <Text style={styles.title}>Sign in on this device</Text>
      <Text style={styles.sub}>
        The personal feed is authenticated by design. Real mobile auth is Phase 7 — until then this
        posts to the same /api/auth/login the web client uses and stores the token securely on the
        device, so it survives Metro restarts.
      </Text>

      <Text style={styles.label}>EMAIL</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholderTextColor="#6b675e"
      />

      <Text style={styles.label}>PASSWORD</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        placeholder="local seed password"
        placeholderTextColor="#6b675e"
        onSubmitEditing={submit}
      />

      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={submit}
        disabled={busy || !password}
      >
        {busy ? <ActivityIndicator color="#0a0a0c" /> : <Text style={styles.buttonText}>Sign in</Text>}
      </Pressable>

      {error && <Text style={styles.error}>{error}</Text>}
      {signedInAs && (
        <Text style={styles.ok}>Signed in as {signedInAs} — pull to refresh the Feed tab.</Text>
      )}

      {source !== "none" && (
        <Pressable onPress={signOut} style={styles.linkButton}>
          <Text style={styles.link}>Clear stored token</Text>
        </Pressable>
      )}

      <View style={styles.debugBox}>
        <Text style={styles.debug}>API: {API_BASE_URL}</Text>
        <Text style={styles.debug}>host rule: {API_BASE_SOURCE}</Text>
        <Text style={styles.debug}>
          token:{" "}
          {source === "device"
            ? "stored on device"
            : source === "env"
              ? "from EXPO_PUBLIC_DEV_TOKEN (lost on Metro restart)"
              : "none — the feed will ask you to sign in"}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0a0c" },
  placeholder: {
    flex: 1,
    backgroundColor: "#0a0a0c",
    alignItems: "center",
    justifyContent: "center",
  },
  form: { padding: 20, gap: 4 },
  wordmark: { color: "#edeae2", fontSize: 22, fontWeight: "800", letterSpacing: 3 },
  gold: { color: "#c8a24b" },
  badge: {
    color: "#c8a24b",
    borderColor: "#967e39",
    borderWidth: 1,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 2,
    fontSize: 10,
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  title: { color: "#edeae2", fontSize: 22, fontWeight: "700" },
  sub: { color: "#9c978b", marginTop: 4, marginBottom: 12, lineHeight: 20 },
  label: { color: "#9c978b", fontSize: 11, letterSpacing: 1.2, marginTop: 10 },
  input: {
    backgroundColor: "#1c1c21",
    borderColor: "#6b6b7a",
    borderWidth: 1,
    borderRadius: 4,
    color: "#edeae2",
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  button: {
    backgroundColor: "#c8a24b",
    borderRadius: 4,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  buttonPressed: { backgroundColor: "#e6c36a" },
  buttonText: { color: "#0a0a0c", fontWeight: "700", fontSize: 15 },
  linkButton: { minHeight: 44, justifyContent: "center" },
  link: { color: "#c8a24b", fontSize: 13 },
  error: { color: "#cf5d55", marginTop: 12 },
  ok: { color: "#8c877b", marginTop: 12 },
  debugBox: { marginTop: 28, borderTopColor: "#2a2a30", borderTopWidth: 1, paddingTop: 12, gap: 2 },
  debug: { color: "#6b675e", fontSize: 11, fontFamily: "monospace" },
});
