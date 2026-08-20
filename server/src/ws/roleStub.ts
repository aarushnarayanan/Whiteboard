import type { IncomingMessage } from "node:http";

export type BoardRole = "editor" | "viewer";

export interface StubAuthResult {
  boardId: string;
  role: BoardRole;
}

const BOARD_PATH = /^\/ws\/boards\/([^/]+)$/;

// ponytail: role comes from a query param instead of a real session,
// since sign-in (phase 08) and permissions (phase 09) don't exist yet.
// Replace this function's body with a cookie/JWT check + a
// board_members lookup once those phases land — nothing else in the
// sync engine needs to change, they only ever see { boardId, role }.
export function authenticateWSRequest(req: IncomingMessage): StubAuthResult | null {
  const [path, query] = (req.url ?? "").split("?");
  const match = BOARD_PATH.exec(path);
  if (!match) return null;

  const role = new URLSearchParams(query ?? "").get("role");
  if (role !== "editor" && role !== "viewer") return null;

  return { boardId: match[1], role };
}
