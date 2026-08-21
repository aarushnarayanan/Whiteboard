import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import type { ShapeObj } from "../canvas/types";

export function useBoardDoc(boardId: string) {
  const docRef = useRef<Y.Doc | undefined>(undefined);
  if (!docRef.current) {
    docRef.current = new Y.Doc();
  }

  const [shapes, setShapes] = useState<ShapeObj[]>([]);

  useEffect(() => {
    const doc = docRef.current!;
    const shapesMap = doc.getMap<Y.Map<unknown>>("shapes");

    // No role/token is sent here — the server reads the session cookie itself
    // (browsers attach cookies to a same-origin WS handshake automatically)
    // and looks up the real role from board_members. This URL is purely
    // "which board."
    const serverUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws/boards`;
    const provider = new WebsocketProvider(serverUrl, boardId, doc, {
      connect: true,
    });

    function syncShapes() {
      const next: ShapeObj[] = [];
      shapesMap.forEach((shape) => next.push(shape.toJSON() as ShapeObj));
      setShapes(next);
    }

    shapesMap.observeDeep(syncShapes);
    syncShapes();

    return () => {
      shapesMap.unobserveDeep(syncShapes);
      provider.destroy();
    };
  }, [boardId]);

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

  function removeShape(id: string) {
    docRef.current!.getMap("shapes").delete(id);
  }

  // Reads the shared doc directly. `shapes` is a React-state mirror that lags a
  // render behind, so anything deciding what to write back must not read it.
  function getShape(id: string): ShapeObj | undefined {
    const entry = docRef.current!.getMap<Y.Map<unknown>>("shapes").get(id);
    return entry ? (entry.toJSON() as ShapeObj) : undefined;
  }

  return { shapes, upsertShape, removeShape, getShape };
}
