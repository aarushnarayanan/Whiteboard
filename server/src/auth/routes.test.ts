import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, like } from "drizzle-orm";
import { runMigrations } from "../db/migrate.js";
import { db } from "../db/index.js";
import { boardMembers, boards, users } from "../db/schema.js";
import { pool } from "../db/pool.js";
import { createBoardServer } from "../httpServer.js";
import { passwordVersion, signAccessToken, signResetToken } from "./jwt.js";
import { hashPassword } from "./password.js";
import { findOrCreateGoogleUser } from "./routes.js";

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

  it("returns 200 from /forgot-password whether or not the email is registered (no enumeration)", async () => {
    const knownRes = await fetch(`${baseUrl}/auth/forgot-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL }),
    });
    expect(knownRes.status).toBe(200);

    const unknownRes = await fetch(`${baseUrl}/auth/forgot-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "routes-test-nobody@example.com" }),
    });
    expect(unknownRes.status).toBe(200);
  });

  it("resets a password with a valid token, and the token can't be reused afterward", async () => {
    const email = "routes-test-reset@example.com";
    const [user] = await db
      .insert(users)
      .values({ email, name: "Reset Test", passwordHash: await hashPassword("original password") })
      .returning();

    const token = signResetToken({ sub: user.id, pwv: passwordVersion(user.passwordHash!) });

    const resetRes = await fetch(`${baseUrl}/auth/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password: "brand new password" }),
    });
    expect(resetRes.status).toBe(200);
    expect(resetRes.headers.getSetCookie().some((c) => c.startsWith("access_token="))).toBe(true);

    const oldPasswordRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "original password" }),
    });
    expect(oldPasswordRes.status).toBe(401);

    const newPasswordRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "brand new password" }),
    });
    expect(newPasswordRes.status).toBe(200);

    // Same token again — the pwv fingerprint no longer matches the (now-changed) password hash.
    const replayRes = await fetch(`${baseUrl}/auth/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password: "yet another password" }),
    });
    expect(replayRes.status).toBe(400);
  });

  it("rejects garbage or malformed reset tokens", async () => {
    const res = await fetch(`${baseUrl}/auth/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "not-a-real-token", password: "whatever password" }),
    });
    expect(res.status).toBe(400);
  });

  it("findOrCreateGoogleUser creates a new account for a first-time Google sign-in", async () => {
    const profile = { sub: "google-sub-new", email: "routes-test-google-new@example.com", name: "Google New" };
    const user = await findOrCreateGoogleUser(profile);
    expect(user.email).toBe(profile.email);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row.googleId).toBe(profile.sub);
  });

  it("findOrCreateGoogleUser returns the same account on a repeat sign-in", async () => {
    const profile = { sub: "google-sub-repeat", email: "routes-test-google-repeat@example.com", name: "Google Repeat" };
    const first = await findOrCreateGoogleUser(profile);
    const second = await findOrCreateGoogleUser(profile);
    expect(second.id).toBe(first.id);
  });

  it("findOrCreateGoogleUser links Google sign-in to an existing password account with the same email", async () => {
    const email = "routes-test-google-link@example.com";
    const [existing] = await db
      .insert(users)
      .values({ email, name: "Password User", passwordHash: await hashPassword("some password") })
      .returning();

    const linked = await findOrCreateGoogleUser({ sub: "google-sub-link", email, name: "Google Name" });
    expect(linked.id).toBe(existing.id);

    const [row] = await db.select().from(users).where(eq(users.id, existing.id));
    expect(row.googleId).toBe("google-sub-link");
    expect(row.passwordHash).not.toBeNull(); // linking doesn't clear the existing password
  });

  it("reports hasPassword, and lets the user update their display name", async () => {
    const cookie = await signupAndGetCookie("routes-test-settings-name@example.com");

    const meRes = await fetch(`${baseUrl}/auth/me`, { headers: { cookie } });
    const me = await meRes.json();
    expect(me.hasPassword).toBe(true);

    const patchRes = await fetch(`${baseUrl}/auth/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "New Name" }),
    });
    expect(patchRes.status).toBe(200);

    const meAfterRes = await fetch(`${baseUrl}/auth/me`, { headers: { cookie } });
    const meAfter = await meAfterRes.json();
    expect(meAfter.name).toBe("New Name");
  });

  it("reports hasPassword: false for a google-only account, and rejects a password change for it", async () => {
    const profile = { sub: "google-sub-settings", email: "routes-test-settings-google@example.com", name: "Google Only" };
    const user = await findOrCreateGoogleUser(profile);
    const cookie = `access_token=${signAccessToken({ sub: user.id })}`;

    const meRes = await fetch(`${baseUrl}/auth/me`, { headers: { cookie } });
    const me = await meRes.json();
    expect(me.hasPassword).toBe(false);

    const changeRes = await fetch(`${baseUrl}/auth/change-password`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ currentPassword: "whatever", newPassword: "brand new password" }),
    });
    expect(changeRes.status).toBe(400);
  });

  it("changes the password given the correct current password, and rejects the wrong one", async () => {
    const email = "routes-test-settings-password@example.com";
    const cookie = await signupAndGetCookie(email, "original password 1");

    const wrongRes = await fetch(`${baseUrl}/auth/change-password`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ currentPassword: "not it", newPassword: "brand new password" }),
    });
    expect(wrongRes.status).toBe(401);

    const changeRes = await fetch(`${baseUrl}/auth/change-password`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ currentPassword: "original password 1", newPassword: "brand new password" }),
    });
    expect(changeRes.status).toBe(200);

    const oldLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "original password 1" }),
    });
    expect(oldLoginRes.status).toBe(401);

    const newLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "brand new password" }),
    });
    expect(newLoginRes.status).toBe(200);
  });

  it("deletes the account, removing solely-owned boards and clearing the session", async () => {
    const cookie = await signupAndGetCookie("routes-test-settings-delete@example.com");

    const ownedRes = await fetch(`${baseUrl}/boards`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ title: "Solely owned" }),
    });
    const owned = await ownedRes.json();

    const otherOwnerCookie = await signupAndGetCookie("routes-test-settings-delete-other@example.com");
    const sharedRes = await fetch(`${baseUrl}/boards`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: otherOwnerCookie },
      body: JSON.stringify({ title: "Shared with me" }),
    });
    const shared = await sharedRes.json();
    await fetch(`${baseUrl}/boards/${shared.id}/members`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: otherOwnerCookie },
      body: JSON.stringify({ email: "routes-test-settings-delete@example.com", role: "editor" }),
    });

    const deleteRes = await fetch(`${baseUrl}/auth/me`, { method: "DELETE", headers: { cookie } });
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.headers.getSetCookie().some((c) => c.startsWith("access_token=;"))).toBe(true);

    const [ownedBoardRow] = await db.select().from(boards).where(eq(boards.id, owned.id));
    expect(ownedBoardRow).toBeUndefined();

    const [sharedMembership] = await db
      .select()
      .from(boardMembers)
      .where(eq(boardMembers.boardId, shared.id));
    expect(sharedMembership.role).toBe("owner"); // the other owner's membership is untouched

    const meRes = await fetch(`${baseUrl}/auth/me`, { headers: { cookie } });
    expect(meRes.status).toBe(401);
  });
});

async function signupAndGetCookie(email: string, password = "correct horse battery"): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, name: "Test User", password }),
  });
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}
