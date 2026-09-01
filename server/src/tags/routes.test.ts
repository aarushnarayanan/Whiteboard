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
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

describe("tags routes", () => {
  beforeAll(async () => {
    await runMigrations();
    server = createBoardServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await db.delete(users).where(like(users.email, "tags-test-%"));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  });

  it("creates and lists a user's own tags, and rejects an unauthenticated request", async () => {
    const unauthedRes = await fetch(`${baseUrl}/tags`);
    expect(unauthedRes.status).toBe(401);

    const cookie = await signupAndGetCookie("tags-test-list@example.com");

    const createWorkRes = await fetch(`${baseUrl}/tags`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Work" }),
    });
    expect(createWorkRes.status).toBe(201);
    const work = await createWorkRes.json();
    expect(work.name).toBe("Work");

    await fetch(`${baseUrl}/tags`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "School" }),
    });

    const listRes = await fetch(`${baseUrl}/tags`, { headers: { cookie } });
    const list = await listRes.json();
    expect(list.map((t: { name: string }) => t.name)).toEqual(["Work", "School"]);
  });

  it("rejects a duplicate tag name for the same user, but allows it for a different user", async () => {
    const cookie = await signupAndGetCookie("tags-test-dup@example.com");
    const otherCookie = await signupAndGetCookie("tags-test-dup-other@example.com");

    const firstRes = await fetch(`${baseUrl}/tags`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Personal" }),
    });
    expect(firstRes.status).toBe(201);

    const dupRes = await fetch(`${baseUrl}/tags`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Personal" }),
    });
    expect(dupRes.status).toBe(409);

    const otherRes = await fetch(`${baseUrl}/tags`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: otherCookie },
      body: JSON.stringify({ name: "Personal" }),
    });
    expect(otherRes.status).toBe(201);
  });

  it("rejects creating an 11th tag", async () => {
    const cookie = await signupAndGetCookie("tags-test-cap@example.com");

    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${baseUrl}/tags`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: `Tag ${i}` }),
      });
      expect(res.status).toBe(201);
    }

    const eleventhRes = await fetch(`${baseUrl}/tags`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Tag 10" }),
    });
    expect(eleventhRes.status).toBe(400);
  });

  it("deletes a tag, and rejects deleting someone else's", async () => {
    const cookie = await signupAndGetCookie("tags-test-delete@example.com");
    const otherCookie = await signupAndGetCookie("tags-test-delete-other@example.com");

    const createRes = await fetch(`${baseUrl}/tags`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Temp" }),
    });
    const tag = await createRes.json();

    const otherDeleteRes = await fetch(`${baseUrl}/tags/${tag.id}`, {
      method: "DELETE",
      headers: { cookie: otherCookie },
    });
    expect(otherDeleteRes.status).toBe(404);

    const deleteRes = await fetch(`${baseUrl}/tags/${tag.id}`, { method: "DELETE", headers: { cookie } });
    expect(deleteRes.status).toBe(200);

    const listRes = await fetch(`${baseUrl}/tags`, { headers: { cookie } });
    const list = await listRes.json();
    expect(list.find((t: { id: string }) => t.id === tag.id)).toBeUndefined();
  });
});
