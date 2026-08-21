import { describe, it, expect, afterAll, beforeAll } from "vitest";
import * as Y from "yjs";
import { runMigrations } from "../db/migrate.js";
import { db } from "../db/index.js";
import { boards } from "../db/schema.js";
import { pool } from "../db/pool.js";
import { persistUpdate } from "./docStore.js";
import { compactBoard } from "./compaction.js";

describe("compactBoard", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("merges updates into a snapshot and clears the update log", async () => {
    const [board] = await db.insert(boards).values({}).returning();
    const boardId = board.id;

    const doc = new Y.Doc();
    doc.getMap("shapes").set("a", "1");
    await persistUpdate(boardId, Y.encodeStateAsUpdate(doc));
    const beforeB = Y.encodeStateVector(doc);
    doc.getMap("shapes").set("b", "2");
    await persistUpdate(boardId, Y.encodeStateAsUpdate(doc, beforeB));

    await compactBoard(boardId);

    const { rows: remaining } = await pool.query("SELECT count(*) FROM board_updates WHERE board_id = $1", [
      boardId,
    ]);
    expect(Number(remaining[0].count)).toBe(0);

    const { rows: snapshotRows } = await pool.query<{ snapshot: Buffer }>(
      "SELECT snapshot FROM board_snapshots WHERE board_id = $1",
      [boardId],
    );
    const reloaded = new Y.Doc();
    Y.applyUpdate(reloaded, new Uint8Array(snapshotRows[0].snapshot));
    expect(reloaded.getMap("shapes").toJSON()).toEqual({ a: "1", b: "2" });
  });
});
