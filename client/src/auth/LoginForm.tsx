import { useState, type FormEvent } from "react";
import { login, signup, type Me } from "../api/auth";

interface LoginFormProps {
  onAuthed: (me: Me) => void;
}

export default function LoginForm({ onAuthed }: LoginFormProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const me = mode === "signup" ? await signup(email, name, password) : await login(email, password);
      onAuthed(me);
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1>{mode === "login" ? "Log in" : "Create an account"}</h1>
        {error && <p className="auth-error">{error}</p>}

        <button type="button" className="google-button" disabled title="Coming soon">
          Continue with Google
        </button>
        <div className="auth-divider">or</div>

        {mode === "signup" && (
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        <button type="submit" disabled={submitting}>
          {mode === "login" ? "Log in" : "Sign up"}
        </button>
        <button type="button" className="link-button" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "Need an account? Sign up" : "Have an account? Log in"}
        </button>
      </form>
    </div>
  );
}
