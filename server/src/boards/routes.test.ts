import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { like } from "drizzle-orm";
import { runMigrations } from "../db/migrate.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { pool } from "../db/pool.js";
import { createBoardServer } from "../httpServer.js";

let server: Server;
let baseUrl: string;

async function signupAndGetCookie(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, name: "Test User", password: "correct horse battery" }),
  });
  const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]);
  return cookies.join("; ");
}

describe("boards routes", () => {
  beforeAll(async () => {
    await runMigrations();
    server = createBoardServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await db.delete(users).where(like(users.email, "boards-test-%"));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  });

  it("rejects unauthenticated requests", async () => {
    const res = await fetch(`${baseUrl}/boards`);
    expect(res.status).toBe(401);
  });

  it("creates a board, lists it under the creator, and lets them share it", async () => {
    const ownerCookie = await signupAndGetCookie("boards-test-owner@example.com");
    const editorCookie = await signupAndGetCookie("boards-test-editor@example.com");

    const createRes = await fetch(`${baseUrl}/boards`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ title: "Q3 Planning" }),
    });
    expect(createRes.status).toBe(201);
    const board = await createRes.json();
    expect(board.role).toBe("owner");
    expect(board.title).toBe("Q3 Planning");

    const ownerListRes = await fetch(`${baseUrl}/boards`, { headers: { cookie: ownerCookie } });
    const ownerBoards = await ownerListRes.json();
    expect(ownerBoards).toContainEqual(expect.objectContaining({ id: board.id, role: "owner" }));

    const editorListBeforeRes = await fetch(`${baseUrl}/boards`, { headers: { cookie: editorCookie } });
    const editorBoardsBefore = await editorListBeforeRes.json();
    expect(editorBoardsBefore.find((b: { id: string }) => b.id === board.id)).toBeUndefined();

    const inviteRes = await fetch(`${baseUrl}/boards/${board.id}/members`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ email: "boards-test-editor@example.com", role: "editor" }),
    });
    expect(inviteRes.status).toBe(200);

    const editorListAfterRes = await fetch(`${baseUrl}/boards`, { headers: { cookie: editorCookie } });
    const editorBoardsAfter = await editorListAfterRes.json();
    expect(editorBoardsAfter).toContainEqual(expect.objectContaining({ id: board.id, role: "editor" }));
  });

  it("rejects a non-owner trying to invite someone", async () => {
    const ownerCookie = await signupAndGetCookie("boards-test-owner2@example.com");
    const editorCookie = await signupAndGetCookie("boards-test-editor2@example.com");
    const outsiderCookie = await signupAndGetCookie("boards-test-outsider@example.com");

    const createRes = await fetch(`${baseUrl}/boards`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ title: "Locked board" }),
    });
    const board = await createRes.json();

    await fetch(`${baseUrl}/boards/${board.id}/members`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ email: "boards-test-editor2@example.com", role: "editor" }),
    });

    const res = await fetch(`${baseUrl}/boards/${board.id}/members`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: editorCookie },
      body: JSON.stringify({ email: "boards-test-outsider@example.com", role: "viewer" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects inviting an email with no account", async () => {
    const ownerCookie = await signupAndGetCookie("boards-test-owner3@example.com");
    const createRes = await fetch(`${baseUrl}/boards`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ title: "Board" }),
    });
    const board = await createRes.json();

    const res = await fetch(`${baseUrl}/boards/${board.id}/members`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ email: "nobody-boards-test@example.com", role: "viewer" }),
    });
    expect(res.status).toBe(404);
  });

  it("accepts and returns a thumbnail", async () => {
    const ownerCookie = await signupAndGetCookie("boards-test-owner4@example.com");
    const createRes = await fetch(`${baseUrl}/boards`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ title: "Board" }),
    });
    const board = await createRes.json();

    // A minimal 1x1 transparent PNG, base64-encoded — real content doesn't matter here.
    const tinyPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    const thumbRes = await fetch(`${baseUrl}/boards/${board.id}/thumbnail`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ thumbnail: tinyPng }),
    });
    expect(thumbRes.status).toBe(200);

    const listRes = await fetch(`${baseUrl}/boards`, { headers: { cookie: ownerCookie } });
    const listed = await listRes.json();
    const found = listed.find((b: { id: string }) => b.id === board.id);
    expect(found.thumbnail).toBe(tinyPng);
  });
});
