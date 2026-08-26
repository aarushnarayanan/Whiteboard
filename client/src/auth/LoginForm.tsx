import { useState, type FormEvent } from "react";
import { forgotPassword, login, resetPassword, signup, type Me } from "../api/auth";

function initialResetToken(): string | null {
  const token = new URLSearchParams(window.location.search).get("token");
  if (token) window.history.replaceState(null, "", window.location.pathname);
  return token;
}

interface LoginFormProps {
  onAuthed: (me: Me) => void;
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.85 2.09-1.81 2.73v2.27h2.92c1.71-1.57 2.69-3.88 2.69-6.64z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.27c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33C2.44 15.98 5.48 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.7c-.18-.54-.28-1.11-.28-1.7s.1-1.16.28-1.7V4.97H.96C.35 6.17 0 7.55 0 9s.35 2.83.96 4.03l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.97l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.4 4.7A9.9 9.9 0 0112 4.5c5 0 9 4 10.5 7.5-.6 1.4-1.5 2.8-2.7 4M6.1 6.1C4 7.6 2.4 9.7 1.5 12c1.2 3 4 6 7.6 7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M1.5 12S5 4.5 12 4.5 22.5 12 22.5 12 19 19.5 12 19.5 1.5 12 1.5 12z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/** Sticky-note-and-frame composition — purely decorative, matches the design handoff. */
function BrandComposition() {
  return (
    <div className="auth-brand-art">
      <div className="auth-brand-art-frame">
        <span>FRAME</span>
      </div>
      <div className="auth-brand-art-note auth-brand-art-note-yellow">
        <div />
        <div />
        <div />
      </div>
      <div className="auth-brand-art-note auth-brand-art-note-pink">
        <div />
        <div />
      </div>
      <div className="auth-brand-art-outline" />
      <div className="auth-brand-art-note auth-brand-art-note-blue">
        <div />
        <div />
        <div />
      </div>
    </div>
  );
}

export default function LoginForm({ onAuthed }: LoginFormProps) {
  const [resetToken] = useState<string | null>(initialResetToken);
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "reset">(resetToken ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const isSignup = mode === "signup";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (isSignup && password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    setSubmitting(true);
    try {
      const me = isSignup ? await signup(email, name, password) : await login(email, password);
      onAuthed(me);
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgotSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await forgotPassword(email);
      setForgotSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    setSubmitting(true);
    try {
      const me = await resetPassword(resetToken!, password);
      onAuthed(me);
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-brand-pane">
        <div className="auth-brand-logo">
          <div className="auth-logomark">
            <span />
            <span />
          </div>
          <span className="auth-brand-name">Whiteboard</span>
        </div>

        <div>
          <h1 className="auth-brand-headline">Where your team thinks out loud.</h1>
          <p className="auth-brand-subhead">Boards, diagrams, and sticky notes — together, in real time.</p>
          <BrandComposition />
        </div>

        <div className="auth-brand-footer">
          <span>© 2026 Whiteboard</span>
          <span className="auth-inert-link" title="Not built yet">
            Privacy
          </span>
          <span className="auth-inert-link" title="Not built yet">
            Terms
          </span>
        </div>
      </div>

      <div className="auth-form-pane">
        <div className="auth-mode-toggle">
          {mode === "signup" ? (
            <span>
              Already have an account?{" "}
              <a href="#" onClick={(e) => (e.preventDefault(), setMode("login"))}>
                Log in
              </a>
            </span>
          ) : mode === "login" ? (
            <span>
              Don't have an account?{" "}
              <a href="#" onClick={(e) => (e.preventDefault(), setMode("signup"))}>
                Sign up
              </a>
            </span>
          ) : (
            <span>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setError(null);
                  setMode("login");
                }}
              >
                Back to log in
              </a>
            </span>
          )}
        </div>

        <div className="auth-form-center">
        {mode === "forgot" ? (
          <form className="auth-form" onSubmit={handleForgotSubmit}>
            <h2 className="auth-form-headline">Reset your password</h2>
            <p className="auth-form-subtext">Enter your email and we'll send you a link to reset it.</p>

            {error && <p className="auth-error">{error}</p>}

            {forgotSent ? (
              <p className="auth-form-subtext">
                If an account exists for <strong>{email}</strong>, we've sent a password reset link to it.
              </p>
            ) : (
              <>
                <label className="auth-field">
                  <span className="auth-field-label">Email address</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    required
                  />
                </label>
                <button type="submit" className="auth-submit" disabled={submitting}>
                  Send reset link
                </button>
              </>
            )}
          </form>
        ) : mode === "reset" ? (
          <form className="auth-form" onSubmit={handleResetSubmit}>
            <h2 className="auth-form-headline">Set a new password</h2>
            <p className="auth-form-subtext">Choose a new password for your account.</p>

            {error && <p className="auth-error">{error}</p>}

            <label className="auth-field">
              <span className="auth-field-label">New password</span>
              <div className="auth-password-field">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </label>

            <label className="auth-field">
              <span className="auth-field-label">Confirm new password</span>
              <input
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </label>

            <button type="submit" className="auth-submit" disabled={submitting}>
              Reset password
            </button>
          </form>
        ) : (
        <form className="auth-form" onSubmit={handleSubmit}>
          <h2 className="auth-form-headline">{isSignup ? "Create your account" : "Log in to Whiteboard"}</h2>
          <p className="auth-form-subtext">
            {isSignup ? "Start collaborating with your team in minutes." : "Welcome back! Please enter your details."}
          </p>

          {error && <p className="auth-error">{error}</p>}

          <button type="button" className="auth-google-button" disabled title="Not built yet — needs Google credentials">
            <GoogleMark />
            Continue with Google
          </button>

          <div className="auth-divider">
            <span />
            <span>or continue with email</span>
            <span />
          </div>

          {isSignup && (
            <label className="auth-field">
              <span className="auth-field-label">Full name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Lee" required />
            </label>
          )}

          <label className="auth-field">
            <span className="auth-field-label">Email address</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
            />
          </label>

          <label className="auth-field">
            <div className="auth-field-label-row">
              <span className="auth-field-label">Password</span>
              {!isSignup && (
                <a
                  href="#"
                  className="auth-forgot-link"
                  onClick={(e) => {
                    e.preventDefault();
                    setError(null);
                    setMode("forgot");
                  }}
                >
                  Forgot password?
                </a>
              )}
            </div>
            <div className="auth-password-field">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                minLength={8}
                required
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </label>

          {isSignup && (
            <label className="auth-field">
              <span className="auth-field-label">Confirm password</span>
              <input
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </label>
          )}

          {!isSignup && (
            <label className="auth-remember" title="Not built yet">
              <input type="checkbox" defaultChecked disabled />
              <span>Remember me for 30 days</span>
            </label>
          )}

          <button type="submit" className="auth-submit" disabled={submitting}>
            {isSignup ? "Create account" : "Log in"}
          </button>

          {isSignup && (
            <p className="auth-fine-print">
              By signing up, you agree to Whiteboard's{" "}
              <span className="auth-inert-link" title="Not built yet">
                Terms
              </span>{" "}
              and{" "}
              <span className="auth-inert-link" title="Not built yet">
                Privacy Policy
              </span>
              .
            </p>
          )}
        </form>
        )}
        </div>
      </div>
    </div>
  );
}
