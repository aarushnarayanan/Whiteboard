import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "30d";
const RESET_TOKEN_TTL = "30m";

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
}

export interface TokenPayload {
  sub: string; // user id
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, secret(), { expiresIn: ACCESS_TOKEN_TTL });
}

export function signRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, secret(), { expiresIn: REFRESH_TOKEN_TTL });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, secret()) as TokenPayload;
}

export const ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// A short fingerprint of the user's current password hash, embedded in reset
// tokens. Once the password actually changes, this no longer matches, so a
// reset link is single-use for free — no separate token table/revocation list
// needed. The hash itself is never embedded (it'd otherwise leak into an
// email/browser history via the link).
export function passwordVersion(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("hex").slice(0, 16);
}

export interface ResetTokenPayload {
  sub: string; // user id
  pwv: string;
  purpose: "password-reset";
}

export function signResetToken(payload: Omit<ResetTokenPayload, "purpose">): string {
  return jwt.sign({ ...payload, purpose: "password-reset" }, secret(), { expiresIn: RESET_TOKEN_TTL });
}

// Distinct from verifyToken: also checks `purpose` so an access/refresh token
// (which has no such claim) can never be replayed as a password-reset token.
export function verifyResetToken(token: string): ResetTokenPayload {
  const payload = jwt.verify(token, secret()) as ResetTokenPayload;
  if (payload.purpose !== "password-reset") throw new Error("not a reset token");
  return payload;
}
