import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { IncomingMessage } from "node:http";
import { eq } from "drizzle-orm";
import { signAccessToken } from "../auth/jwt.js";
import { runMigrations } from "../db/migrate.js";
import { db } from "../db/index.js";
import { boardMembers, boards, users } from "../db/schema.js";
import { pool } from "../db/pool.js";
import { authenticateWSRequest } from "./roleStub.js";

function req(url: string, cookie?: string): IncomingMessage {
  return { url, headers: cookie ? { cookie } : {} } as IncomingMessage;
}

describe("authenticateWSRequest", () => {
  let userId: string;
  let boardId: string;
  let cookie: string;

  beforeAll(async () => {
    await runMigrations();
    const [user] = await db
      .insert(users)
      .values({ email: "rolestub-test@example.com", name: "Test", passwordHash: "x" })
      .returning();
    const [board] = await db.insert(boards).values({}).returning();
    await db.insert(boardMembers).values({ userId: user.id, boardId: board.id, role: "editor" });
    userId = user.id;
    boardId = board.id;
    cookie = `access_token=${signAccessToken({ sub: user.id })}`;
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.email, "rolestub-test@example.com"));
    await pool.end();
  });

  it("resolves a real member's role from their session cookie", async () => {
    const result = await authenticateWSRequest(req(`/ws/boards/${boardId}`, cookie));
    expect(result).toEqual({ boardId, role: "editor" });
  });

  it("rejects a missing cookie", async () => {
    expect(await authenticateWSRequest(req(`/ws/boards/${boardId}`))).toBeNull();
  });

  it("rejects a tampered/invalid token", async () => {
    expect(await authenticateWSRequest(req(`/ws/boards/${boardId}`, "access_token=not-a-real-token"))).toBeNull();
  });

  it("rejects a user with no membership on that board", async () => {
    const [otherUser] = await db
      .insert(users)
      .values({ email: "rolestub-test-2@example.com", name: "Test 2", passwordHash: "x" })
      .returning();
    const otherCookie = `access_token=${signAccessToken({ sub: otherUser.id })}`;
    expect(await authenticateWSRequest(req(`/ws/boards/${boardId}`, otherCookie))).toBeNull();
    await db.delete(users).where(eq(users.email, "rolestub-test-2@example.com"));
  });

  it("rejects a malformed board id without crashing", async () => {
    expect(await authenticateWSRequest(req("/ws/boards/not-a-uuid", cookie))).toBeNull();
  });

  it("rejects a non-matching path", async () => {
    expect(await authenticateWSRequest(req("/health", cookie))).toBeNull();
  });

  it("rejects a member of a trashed board", async () => {
    const [trashedBoard] = await db.insert(boards).values({ deletedAt: new Date() }).returning();
    await db.insert(boardMembers).values({ userId, boardId: trashedBoard.id, role: "owner" });
    expect(await authenticateWSRequest(req(`/ws/boards/${trashedBoard.id}`, cookie))).toBeNull();
  });
});
