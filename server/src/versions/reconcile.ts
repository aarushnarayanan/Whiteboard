import * as Y from "yjs";

// Restoring a version cannot be "merge the old Yjs state into the current
// one" — Yjs CRDT merges are a monotonic union of every known operation, so
// merging an old state into a newer one does not undo deletions the current
// state has since tombstoned. Instead this reconciles at the application
// level: diff the plain JSON of the live `shapes` map against the target
// version's plain JSON, and replay that as plain upserts/deletes — the exact
// same per-field `.set()` / `.delete()` calls the client's own
// upsertShapes/removeShapes (client/src/board/useBoardDoc.ts) already use.
export function reconcileShapesMap(doc: Y.Doc, targetShapes: Record<string, Record<string, unknown>>): void {
  const shapesMap = doc.getMap<Y.Map<unknown>>("shapes");

  doc.transact(() => {
    for (const [id, fields] of Object.entries(targetShapes)) {
      let entry = shapesMap.get(id);
      if (!entry) {
        entry = new Y.Map();
        shapesMap.set(id, entry);
      }
      for (const [key, value] of Object.entries(fields)) {
        entry.set(key, value);
      }
    }
    for (const id of Array.from(shapesMap.keys())) {
      if (!(id in targetShapes)) shapesMap.delete(id);
    }
  });
}
