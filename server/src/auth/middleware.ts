import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "./jwt.js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(value);
  }
  return out;
}

export function getCookie(header: string | undefined, name: string): string | undefined {
  return parseCookies(header)[name];
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = getCookie(req.headers.cookie, "access_token");
  if (!token) {
    res.status(401).json({ error: "not signed in" });
    return;
  }
  try {
    const payload = verifyToken(token);
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: "invalid or expired session" });
  }
}
