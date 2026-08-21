import { Router, type CookieOptions, type Response } from "express";
import { eq } from "drizzle-orm";
import { asyncHandler } from "../asyncHandler.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { hashPassword, verifyPassword } from "./password.js";
import {
  ACCESS_TOKEN_MAX_AGE_MS,
  REFRESH_TOKEN_MAX_AGE_MS,
  signAccessToken,
  signRefreshToken,
  verifyToken,
} from "./jwt.js";
import { getCookie, requireAuth } from "./middleware.js";

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

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("access_token", COOKIE_OPTS);
  res.clearCookie("refresh_token", COOKIE_OPTS);
  res.status(200).json({ ok: true });
});

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "23505";
}
