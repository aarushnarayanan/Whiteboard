import type WebSocket from "ws";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import { acquireDoc, releaseDoc, persistUpdate } from "./docStore.js";
import { compactBoard } from "./compaction.js";
import type { BoardRole } from "./roleStub.js";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

const boardSockets = new Map<string, Set<WebSocket>>();

function broadcast(boardId: string, exclude: WebSocket | null, data: Uint8Array) {
  for (const socket of boardSockets.get(boardId) ?? []) {
    if (socket !== exclude && socket.readyState === socket.OPEN) {
      socket.send(data);
    }
  }
}

export async function handleBoardConnection(
  ws: WebSocket,
  boardId: string,
  role: BoardRole,
): Promise<void> {
  // Must be registered before anything can fail: `ws` emits 'error' on the
  // WebSocket instance for protocol-level receiver failures (e.g. a frame with
  // RSV2/RSV3 set), and an unhandled 'error' on an EventEmitter kills the process.
  ws.on("error", (err) => console.error("ws error", err));

  // Nothing can consume frames until the doc has loaded, and `ws` drops any
  // message emitted with no listener attached. The client sends its SyncStep1
  // the instant the handshake completes — i.e. while the DB read below is still
  // in flight — so pause the socket and let TCP buffer until we are ready.
  ws.pause();

  const doc = await acquireDoc(boardId);

  // The socket may have closed while we were loading the doc from Postgres. The
  // 'close' event already fired with no listener and is never redelivered, so a
  // handler registered now would never run and the doc would stay pinned forever.
  if (ws.readyState !== ws.OPEN) {
    releaseDoc(boardId);
    return;
  }

  let sockets = boardSockets.get(boardId);
  if (!sockets) {
    sockets = new Set();
    boardSockets.set(boardId, sockets);
  }
  sockets.add(ws);

  // Registered before any other post-await work so that a throw below (or an
  // ws.close() from the caller's catch path) still releases the doc.
  ws.on("close", () => {
    sockets!.delete(ws);
    releaseDoc(boardId);
    if (sockets!.size === 0) {
      boardSockets.delete(boardId);
      compactBoard(boardId).catch((err) => console.error("compaction failed", err));
    }
  });

  const helloEncoder = encoding.createEncoder();
  encoding.writeVarUint(helloEncoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(helloEncoder, doc);
  ws.send(encoding.toUint8Array(helloEncoder));

  ws.on("message", (data: ArrayBuffer) => {
    try {
      const message = new Uint8Array(data);
      const decoder = decoding.createDecoder(message);
      const encoder = encoding.createEncoder();
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MESSAGE_AWARENESS) {
        // Opaque relay only — presence/cursors are backlog. Echoing the frame
        // back to the sender as well is what the reference y-websocket server
        // does, and it is what keeps a lone client alive: y-websocket's client
        // closes the socket after 30s without an inbound message, and its own
        // awareness heartbeat fires every 15s. Applying a client's own
        // awareness update is a no-op (same clock), so the echo is harmless.
        broadcast(boardId, null, message);
        return;
      }

      if (messageType !== MESSAGE_SYNC) return;

      const syncMessageType = decoding.readVarUint(decoder);

      if (syncMessageType === syncProtocol.messageYjsSyncStep1) {
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncStep1(decoder, encoder, doc);
        if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder));
        return;
      }

      if (role === "viewer") return; // hard read-only: drop before it ever touches the doc

      const before = Y.encodeStateVector(doc);
      if (syncMessageType === syncProtocol.messageYjsSyncStep2) {
        syncProtocol.readSyncStep2(decoder, doc, ws);
      } else if (syncMessageType === syncProtocol.messageYjsUpdate) {
        syncProtocol.readUpdate(decoder, doc, ws);
      } else {
        return;
      }

      const update = Y.encodeStateAsUpdate(doc, before);
      persistUpdate(boardId, update).catch((err) => console.error("failed to persist update", err));

      const relayEncoder = encoding.createEncoder();
      encoding.writeVarUint(relayEncoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(relayEncoder, update);
      broadcast(boardId, ws, encoding.toUint8Array(relayEncoder));
    } catch (err) {
      // Defense in depth: a malformed payload must never take the process down.
      console.error("failed to handle message", err);
    }
  });

  ws.resume();
}
