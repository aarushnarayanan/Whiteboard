import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import WebSocket from "ws";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import { WebsocketProvider } from "y-websocket";
import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import { createBoardServer } from "../httpServer.js";
import { acquireDoc, releaseDoc } from "./docStore.js";

const MESSAGE_AWARENESS = 1;

let server: Server;
let port: number;

function url(boardId: string, role: string) {
  return `ws://127.0.0.1:${port}/ws/boards/${boardId}?role=${role}`;
}

function connectProvider(boardId: string, role: "editor" | "viewer", doc: Y.Doc) {
  return new WebsocketProvider(`ws://127.0.0.1:${port}/ws/boards`, boardId, doc, {
    params: { role },
    // The BroadcastChannel fallback would let two providers in this one process
    // sync peer-to-peer, which would make every assertion below meaningless.
    disableBc: true,
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
  });
}

function whenSynced(provider: WebsocketProvider): Promise<void> {
  if (provider.synced) return Promise.resolve();
  return new Promise((resolve) => {
    const onSync = (isSynced: boolean) => {
      if (!isSynced) return;
      provider.off("sync", onSync);
      resolve();
    };
    provider.on("sync", onSync);
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Rebuilds a board purely from what is persisted in Postgres. */
async function docFromDb(boardId: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const { rows: snapshots } = await pool.query<{ snapshot: Buffer }>(
    "SELECT snapshot FROM board_snapshots WHERE board_id = $1",
    [boardId],
  );
  if (snapshots[0]) Y.applyUpdate(doc, new Uint8Array(snapshots[0].snapshot));
  const { rows: updates } = await pool.query<{ update: Buffer }>(
    "SELECT update FROM board_updates WHERE board_id = $1 ORDER BY id",
    [boardId],
  );
  for (const row of updates) Y.applyUpdate(doc, new Uint8Array(row.update));
  return doc;
}

describe("sync engine over a real WebSocket server", () => {
  beforeAll(async () => {
    await runMigrations();
    server = createBoardServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // The last disconnect kicks off a compaction; let it finish before the pool
    // is torn out from under it.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await pool.end();
  });

  it("broadcasts an editor's edit to a viewer and drops the viewer's own edit", async () => {
    const boardId = `integration-broadcast-${Date.now()}`;

    const editorDoc = new Y.Doc();
    const viewerDoc = new Y.Doc();
    const editor = connectProvider(boardId, "editor", editorDoc);
    const viewer = connectProvider(boardId, "viewer", viewerDoc);

    try {
      await Promise.all([whenSynced(editor), whenSynced(viewer)]);

      // 1. The editor's edit must reach the viewer's doc through the server.
      editorDoc.getMap("shapes").set("editor-shape", "rect");
      await waitFor(() => viewerDoc.getMap("shapes").get("editor-shape") === "rect");
      expect(viewerDoc.getMap("shapes").get("editor-shape")).toBe("rect");

      // 2. The viewer's edit must be dropped by the server.
      viewerDoc.getMap("shapes").set("viewer-shape", "ellipse");
      // Round-trip a second editor edit to prove the viewer's write had time to
      // arrive and be processed before we assert on its absence.
      editorDoc.getMap("shapes").set("editor-shape-2", "ellipse");
      await waitFor(() => viewerDoc.getMap("shapes").get("editor-shape-2") === "ellipse");

      const serverDoc = await acquireDoc(boardId);
      expect(serverDoc.getMap("shapes").get("editor-shape")).toBe("rect");
      expect(serverDoc.getMap("shapes").get("viewer-shape")).toBeUndefined();
      releaseDoc(boardId);

      const persisted = await docFromDb(boardId);
      expect(persisted.getMap("shapes").get("editor-shape")).toBe("rect");
      expect(persisted.getMap("shapes").get("editor-shape-2")).toBe("ellipse");
      expect(persisted.getMap("shapes").get("viewer-shape")).toBeUndefined();
    } finally {
      editor.destroy();
      viewer.destroy();
    }
  }, 20000);

  it("relays awareness frames to the board's sockets, sender included", async () => {
    const boardId = `integration-awareness-${Date.now()}`;

    const a = new WebSocket(url(boardId, "editor"));
    const b = new WebSocket(url(boardId, "viewer"));
    const received: { a: Uint8Array[]; b: Uint8Array[] } = { a: [], b: [] };
    a.binaryType = "arraybuffer";
    b.binaryType = "arraybuffer";
    a.on("message", (d: ArrayBuffer) => received.a.push(new Uint8Array(d)));
    b.on("message", (d: ArrayBuffer) => received.b.push(new Uint8Array(d)));

    try {
      await Promise.all([
        new Promise((r) => a.once("open", r)),
        new Promise((r) => b.once("open", r)),
      ]);
      // Drain the server's opening sync step 1.
      await waitFor(() => received.a.length > 0 && received.b.length > 0);
      received.a.length = 0;
      received.b.length = 0;

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, new Uint8Array([1, 2, 3]));
      const frame = encoding.toUint8Array(encoder);
      a.send(frame);

      // The echo back to the sender is what keeps a lone client's 30s idle
      // timer from firing; the relay to `b` is what a real presence layer needs.
      await waitFor(() => received.a.length > 0 && received.b.length > 0);
      expect(Array.from(received.a[0])).toEqual(Array.from(frame));
      expect(Array.from(received.b[0])).toEqual(Array.from(frame));
    } finally {
      a.close();
      b.close();
    }
  }, 20000);

  it("keeps an idle connection alive past the client's 30s reconnect timeout", async () => {
    const boardId = `integration-idle-${Date.now()}`;
    const doc = new Y.Doc();
    const provider = connectProvider(boardId, "editor", doc);

    const statuses: string[] = [];
    provider.on("status", ({ status }: { status: string }) => statuses.push(status));

    try {
      await whenSynced(provider);
      // y-websocket closes the socket once 30s pass with no inbound message; its
      // own awareness heartbeat fires every 15s, so the server's awareness relay
      // is what keeps this alive. Wait past one full timeout window.
      await new Promise((r) => setTimeout(r, 36000));

      expect(statuses.filter((s) => s === "disconnected")).toEqual([]);
      expect(provider.wsconnected).toBe(true);
      // Inbound traffic within the last 30s is what the client's check measures.
      expect(Math.floor(Date.now() / 1000) - provider.wsLastMessageReceived).toBeLessThan(30);
    } finally {
      provider.destroy();
    }
  }, 60000);
});
