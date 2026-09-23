import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { like } from "drizzle-orm";
import * as Y from "yjs";
import { runMigrations } from "../db/migrate.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { pool } from "../db/pool.js";
import { createBoardServer } from "../httpServer.js";
import { persistUpdate, loadMergedSnapshot } from "../ws/docStore.js";

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

// Seeds board content directly at the storage layer, same technique
// compaction.test.ts already uses — no WS client needed for these tests.
async function writeShape(boardId: string, doc: Y.Doc, id: string, fields: Record<string, unknown>) {
  const before = Y.encodeStateVector(doc);
  const m = new Y.Map(Object.entries(fields));
  doc.getMap("shapes").set(id, m);
  await persistUpdate(boardId, Y.encodeStateAsUpdate(doc, before));
}

describe("board versions", () => {
  beforeAll(async () => {
    await runMigrations();
    server = createBoardServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await db.delete(users).where(like(users.email, "versions-test-%"));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  });

  it("saves a named version, lists it, and previews its content read-only", async () => {
    const ownerCookie = await signupAndGetCookie("versions-test-owner1@example.com");
    const createRes = await fetch(`${baseUrl}/boards`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ title: "V1 board" }),
    });
    const board = await createRes.json();

    const doc = new Y.Doc();
    await writeShape(board.id, doc, "a", { type: "rect", x: 1 });

    const saveRes = await fetch(`${baseUrl}/boards/${board.id}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ label: "Sprint 1 planning" }),
    });
    expect(saveRes.status).toBe(201);
    const { id: versionId } = await saveRes.json();

    const listRes = await fetch(`${baseUrl}/boards/${board.id}/versions`, { headers: { cookie: ownerCookie } });
    const versions = await listRes.json();
    expect(versions).toContainEqual(expect.objectContaining({ id: versionId, label: "Sprint 1 planning" }));

    const previewRes = await fetch(`${baseUrl}/boards/${board.id}/versions/${versionId}/preview`, {
      headers: { cookie: ownerCookie },
    });
    const { shapes } = await previewRes.json();
    expect(shapes).toEqual([{ type: "rect", x: 1 }]);
  });

  it("restore reconciles the live doc to the target version, re-adding a shape deleted since, and is itself undoable", async () => {
    const ownerCookie = await signupAndGetCookie("versions-test-owner2@example.com");
    const createRes = await fetch(`${baseUrl}/boards`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ title: "Restore board" }),
    });
    const board = await createRes.json();

    const doc = new Y.Doc();
    await writeShape(board.id, doc, "a", { type: "rect" });
    const v1Res = await fetch(`${baseUrl}/boards/${board.id}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ label: "v1 — has shape a" }),
    });
    const { id: v1Id } = await v1Res.json();

    // Delete "a", add "b" — simulates the stray-deletion scenario F8 exists for.
    const beforeDelete = Y.encodeStateVector(doc);
    doc.getMap("shapes").delete("a");
    doc.getMap("shapes").set("b", new Y.Map(Object.entries({ type: "ellipse" })));
    await persistUpdate(board.id, Y.encodeStateAsUpdate(doc, beforeDelete));

    const preRestore = await loadMergedSnapshot(board.id);
    const preRestoreDoc = new Y.Doc();
    Y.applyUpdate(preRestoreDoc, new Uint8Array(preRestore!));
    expect(preRestoreDoc.getMap("shapes").toJSON()).toEqual({ b: { type: "ellipse" } });

    const restoreRes = await fetch(`${baseUrl}/boards/${board.id}/versions/${v1Id}/restore`, {
      method: "POST",
      headers: { cookie: ownerCookie },
    });
    expect(restoreRes.status).toBe(200);

    const afterRestore = await loadMergedSnapshot(board.id);
    const afterRestoreDoc = new Y.Doc();
    Y.applyUpdate(afterRestoreDoc, new Uint8Array(afterRestore!));
    // "a" is back (restored) and "b" is gone (wasn't in v1) — a naive
    // Y.applyUpdate merge would have kept "a" deleted; reconcile doesn't.
    expect(afterRestoreDoc.getMap("shapes").toJSON()).toEqual({ a: { type: "rect" } });

    // Restore is itself undoable: a safety-net auto-version of the
    // pre-restore state (with "b", without "a") now exists to go back to.
    const listRes = await fetch(`${baseUrl}/boards/${board.id}/versions`, { headers: { cookie: ownerCookie } });
    const versions: { id: string; label: string | null }[] = await listRes.json();
    const autoVersion = versions.find((v) => v.label === null);
    expect(autoVersion).toBeDefined();
    const autoPreviewRes = await fetch(`${baseUrl}/boards/${board.id}/versions/${autoVersion!.id}/preview`, {
      headers: { cookie: ownerCookie },
    });
    const { shapes: autoShapes } = await autoPreviewRes.json();
    expect(autoShapes).toEqual([{ type: "ellipse" }]);
  });

  it("rejects a viewer's attempt to save or restore a version, but allows listing and branching", async () => {
    const ownerCookie = await signupAndGetCookie("versions-test-owner3@example.com");
    const viewerCookie = await signupAndGetCookie("versions-test-viewer3@example.com");
    const createRes = await fetch(`${baseUrl}/boards`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ title: "Role-gated board" }),
    });
    const board = await createRes.json();
    await fetch(`${baseUrl}/boards/${board.id}/members`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ email: "versions-test-viewer3@example.com", role: "viewer" }),
    });

    const doc = new Y.Doc();
    await writeShape(board.id, doc, "a", { type: "rect" });
    const saveRes = await fetch(`${baseUrl}/boards/${board.id}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ label: "v1" }),
    });
    const { id: versionId } = await saveRes.json();

    const viewerSaveRes = await fetch(`${baseUrl}/boards/${board.id}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: viewerCookie },
      body: JSON.stringify({ label: "viewer's version" }),
    });
    expect(viewerSaveRes.status).toBe(403);

    const viewerRestoreRes = await fetch(`${baseUrl}/boards/${board.id}/versions/${versionId}/restore`, {
      method: "POST",
      headers: { cookie: viewerCookie },
    });
    expect(viewerRestoreRes.status).toBe(403);

    const viewerListRes = await fetch(`${baseUrl}/boards/${board.id}/versions`, { headers: { cookie: viewerCookie } });
    expect(viewerListRes.status).toBe(200);

    const viewerBranchRes = await fetch(`${baseUrl}/boards/${board.id}/versions/${versionId}/branch`, {
      method: "POST",
      headers: { cookie: viewerCookie },
    });
    expect(viewerBranchRes.status).toBe(201);
    const branch = await viewerBranchRes.json();
    expect(branch.role).toBe("owner");

    const branchSnapshot = await loadMergedSnapshot(branch.id);
    const branchDoc = new Y.Doc();
    Y.applyUpdate(branchDoc, new Uint8Array(branchSnapshot!));
    expect(branchDoc.getMap("shapes").toJSON()).toEqual({ a: { type: "rect" } });
  });
});
