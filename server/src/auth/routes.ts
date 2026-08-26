import { Router, type CookieOptions, type Response } from "express";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { asyncHandler } from "../asyncHandler.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { hashPassword, verifyPassword } from "./password.js";
import {
  ACCESS_TOKEN_MAX_AGE_MS,
  REFRESH_TOKEN_MAX_AGE_MS,
  passwordVersion,
  signAccessToken,
  signRefreshToken,
  signResetToken,
  verifyResetToken,
  verifyToken,
} from "./jwt.js";
import { getCookie, requireAuth } from "./middleware.js";
import { sendEmail } from "../email/sendEmail.js";

function appUrl(): string {
  return process.env.APP_URL || "http://localhost:5173";
}

export const authRouter = Router();

const COOKIE_OPTS: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
};

function setSessionCookies(res: Response, userId: string) {
  res.cookie("access_token", signAccessToken({ sub: userId }), {
    ...COOKIE_OPTS,
    maxAge: ACCESS_TOKEN_MAX_AGE_MS,
  });
  res.cookie("refresh_token", signRefreshToken({ sub: userId }), {
    ...COOKIE_OPTS,
    maxAge: REFRESH_TOKEN_MAX_AGE_MS,
  });
}

authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const { email, name, password } = req.body ?? {};
    if (typeof email !== "string" || typeof name !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "email, name, and password are required" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "password must be at least 8 characters" });
      return;
    }

    const passwordHash = await hashPassword(password);
    try {
      const [user] = await db
        .insert(users)
        .values({ email, name, passwordHash })
        .returning({ id: users.id });

      setSessionCookies(res, user.id);
      res.status(201).json({ id: user.id, email, name });
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "an account with that email already exists" });
        return;
      }
      throw err;
    }
  }),
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "email and password are required" });
      return;
    }

    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      res.status(401).json({ error: "invalid email or password" });
      return;
    }

    setSessionCookies(res, user.id);
    res.status(200).json({ id: user.id, email: user.email, name: user.name });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, req.userId!));
    if (!user) {
      res.status(401).json({ error: "not signed in" });
      return;
    }
    res.json(user);
  }),
);

authRouter.post("/refresh", (req, res) => {
  const token = getCookie(req.headers.cookie, "refresh_token");
  if (!token) {
    res.status(401).json({ error: "not signed in" });
    return;
  }
  try {
    const payload = verifyToken(token);
    // ponytail: refresh token is not rotated on use; upgrade to rotation
    // (issue a new refresh token here and invalidate the old one server-side)
    // if this app ever needs to survive a leaked refresh token.
    res.cookie("access_token", signAccessToken({ sub: payload.sub }), {
      ...COOKIE_OPTS,
      maxAge: ACCESS_TOKEN_MAX_AGE_MS,
    });
    res.status(200).json({ ok: true });
  } catch {
    res.status(401).json({ error: "invalid or expired session" });
  }
});

authRouter.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const { email } = req.body ?? {};
    if (typeof email !== "string") {
      res.status(400).json({ error: "email is required" });
      return;
    }

    const [user] = await db.select().from(users).where(eq(users.email, email));
    // Always 200 regardless of whether the email matched an account — same
    // no-enumeration posture as /login (no signal for probing which emails exist).
    if (user?.passwordHash) {
      const token = signResetToken({ sub: user.id, pwv: passwordVersion(user.passwordHash) });
      const resetUrl = `${appUrl()}/reset-password?token=${token}`;
      await sendEmail({
        to: user.email,
        subject: "Reset your Whiteboard password",
        text: `Reset your password: ${resetUrl}\n\nThis link expires in 30 minutes. If you didn't request this, you can ignore this email.`,
        html: `<p><a href="${resetUrl}">Reset your Whiteboard password</a></p><p>This link expires in 30 minutes. If you didn't request this, you can ignore this email.</p>`,
      });
    }

    res.status(200).json({ ok: true });
  }),
);

authRouter.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const { token, password } = req.body ?? {};
    if (typeof token !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "token and password are required" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "password must be at least 8 characters" });
      return;
    }

    let payload;
    try {
      payload = verifyResetToken(token);
    } catch {
      res.status(400).json({ error: "invalid or expired reset link" });
      return;
    }

    const [user] = await db.select().from(users).where(eq(users.id, payload.sub));
    if (!user || !user.passwordHash || passwordVersion(user.passwordHash) !== payload.pwv) {
      // Either the account is gone, or the password already changed since this
      // link was issued — the fingerprint mismatch makes the token single-use.
      res.status(400).json({ error: "invalid or expired reset link" });
      return;
    }

    const passwordHash = await hashPassword(password);
    await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));

    setSessionCookies(res, user.id);
    res.status(200).json({ id: user.id, email: user.email, name: user.name });
  }),
);

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("access_token", COOKIE_OPTS);
  res.clearCookie("refresh_token", COOKIE_OPTS);
  res.status(200).json({ ok: true });
});

function googleRedirectUri(): string {
  return `${appUrl()}/auth/google/callback`;
}

authRouter.get("/google", (_req, res) => {
  // CSRF guard for the OAuth round trip: a random value we control on both
  // ends — sent to Google now, and required to match a short-lived cookie
  // when Google redirects back — so a forged callback request can't log
  // someone into an attacker-chosen Google account.
  const state = randomBytes(16).toString("hex");
  res.cookie("oauth_state", state, { ...COOKIE_OPTS, maxAge: 5 * 60 * 1000 });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", googleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  // Always show Google's account chooser instead of silently reusing
  // whatever Google identity is already active in the browser.
  url.searchParams.set("prompt", "select_account");
  res.redirect(url.toString());
});

// Exported for testing: the account-linking logic without the network calls
// to Google. An existing password-based account with a matching email gets
// Google sign-in linked to it rather than creating a duplicate account.
export async function findOrCreateGoogleUser(profile: {
  sub: string;
  email: string;
  name: string;
}): Promise<{ id: string; email: string; name: string }> {
  const [byGoogleId] = await db.select().from(users).where(eq(users.googleId, profile.sub));
  if (byGoogleId) return byGoogleId;

  const [byEmail] = await db.select().from(users).where(eq(users.email, profile.email));
  if (byEmail) {
    await db.update(users).set({ googleId: profile.sub }).where(eq(users.id, byEmail.id));
    return byEmail;
  }

  const [created] = await db
    .insert(users)
    .values({ email: profile.email, name: profile.name, googleId: profile.sub })
    .returning();
  return created;
}

authRouter.get(
  "/google/callback",
  asyncHandler(async (req, res) => {
    const { code, state } = req.query;
    const stateCookie = getCookie(req.headers.cookie, "oauth_state");
    res.clearCookie("oauth_state", COOKIE_OPTS);

    if (typeof code !== "string" || typeof state !== "string" || !stateCookie || state !== stateCookie) {
      res.status(400).send("Google sign-in failed: invalid or expired request. Please try again.");
      return;
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: googleRedirectUri(),
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      console.error("Google token exchange failed", tokenRes.status, await tokenRes.text());
      res.status(400).send("Google sign-in failed: couldn't exchange the authorization code. Please try again.");
      return;
    }
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { authorization: `Bearer ${access_token}` },
    });
    if (!profileRes.ok) {
      res.status(400).send("Google sign-in failed: couldn't read your Google profile. Please try again.");
      return;
    }
    const profile = (await profileRes.json()) as { sub: string; email: string; name: string };

    const user = await findOrCreateGoogleUser(profile);
    setSessionCookies(res, user.id);
    res.redirect(appUrl());
  }),
);

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "23505";
}
