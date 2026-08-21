import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import * as Y from "yjs";
import { Pool } from "pg";
import { runMigrations } from "../db/migrate.js";
import { db } from "../db/index.js";
import { boards } from "../db/schema.js";
import { pool } from "../db/pool.js";
import { acquireDoc, releaseDoc, persistUpdate } from "./docStore.js";

async function makeBoard(): Promise<string> {
  const [board] = await db.insert(boards).values({}).returning();
  return board.id;
}

describe("docStore", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("reconstructs a board's doc from persisted updates", async () => {
    const boardId = await makeBoard();

    const source = new Y.Doc();
    source.getMap("shapes").set("a", "hello");
    await persistUpdate(boardId, Y.encodeStateAsUpdate(source));

    const doc = await acquireDoc(boardId);
    expect(doc.getMap("shapes").get("a")).toBe("hello");
    releaseDoc(boardId);
  });

  it("loads updates that predate the snapshot's timestamp", async () => {
    // Regression for the compaction/load race: loadDoc used to skip rows with
    // created_at <= snapshot.updated_at, so an update racing a compaction (or
    // read against a snapshot committed after it) vanished from the board.
    // Yjs updates are idempotent, so the load now replays every stored row.
    const boardId = await makeBoard();

    const base = new Y.Doc();
    base.getMap("shapes").set("kept", "from-snapshot");
    await pool.query(
      "INSERT INTO board_snapshots (board_id, snapshot, updated_at) VALUES ($1, $2, now())",
      [boardId, Buffer.from(Y.encodeStateAsUpdate(base))],
    );

    const stray = new Y.Doc();
    Y.applyUpdate(stray, Y.encodeStateAsUpdate(base));
    const before = Y.encodeStateVector(stray);
    stray.getMap("shapes").set("stray", "written-during-compaction");
    await pool.query(
      "INSERT INTO board_updates (board_id, update, created_at) VALUES ($1, $2, now() - interval '1 minute')",
      [boardId, Buffer.from(Y.encodeStateAsUpdate(stray, before))],
    );

    const doc = await acquireDoc(boardId);
    expect(doc.getMap("shapes").toJSON()).toEqual({
      kept: "from-snapshot",
      stray: "written-during-compaction",
    });
    releaseDoc(boardId);
  });

  it("retries load after transient DB error", async () => {
    const boardId = await makeBoard();

    const source = new Y.Doc();
    source.getMap("shapes").set("b", "world");
    await persistUpdate(boardId, Y.encodeStateAsUpdate(source));

    // loadDoc reads inside a transaction on a dedicated client, so fail the
    // checkout to simulate a transient DB error.
    const connectSpy = vi.spyOn(Pool.prototype, "connect" as any);
    connectSpy.mockRejectedValueOnce(new Error("Transient DB error"));

    // First acquireDoc should fail
    await expect(acquireDoc(boardId)).rejects.toThrow("Transient DB error");

    // Restore normal behavior
    connectSpy.mockRestore();

    // Second acquireDoc should succeed (not stuck on old rejection)
    const doc = await acquireDoc(boardId);
    expect(doc.getMap("shapes").get("b")).toBe("world");
    releaseDoc(boardId);
  });
});
