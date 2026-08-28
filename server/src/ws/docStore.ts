import { eq, asc } from "drizzle-orm";
import * as Y from "yjs";
import { db } from "../db/index.js";
import { boardSnapshots, boardUpdates } from "../db/schema.js";

const docs = new Map<string, Y.Doc>();
const refCounts = new Map<string, number>();
const inFlight = new Map<string, Promise<Y.Doc>>();

// Both reads must see one consistent view of the database. compactBoard folds
// updates into the snapshot and deletes them in a single transaction, so a
// snapshot read from before that commit paired with an updates read from
// after it loses every edit since the previous snapshot.
//
// REPEATABLE READ (not just a plain transaction) is what buys that: under
// the default READ COMMITTED level each statement takes its own snapshot,
// so a plain transaction would still straddle the compaction commit.
//
// No created_at filter: compaction deletes exactly the rows it merged, in the
// same transaction, and Yjs updates are idempotent — replaying one that is
// already in the snapshot is a no-op. Dropping the filter also stops a row
// written concurrently with a compaction from becoming invisible.
async function fetchSnapshotAndUpdates(boardId: string) {
  return db.transaction(
    async (tx) => {
      const snapshotRows = await tx
        .select({ snapshot: boardSnapshots.snapshot })
        .from(boardSnapshots)
        .where(eq(boardSnapshots.boardId, boardId));

      const updateRows = await tx
        .select({ update: boardUpdates.update })
        .from(boardUpdates)
        .where(eq(boardUpdates.boardId, boardId))
        .orderBy(asc(boardUpdates.id));

      return { snapshot: snapshotRows[0]?.snapshot, updates: updateRows.map((row) => row.update) };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

async function loadDoc(boardId: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const { snapshot, updates } = await fetchSnapshotAndUpdates(boardId);

  if (snapshot) {
    Y.applyUpdate(doc, new Uint8Array(snapshot));
  }
  for (const update of updates) {
    Y.applyUpdate(doc, new Uint8Array(update));
  }

  return doc;
}

/** The board's full current content as a single merged snapshot, or null if it has none yet. */
export async function loadMergedSnapshot(boardId: string): Promise<Buffer | null> {
  const { snapshot, updates } = await fetchSnapshotAndUpdates(boardId);
  if (!snapshot && updates.length === 0) return null;

  const doc = new Y.Doc();
  if (snapshot) Y.applyUpdate(doc, new Uint8Array(snapshot));
  for (const update of updates) Y.applyUpdate(doc, new Uint8Array(update));

  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

export async function acquireDoc(boardId: string): Promise<Y.Doc> {
  refCounts.set(boardId, (refCounts.get(boardId) ?? 0) + 1);

  const existing = docs.get(boardId);
  if (existing) return existing;

  let loading = inFlight.get(boardId);
  if (!loading) {
    loading = loadDoc(boardId);
    inFlight.set(boardId, loading);
  }

  try {
    const doc = await loading;
    docs.set(boardId, doc);
    return doc;
  } catch (error) {
    // Rollback the ref count increment since we're not providing a doc
    const count = (refCounts.get(boardId) ?? 1) - 1;
    if (count <= 0) {
      refCounts.delete(boardId);
    } else {
      refCounts.set(boardId, count);
    }
    throw error;
  } finally {
    // Always clean up the in-flight promise, even if loading failed
    // This ensures we'll retry the load on the next acquireDoc call
    inFlight.delete(boardId);
  }
}

export function releaseDoc(boardId: string): void {
  const count = (refCounts.get(boardId) ?? 1) - 1;
  if (count <= 0) {
    refCounts.delete(boardId);
    docs.delete(boardId);
  } else {
    refCounts.set(boardId, count);
  }
}

export async function persistUpdate(boardId: string, update: Uint8Array): Promise<void> {
  await db.insert(boardUpdates).values({ boardId, update: Buffer.from(update) });
}
