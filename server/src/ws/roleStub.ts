import type { IncomingMessage } from "node:http";
import { and, eq, isNull } from "drizzle-orm";
import { verifyToken } from "../auth/jwt.js";
import { getCookie } from "../auth/middleware.js";
import { db } from "../db/index.js";
import { boardMembers, boards } from "../db/schema.js";

export type BoardRole = "owner" | "editor" | "viewer";

export interface StubAuthResult {
  boardId: string;
  role: BoardRole;
}

const BOARD_PATH = /^\/ws\/boards\/([^/]+)$/;

export async function authenticateWSRequest(req: IncomingMessage): Promise<StubAuthResult | null> {
  const [path] = (req.url ?? "").split("?");
  const match = BOARD_PATH.exec(path);
  if (!match) return null;
  const boardId = match[1];

  const token = getCookie(req.headers.cookie, "access_token");
  if (!token) return null;

  let userId: string;
  try {
    userId = verifyToken(token).sub;
  } catch {
    return null;
  }

  try {
    const [membership] = await db
      .select({ role: boardMembers.role })
      .from(boardMembers)
      .innerJoin(boards, eq(boardMembers.boardId, boards.id))
      .where(and(eq(boardMembers.userId, userId), eq(boardMembers.boardId, boardId), isNull(boards.deletedAt)));
    if (!membership) return null;
    return { boardId, role: membership.role };
  } catch {
    // Malformed boardId (not a valid uuid) or a transient DB error both mean
    // "can't confirm access" — treat the same as no membership, not a crash.
    return null;
  }
}
