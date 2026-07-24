import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { ApiError } from "../services/api";

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(email, password);
      else await register(username, email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 380, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1>{mode === "login" ? "Welcome back" : "Join Soundlog"}</h1>
      <form onSubmit={submit} className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {mode === "register" && (
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username (a–z, 0–9, _)"
            pattern="[A-Za-z0-9_]{3,24}"
            title="3–24 characters: letters, numbers, underscores"
            required
          />
        )}
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "register" ? "Password (10+ characters)" : "Password"}
          minLength={mode === "register" ? 10 : 1}
          required
        />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "…" : mode === "login" ? "Log in" : "Create account"}
        </button>
        {error && (
          <p className="meta" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
        {mode === "login" && (
          <Link to="/forgot-password" className="meta" style={{ textAlign: "center" }}>
            Forgot your password?
          </Link>
        )}
      </form>
      <button
        className="btn btn-ghost"
        onClick={() => {
          setMode(mode === "login" ? "register" : "login");
          setError(null);
        }}
      >
        {mode === "login" ? "New here? Create an account" : "Already a member? Log in"}
      </button>
    </div>
  );
}
