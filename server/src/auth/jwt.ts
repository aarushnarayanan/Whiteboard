import jwt from "jsonwebtoken";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "30d";

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
