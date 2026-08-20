import { and, asc, eq, lte } from "drizzle-orm";
import * as Y from "yjs";
import { db } from "../db/index.js";
import { boardSnapshots, boardUpdates } from "../db/schema.js";

export async function compactBoard(boardId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const snapshotRows = await tx
      .select({ snapshot: boardSnapshots.snapshot })
      .from(boardSnapshots)
      .where(eq(boardSnapshots.boardId, boardId))
      .for("update");

    const updateRows = await tx
      .select({ id: boardUpdates.id, update: boardUpdates.update })
      .from(boardUpdates)
      .where(eq(boardUpdates.boardId, boardId))
      .orderBy(asc(boardUpdates.id));

    if (updateRows.length === 0) return;

    const doc = new Y.Doc();
    if (snapshotRows[0]) {
      Y.applyUpdate(doc, new Uint8Array(snapshotRows[0].snapshot));
    }
    for (const row of updateRows) {
      Y.applyUpdate(doc, new Uint8Array(row.update));
    }

    const merged = Buffer.from(Y.encodeStateAsUpdate(doc));
    await tx
      .insert(boardSnapshots)
      .values({ boardId, snapshot: merged, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: boardSnapshots.boardId,
        set: { snapshot: merged, updatedAt: new Date() },
      });

    const maxId = updateRows[updateRows.length - 1].id;
    await tx.delete(boardUpdates).where(and(eq(boardUpdates.boardId, boardId), lte(boardUpdates.id, maxId)));
  });
}
