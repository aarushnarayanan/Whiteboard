import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import { handleBoardConnection } from "./syncHandler.js";
import * as docStore from "./docStore.js";

function fakeSocket() {
  const listeners: Record<string, Function[]> = {};
  return {
    readyState: 1,
    OPEN: 1,
    sent: [] as Uint8Array[],
    paused: false,
    send(data: Uint8Array) {
      this.sent.push(data);
    },
    pause() {
      this.paused = true;
    },
    resume() {
      this.paused = false;
    },
    on(event: string, cb: Function) {
      (listeners[event] ??= []).push(cb);
    },
    emit(event: string, ...args: unknown[]) {
      for (const cb of listeners[event] ?? []) cb(...args);
    },
  };
}

function encodeUpdateMessage(update: Uint8Array): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0); // message type 0 = sync
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder).buffer as ArrayBuffer;
}

describe("handleBoardConnection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("drops updates from a viewer without applying or persisting them", async () => {
    const doc = new Y.Doc();
    vi.spyOn(docStore, "acquireDoc").mockResolvedValue(doc);
    vi.spyOn(docStore, "releaseDoc").mockImplementation(() => {});
    const persistSpy = vi.spyOn(docStore, "persistUpdate").mockResolvedValue();

    const socket = fakeSocket();
    await handleBoardConnection(socket as any, "board-1", "viewer");

    const senderDoc = new Y.Doc();
    senderDoc.getMap("shapes").set("shape-1", "x");
    socket.emit("message", encodeUpdateMessage(Y.encodeStateAsUpdate(senderDoc)));

    expect(persistSpy).not.toHaveBeenCalled();
    expect(doc.getMap("shapes").get("shape-1")).toBeUndefined();
  });

  it("applies and persists updates from an editor", async () => {
    const doc = new Y.Doc();
    vi.spyOn(docStore, "acquireDoc").mockResolvedValue(doc);
    vi.spyOn(docStore, "releaseDoc").mockImplementation(() => {});
    const persistSpy = vi.spyOn(docStore, "persistUpdate").mockResolvedValue();

    const socket = fakeSocket();
    await handleBoardConnection(socket as any, "board-1", "editor");

    const senderDoc = new Y.Doc();
    senderDoc.getMap("shapes").set("shape-1", "x");
    socket.emit("message", encodeUpdateMessage(Y.encodeStateAsUpdate(senderDoc)));

    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(doc.getMap("shapes").get("shape-1")).toBe("x");
  });

  it("buffers frames that arrive while the doc is still loading", async () => {
    const doc = new Y.Doc();
    let resolveDoc: (d: Y.Doc) => void;
    vi.spyOn(docStore, "acquireDoc").mockReturnValue(
      new Promise<Y.Doc>((resolve) => {
        resolveDoc = resolve;
      }),
    );
    vi.spyOn(docStore, "releaseDoc").mockImplementation(() => {});

    const socket = fakeSocket();
    const pending = handleBoardConnection(socket as any, "board-1", "editor");

    // `ws` drops messages emitted with no listener, and the client sends its
    // SyncStep1 as soon as the handshake completes — the socket must be paused
    // for the whole DB read.
    expect(socket.paused).toBe(true);
    resolveDoc!(doc);
    await pending;
    expect(socket.paused).toBe(false);
  });

  it("releases the doc when the socket closes during the initial load", async () => {
    const doc = new Y.Doc();
    let resolveDoc: (d: Y.Doc) => void;
    vi.spyOn(docStore, "acquireDoc").mockReturnValue(
      new Promise<Y.Doc>((resolve) => {
        resolveDoc = resolve;
      }),
    );
    const releaseSpy = vi.spyOn(docStore, "releaseDoc").mockImplementation(() => {});

    const socket = fakeSocket();
    const pending = handleBoardConnection(socket as any, "board-1", "editor");

    // The 'close' event fires here with no listener attached and is never
    // redelivered, so the handler has to notice the dead socket itself.
    socket.readyState = 3;
    socket.emit("close");
    resolveDoc!(doc);
    await pending;

    expect(releaseSpy).toHaveBeenCalledTimes(1);
    expect(socket.sent).toHaveLength(0);
  });

  it("two independently edited docs converge after syncing", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    docA.getMap("shapes").set("a", 1);
    docB.getMap("shapes").set("b", 2);

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    expect(docA.getMap("shapes").toJSON()).toEqual(docB.getMap("shapes").toJSON());
  });
});
