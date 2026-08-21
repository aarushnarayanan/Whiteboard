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

const TEST_EMAIL = "routes-test@example.com";

describe("auth routes", () => {
  beforeAll(async () => {
    await runMigrations();
    server = createBoardServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await db.delete(users).where(like(users.email, "routes-test%"));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  });

  it("signs up, then logs in with the same credentials", async () => {
    const signupRes = await fetch(`${baseUrl}/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL, name: "Test User", password: "correct horse battery" }),
    });
    expect(signupRes.status).toBe(201);
    const signupCookies = signupRes.headers.getSetCookie();
    expect(signupCookies.some((c) => c.startsWith("access_token="))).toBe(true);
    expect(signupCookies.some((c) => c.startsWith("refresh_token="))).toBe(true);

    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL, password: "correct horse battery" }),
    });
    expect(loginRes.status).toBe(200);
  });

  it("rejects signup with a duplicate email", async () => {
    const res = await fetch(`${baseUrl}/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL, name: "Someone Else", password: "another password" }),
    });
    expect(res.status).toBe(409);
  });

  it("rejects login with the wrong password", async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL, password: "wrong password" }),
    });
    expect(res.status).toBe(401);
  });

  it("reports the signed-in user on /me, and rejects when signed out", async () => {
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL, password: "correct horse battery" }),
    });
    const cookieHeader = loginRes.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");

    const meRes = await fetch(`${baseUrl}/auth/me`, { headers: { cookie: cookieHeader } });
    expect(meRes.status).toBe(200);
    const me = await meRes.json();
    expect(me.email).toBe(TEST_EMAIL);

    const unauthedRes = await fetch(`${baseUrl}/auth/me`);
    expect(unauthedRes.status).toBe(401);
  });

  it("refreshes a session and logs out", async () => {
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL, password: "correct horse battery" }),
    });
    const cookies = loginRes.headers.getSetCookie().map((c) => c.split(";")[0]);
    const cookieHeader = cookies.join("; ");

    const refreshRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: "POST",
      headers: { cookie: cookieHeader },
    });
    expect(refreshRes.status).toBe(200);

    const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
      method: "POST",
      headers: { cookie: cookieHeader },
    });
    expect(logoutRes.status).toBe(200);
  });
});
