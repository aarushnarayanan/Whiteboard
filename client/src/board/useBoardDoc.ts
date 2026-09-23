import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import type { ShapeObj } from "../canvas/types";

export function useBoardDoc(boardId: string, options?: { staticShapes?: ShapeObj[] }) {
  const docRef = useRef<Y.Doc | undefined>(undefined);
  if (!docRef.current) {
    docRef.current = new Y.Doc();
  }

  const [shapes, setShapes] = useState<ShapeObj[]>([]);
  const undoManagerRef = useRef<Y.UndoManager | undefined>(undefined);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // Exposed so callers can reach `.awareness` for cursor/presence — set
  // synchronously in this effect, read by effects declared after this hook
  // call returns (they run later in the same commit), so it's never stale
  // by the time anything reads it. Stays undefined in static mode (below) —
  // Canvas's own awareness effect already no-ops when there's no provider.
  const providerRef = useRef<WebsocketProvider | undefined>(undefined);

  const staticShapes = options?.staticShapes;

  useEffect(() => {
    const doc = docRef.current!;
    const shapesMap = doc.getMap<Y.Map<unknown>>("shapes");

    // F8 preview mode: a version's content, frozen. No socket, no undo — the
    // doc never changes again for the life of this hook instance (a preview
    // Canvas is remounted with a fresh key rather than ever handed new
    // staticShapes in place), so there's nothing for an observer or an undo
    // manager to do.
    if (staticShapes) {
      doc.transact(() => {
        for (const shape of staticShapes) {
          const entry = new Y.Map();
          for (const [key, value] of Object.entries(shape)) entry.set(key, value);
          shapesMap.set(shape.id, entry);
        }
      });
      const next = [...staticShapes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      setShapes(next);
      return;
    }

    // No role/token is sent here — the server reads the session cookie itself
    // (browsers attach cookies to a same-origin WS handshake automatically)
    // and looks up the real role from board_members. This URL is purely
    // "which board."
    const serverUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws/boards`;
    const provider = new WebsocketProvider(serverUrl, boardId, doc, {
      connect: true,
    });
    providerRef.current = provider;

    function syncShapes() {
      const next: ShapeObj[] = [];
      shapesMap.forEach((shape) => next.push(shape.toJSON() as ShapeObj));
      // Stable sort so untouched shapes (order: undefined -> 0) keep their
      // current relative position — only an explicit reorder moves anything.
      next.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      setShapes(next);
    }

    shapesMap.observeDeep(syncShapes);
    syncShapes();

    // Scoped to shapesMap so only local edits are tracked (Yjs's default
    // trackedOrigins is [null], which is the origin of our own transactions —
    // remote updates arrive with the provider as origin and are ignored),
    // giving per-user undo without any extra bookkeeping.
    const undoManager = new Y.UndoManager(shapesMap);
    undoManagerRef.current = undoManager;
    function syncHistory() {
      setCanUndo(undoManager.undoStack.length > 0);
      setCanRedo(undoManager.redoStack.length > 0);
    }
    undoManager.on("stack-item-added", syncHistory);
    undoManager.on("stack-item-popped", syncHistory);
    syncHistory();

    return () => {
      shapesMap.unobserveDeep(syncShapes);
      undoManager.off("stack-item-added", syncHistory);
      undoManager.off("stack-item-popped", syncHistory);
      undoManager.destroy();
      undoManagerRef.current = undefined;
      provider.destroy();
      providerRef.current = undefined;
    };
  }, [boardId, staticShapes]);

  function upsertShape(shape: ShapeObj) {
    const shapesMap = docRef.current!.getMap<Y.Map<unknown>>("shapes");
    let entry = shapesMap.get(shape.id);
    if (!entry) {
      entry = new Y.Map();
      shapesMap.set(shape.id, entry);
    }
    const target = entry;
    docRef.current!.transact(() => {
      for (const [key, value] of Object.entries(shape)) {
        target.set(key, value);
      }
    });
  }

  function upsertShapes(shapesToUpdate: ShapeObj[]) {
    const shapesMap = docRef.current!.getMap<Y.Map<unknown>>("shapes");
    docRef.current!.transact(() => {
      for (const shape of shapesToUpdate) {
        let entry = shapesMap.get(shape.id);
        if (!entry) {
          entry = new Y.Map();
          shapesMap.set(shape.id, entry);
        }
        for (const [key, value] of Object.entries(shape)) {
          entry.set(key, value);
        }
      }
    });
  }

  function removeShape(id: string) {
    docRef.current!.getMap("shapes").delete(id);
  }

  function removeShapes(ids: string[]) {
    const shapesMap = docRef.current!.getMap("shapes");
    docRef.current!.transact(() => {
      for (const id of ids) shapesMap.delete(id);
    });
  }

  // Reads the shared doc directly. `shapes` is a React-state mirror that lags a
  // render behind, so anything deciding what to write back must not read it.
  function getShape(id: string): ShapeObj | undefined {
    const entry = docRef.current!.getMap<Y.Map<unknown>>("shapes").get(id);
    return entry ? (entry.toJSON() as ShapeObj) : undefined;
  }

  function undo() {
    undoManagerRef.current?.undo();
  }

  function redo() {
    undoManagerRef.current?.redo();
  }

  return { shapes, upsertShape, upsertShapes, removeShape, removeShapes, getShape, undo, redo, canUndo, canRedo, providerRef };
}
