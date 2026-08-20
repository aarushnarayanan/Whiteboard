# Real-Time Collaboration (Phase 04) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the real-time sync engine only — Yjs document sync over WebSocket, role-based read-only enforcement, and durable persistence — so two browser tabs can edit the same board live. Auth, boards/dashboard, and sharing are separate, not-yet-built phases; this plan stubs the one thing it needs from them (a connecting user's role) behind a clearly marked, swappable placeholder.

**Architecture:** A minimal `ws.Server` on the existing raw `http` server authenticates each WebSocket connection via a temporary query-param role stub, then hands it to a sync handler that speaks Yjs's `y-websocket` wire protocol directly (via `y-protocols/sync`), so the real `y-websocket` client library works unmodified. Edits from `editor` connections are applied to an in-memory `Y.Doc`, persisted to Postgres as an append-only update log, and broadcast to other connections on that board; `viewer` connections receive updates but anything they send is silently dropped. A compaction step merges the update log into a snapshot when a board's last connection closes.

**Tech Stack:** `yjs`, `y-protocols`, `y-websocket` (client), `ws` (server), `pg`, `vitest`. No HTTP framework — no REST endpoints exist in this plan, so the existing raw `http.createServer` handler is left as-is.

**Spec:** `docs/superpowers/specs/2026-08-19-realtime-collaboration-design.md`

## Global Constraints

- Redis is removed from `docker-compose.yml` and `.env.example` — not part of this design (single-process server, nothing to relay between processes).
- No ORM — raw `pg` + hand-written `.sql` migration files, applied by a small script.
- **Auth is stubbed, not built.** A connecting user's role comes from a `?role=editor|viewer` query param on the WebSocket URL, not a real session. This is marked with a `ponytail:` comment at its one call site (`server/src/ws/roleStub.ts`) — swapping it for a real cookie/JWT + `board_members` lookup, once phase 08/09 exist, only touches that one file. No other file in this plan should assume real auth.
- `board_id` is a plain string for now (no `boards` table, no foreign key) — a real `boards` table arrives with phase 09 (permissions & sharing), out of scope here.
- Out of scope, explicitly: sign-in (Google/password), the boards REST API, any dashboard/board-picker UI beyond a throwaway manual-testing form, live cursors/presence, image upload.
- Any test touching Postgres assumes `docker compose up -d postgres` is already running, and that `server/.env` exists (copy `.env.example` → `.env`) with a valid `DATABASE_URL`.

---

## File Structure

**Server**
- `server/src/db/pool.ts` — shared `pg.Pool`.
- `server/src/db/migrate.ts` — applies un-applied `.sql` files from `migrations/`, tracked in a `schema_migrations` table.
- `server/src/db/migrations/001_board_sync.sql` — `board_updates` + `board_snapshots` tables.
- `server/src/ws/roleStub.ts` — parses `board_id` + `role` off the WS upgrade request. The one file to replace when real auth lands.
- `server/src/ws/docStore.ts` — in-memory `Y.Doc` per board; loads initial state from Postgres on first connection, releases it when the last connection leaves.
- `server/src/ws/syncHandler.ts` — per-connection message handling: applies/broadcasts editor updates, drops viewer updates, persists updates.
- `server/src/ws/compaction.ts` — merges a board's update log into a snapshot.
- `server/src/index.ts` (modify) — wires the WS upgrade handler into the existing raw HTTP server.

**Client**
- `client/src/board/useBoardDoc.ts` — owns the `Y.Doc` + `WebsocketProvider`, exposes shapes as plain React state plus `upsertShape`/`removeShape`.
- `client/src/canvas/Canvas.tsx` (modify) — replaces local `useState` shape storage with `useBoardDoc`; disables editing when `role !== "editor"`.
- `client/src/App.tsx` (modify) — replaced with a throwaway "board id + role" form in front of the canvas, so the engine can be exercised without real sign-in or a board picker.
- `client/vite.config.ts` (modify) — proxies `/ws` to the backend in dev.

---

### Task 1: Drop Redis; server DB + test scaffolding

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `server/package.json`
- Create: `server/src/db/pool.ts`
- Create: `server/src/db/migrate.ts`
- Create: `server/src/db/migrations/.gitkeep`
- Test: `server/src/db/migrate.test.ts`

**Interfaces:**
- Produces: `pool: pg.Pool` from `db/pool.ts`. `runMigrations(): Promise<string[]>` from `db/migrate.ts` — used by every later test that needs the schema present.

- [ ] **Step 1: Remove Redis from docker-compose and env**

Edit `docker-compose.yml` to delete the `redis` service and its line in the top-level `volumes:` block (keep `postgres` and `pgdata` untouched). Edit `.env.example` to delete the `REDIS_URL=redis://localhost:6379` line.

Verify: `grep -i redis docker-compose.yml .env.example` prints nothing.

- [ ] **Step 2: Add dependencies and scripts to server/package.json**

```json
{
  "name": "server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=.env src/index.ts",
    "migrate": "tsx --env-file=.env src/db/migrate.ts",
    "test": "vitest run",
    "build": "tsc",
    "start": "node --env-file=.env dist/index.js"
  },
  "dependencies": {
    "pg": "^8.13.1",
    "ws": "^8.18.0",
    "yjs": "^13.6.20",
    "y-protocols": "^1.0.6"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "tsx": "^4.20.6",
    "@types/node": "^24.11.1",
    "@types/pg": "^8.11.10",
    "@types/ws": "^8.5.13",
    "vitest": "^2.1.8"
  }
}
```

Run: `npm install -w server`

- [ ] **Step 3: Create the connection pool**

`server/src/db/pool.ts`:

```ts
import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
```

- [ ] **Step 4: Create the migration runner**

`server/src/db/migrate.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "./pool.js";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export async function runMigrations(): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.filename));

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const newlyApplied: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(migrationsDir, file), "utf-8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      newlyApplied.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  return newlyApplied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then((applied) => {
      console.log(applied.length ? `Applied: ${applied.join(", ")}` : "No new migrations.");
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
```

Create an empty `server/src/db/migrations/.gitkeep` so the directory exists before Task 2 adds real migrations.

- [ ] **Step 5: Write the test**

`server/src/db/migrate.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { runMigrations } from "./migrate.js";
import { pool } from "./pool.js";

describe("runMigrations", () => {
  it("creates the schema_migrations tracking table", async () => {
    await runMigrations();
    const { rows } = await pool.query("SELECT to_regclass('public.schema_migrations') AS exists");
    expect(rows[0].exists).toBe("schema_migrations");
  });

  afterAll(async () => {
    await pool.end();
  });
});
```

- [ ] **Step 6: Run it**

Prerequisite: `docker compose up -d postgres`, and `server/.env` copied from `.env.example` with `DATABASE_URL` set.

Run: `npm run test -w server`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml .env.example server/package.json server/package-lock.json server/src/db
git commit -m "Add DB pool, migration runner, and drop unused Redis"
```

---

### Task 2: Board sync schema

**Files:**
- Create: `server/src/db/migrations/001_board_sync.sql`
- Modify: `server/src/db/migrate.test.ts`

**Interfaces:**
- Produces: tables `board_updates(id, board_id, update, created_at)` and `board_snapshots(board_id, snapshot, updated_at)`, consumed by `docStore.ts` and `compaction.ts` (Tasks 3 and 6).

- [ ] **Step 1: Write the migration**

`server/src/db/migrations/001_board_sync.sql`:

```sql
CREATE TABLE board_updates (
  id BIGSERIAL PRIMARY KEY,
  board_id TEXT NOT NULL,
  update BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX board_updates_board_id_idx ON board_updates (board_id, id);

CREATE TABLE board_snapshots (
  board_id TEXT PRIMARY KEY,
  snapshot BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Extend the test to assert both tables exist**

Add to `server/src/db/migrate.test.ts`:

```ts
  it("creates the board sync tables", async () => {
    await runMigrations();
    const { rows } = await pool.query(
      "SELECT to_regclass('public.board_updates') AS updates, to_regclass('public.board_snapshots') AS snapshots",
    );
    expect(rows[0].updates).toBe("board_updates");
    expect(rows[0].snapshots).toBe("board_snapshots");
  });
```

- [ ] **Step 3: Run it**

Run: `npm run test -w server`
Expected: PASS (both tests).

- [ ] **Step 4: Commit**

```bash
git add server/src/db/migrations/001_board_sync.sql server/src/db/migrate.test.ts
git commit -m "Add board_updates and board_snapshots tables"
```

---

### Task 3: Yjs document store

**Files:**
- Create: `server/src/ws/docStore.ts`
- Test: `server/src/ws/docStore.test.ts`

**Interfaces:**
- Consumes: `pool` from `db/pool.ts`.
- Produces: `acquireDoc(boardId: string): Promise<Y.Doc>`, `releaseDoc(boardId: string): void`, `persistUpdate(boardId: string, update: Uint8Array): Promise<void>` — used by `syncHandler.ts` (Task 5).

- [ ] **Step 1: Write the failing test**

`server/src/ws/docStore.test.ts`:

```ts
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import * as Y from "yjs";
import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import { acquireDoc, releaseDoc, persistUpdate } from "./docStore.js";

describe("docStore", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("reconstructs a board's doc from persisted updates", async () => {
    const boardId = `docstore-test-${Date.now()}`;

    const source = new Y.Doc();
    source.getMap("shapes").set("a", "hello");
    await persistUpdate(boardId, Y.encodeStateAsUpdate(source));

    const doc = await acquireDoc(boardId);
    expect(doc.getMap("shapes").get("a")).toBe("hello");
    releaseDoc(boardId);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w server -- docStore`
Expected: FAIL — `docStore.ts` doesn't exist yet.

- [ ] **Step 3: Implement it**

`server/src/ws/docStore.ts`:

```ts
import * as Y from "yjs";
import { pool } from "../db/pool.js";

const docs = new Map<string, Y.Doc>();
const refCounts = new Map<string, number>();
const inFlight = new Map<string, Promise<Y.Doc>>();

async function loadDoc(boardId: string): Promise<Y.Doc> {
  const doc = new Y.Doc();

  const { rows: snapshotRows } = await pool.query<{ snapshot: Buffer; updated_at: Date }>(
    "SELECT snapshot, updated_at FROM board_snapshots WHERE board_id = $1",
    [boardId],
  );
  const since = snapshotRows[0]?.updated_at ?? new Date(0);
  if (snapshotRows[0]) {
    Y.applyUpdate(doc, new Uint8Array(snapshotRows[0].snapshot));
  }

  const { rows: updateRows } = await pool.query<{ update: Buffer }>(
    "SELECT update FROM board_updates WHERE board_id = $1 AND created_at > $2 ORDER BY id",
    [boardId, since],
  );
  for (const row of updateRows) {
    Y.applyUpdate(doc, new Uint8Array(row.update));
  }

  return doc;
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
  const doc = await loading;
  inFlight.delete(boardId);
  docs.set(boardId, doc);
  return doc;
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
  await pool.query("INSERT INTO board_updates (board_id, update) VALUES ($1, $2)", [
    boardId,
    Buffer.from(update),
  ]);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test -w server -- docStore`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/ws/docStore.ts server/src/ws/docStore.test.ts
git commit -m "Add in-memory Yjs doc store backed by Postgres"
```

---

### Task 4: Role stub + WebSocket upgrade wiring

**Files:**
- Create: `server/src/ws/roleStub.ts`
- Test: `server/src/ws/roleStub.test.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Produces: `authenticateWSRequest(req: IncomingMessage): { boardId: string; role: "editor" | "viewer" } | null`, `type BoardRole = "editor" | "viewer"` — consumed by `index.ts` and `syncHandler.ts` (Task 5).

- [ ] **Step 1: Write the failing test**

`server/src/ws/roleStub.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { IncomingMessage } from "node:http";
import { authenticateWSRequest } from "./roleStub.js";

function req(url: string): IncomingMessage {
  return { url } as IncomingMessage;
}

describe("authenticateWSRequest", () => {
  it("extracts board id and role from a valid URL", () => {
    const result = authenticateWSRequest(req("/ws/boards/abc123?role=editor"));
    expect(result).toEqual({ boardId: "abc123", role: "editor" });
  });

  it("rejects a missing role", () => {
    expect(authenticateWSRequest(req("/ws/boards/abc123"))).toBeNull();
  });

  it("rejects an invalid role", () => {
    expect(authenticateWSRequest(req("/ws/boards/abc123?role=admin"))).toBeNull();
  });

  it("rejects a non-matching path", () => {
    expect(authenticateWSRequest(req("/health"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w server -- roleStub`
Expected: FAIL — `roleStub.ts` doesn't exist yet.

- [ ] **Step 3: Implement it**

`server/src/ws/roleStub.ts`:

```ts
import type { IncomingMessage } from "node:http";

export type BoardRole = "editor" | "viewer";

export interface StubAuthResult {
  boardId: string;
  role: BoardRole;
}

const BOARD_PATH = /^\/ws\/boards\/([^/]+)$/;

// ponytail: role comes from a query param instead of a real session,
// since sign-in (phase 08) and permissions (phase 09) don't exist yet.
// Replace this function's body with a cookie/JWT check + a
// board_members lookup once those phases land — nothing else in the
// sync engine needs to change, they only ever see { boardId, role }.
export function authenticateWSRequest(req: IncomingMessage): StubAuthResult | null {
  const [path, query] = (req.url ?? "").split("?");
  const match = BOARD_PATH.exec(path);
  if (!match) return null;

  const role = new URLSearchParams(query ?? "").get("role");
  if (role !== "editor" && role !== "viewer") return null;

  return { boardId: match[1], role };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test -w server -- roleStub`
Expected: PASS.

- [ ] **Step 5: Wire the WebSocket server into index.ts**

Replace `server/src/index.ts` with:

```ts
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { authenticateWSRequest } from "./ws/roleStub.js";
import { handleBoardConnection } from "./ws/syncHandler.js";

const port = process.env.PORT ?? 3001;

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const auth = authenticateWSRequest(req);
  if (!auth) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    handleBoardConnection(ws, auth.boardId, auth.role);
  });
});

server.listen(port, () => {
  console.log(`server listening on :${port}`);
});
```

This references `handleBoardConnection` from Task 5 — `index.ts` won't type-check until that task is done. That's expected; the two tasks are sequential.

- [ ] **Step 6: Commit**

```bash
git add server/src/ws/roleStub.ts server/src/ws/roleStub.test.ts
git commit -m "Add WebSocket role stub for board connections"
```

(`index.ts` is committed at the end of Task 5, once it compiles.)

---

### Task 5: Sync protocol handler

**Files:**
- Create: `server/src/ws/syncHandler.ts`
- Test: `server/src/ws/syncHandler.test.ts`

**Interfaces:**
- Consumes: `acquireDoc`, `releaseDoc`, `persistUpdate` from `docStore.ts`; `BoardRole` from `roleStub.ts`.
- Produces: `handleBoardConnection(ws: WebSocket, boardId: string, role: BoardRole): Promise<void>` — used by `index.ts` (Task 4) and `compaction.ts`'s trigger point (Task 6).

- [ ] **Step 1: Write the failing tests**

`server/src/ws/syncHandler.test.ts`:

```ts
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
    send(data: Uint8Array) {
      this.sent.push(data);
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
```

If `vi.spyOn(docStore, "acquireDoc")` doesn't intercept the calls `syncHandler.ts` makes (an ESM live-binding edge case), switch to `vi.mock("./docStore.js")` with `vi.mocked(docStore.acquireDoc).mockResolvedValue(doc)` instead — the assertions stay the same either way.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w server -- syncHandler`
Expected: FAIL — `syncHandler.ts` doesn't exist yet (the third test, needing no implementation, will pass on its own).

- [ ] **Step 3: Implement it**

`server/src/ws/syncHandler.ts`:

```ts
import type WebSocket from "ws";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import { acquireDoc, releaseDoc, persistUpdate } from "./docStore.js";
import { compactBoard } from "./compaction.js";
import type { BoardRole } from "./roleStub.js";

const MESSAGE_SYNC = 0;

const boardSockets = new Map<string, Set<WebSocket>>();

function broadcast(boardId: string, exclude: WebSocket, data: Uint8Array) {
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
  const doc = await acquireDoc(boardId);

  let sockets = boardSockets.get(boardId);
  if (!sockets) {
    sockets = new Set();
    boardSockets.set(boardId, sockets);
  }
  sockets.add(ws);

  const helloEncoder = encoding.createEncoder();
  encoding.writeVarUint(helloEncoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(helloEncoder, doc);
  ws.send(encoding.toUint8Array(helloEncoder));

  ws.on("message", (data: ArrayBuffer) => {
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const encoder = encoding.createEncoder();
    const messageType = decoding.readVarUint(decoder);
    if (messageType !== MESSAGE_SYNC) return; // awareness messages: presence is backlog, not handled

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
  });

  ws.on("close", () => {
    sockets!.delete(ws);
    releaseDoc(boardId);
    if (sockets!.size === 0) {
      boardSockets.delete(boardId);
      compactBoard(boardId).catch((err) => console.error("compaction failed", err));
    }
  });
}
```

This imports `compactBoard` from Task 6, which doesn't exist yet — expected, same sequencing note as Task 4.

If any `syncProtocol.*` export name doesn't match what's installed, check `node_modules/y-protocols/sync.js` (or its `.d.ts`) — the message flow above doesn't change, only the exact function names might.

- [ ] **Step 4: Run it to verify it passes**

Once Task 6 adds `compaction.ts`, run: `npm run test -w server -- syncHandler`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

Deferred to the end of Task 6, once `compactBoard` exists and the full file compiles.

---

### Task 6: Compaction

**Files:**
- Create: `server/src/ws/compaction.ts`
- Test: `server/src/ws/compaction.test.ts`

**Interfaces:**
- Produces: `compactBoard(boardId: string): Promise<void>` — consumed by `syncHandler.ts` (Task 5, already wired to call it on last-disconnect).

- [ ] **Step 1: Write the failing test**

`server/src/ws/compaction.test.ts`:

```ts
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import * as Y from "yjs";
import { runMigrations } from "../db/migrate.js";
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
    const boardId = `compaction-test-${Date.now()}`;

    const doc = new Y.Doc();
    doc.getMap("shapes").set("a", "1");
    await persistUpdate(boardId, Y.encodeStateAsUpdate(doc));
    doc.getMap("shapes").set("b", "2");
    await persistUpdate(boardId, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(new Y.Doc())));

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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -w server -- compaction`
Expected: FAIL — `compaction.ts` doesn't exist yet.

- [ ] **Step 3: Implement it**

`server/src/ws/compaction.ts`:

```ts
import * as Y from "yjs";
import { pool } from "../db/pool.js";

export async function compactBoard(boardId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: snapshotRows } = await client.query<{ snapshot: Buffer }>(
      "SELECT snapshot FROM board_snapshots WHERE board_id = $1 FOR UPDATE",
      [boardId],
    );

    const { rows: updateRows } = await client.query<{ id: number; update: Buffer }>(
      "SELECT id, update FROM board_updates WHERE board_id = $1 ORDER BY id",
      [boardId],
    );
    if (updateRows.length === 0) {
      await client.query("COMMIT");
      return;
    }

    const doc = new Y.Doc();
    if (snapshotRows[0]) {
      Y.applyUpdate(doc, new Uint8Array(snapshotRows[0].snapshot));
    }
    for (const row of updateRows) {
      Y.applyUpdate(doc, new Uint8Array(row.update));
    }

    const merged = Buffer.from(Y.encodeStateAsUpdate(doc));
    await client.query(
      `INSERT INTO board_snapshots (board_id, snapshot, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (board_id) DO UPDATE SET snapshot = $2, updated_at = now()`,
      [boardId, merged],
    );

    const maxId = updateRows[updateRows.length - 1].id;
    await client.query("DELETE FROM board_updates WHERE board_id = $1 AND id <= $2", [boardId, maxId]);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Run all server tests**

Run: `npm run test -w server`
Expected: PASS — every test file from Tasks 1–6, including `syncHandler.test.ts` which was blocked on this file.

- [ ] **Step 5: Verify the server builds and boots**

Run: `npm run build -w server`
Expected: no TypeScript errors.

Run: `npm run dev -w server`
Expected: `server listening on :3001` — confirms `index.ts` (Task 4) compiles now that `syncHandler.ts` and `compaction.ts` both exist.

- [ ] **Step 6: Commit**

```bash
git add server/src/ws server/src/index.ts
git commit -m "Add Yjs sync protocol handler with role enforcement and compaction"
```

---

### Task 7: Client wiring

**Files:**
- Create: `client/src/board/useBoardDoc.ts`
- Modify: `client/src/canvas/Canvas.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/vite.config.ts`
- Modify: `client/package.json`

**Interfaces:**
- Consumes: `ShapeObj`, `Tool` from `canvas/types.ts` (unchanged).
- Produces: `useBoardDoc(boardId: string, role: "editor" | "viewer"): { shapes: ShapeObj[]; upsertShape: (s: ShapeObj) => void; removeShape: (id: string) => void }`.

- [ ] **Step 1: Add client dependencies**

Edit `client/package.json` dependencies to add:

```json
"y-websocket": "^2.0.4",
"yjs": "^13.6.20"
```

Run: `npm install -w client`

- [ ] **Step 2: Proxy /ws in dev**

Replace `client/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
})
```

- [ ] **Step 3: Write the useBoardDoc hook**

`client/src/board/useBoardDoc.ts`:

```ts
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import type { ShapeObj } from "../canvas/types";

export function useBoardDoc(boardId: string, role: "editor" | "viewer") {
  const docRef = useRef<Y.Doc>();
  if (!docRef.current) {
    docRef.current = new Y.Doc();
  }

  const [shapes, setShapes] = useState<ShapeObj[]>([]);

  useEffect(() => {
    const doc = docRef.current!;
    const shapesMap = doc.getMap<Y.Map<unknown>>("shapes");

    const serverUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws/boards`;
    const provider = new WebsocketProvider(serverUrl, boardId, doc, {
      connect: true,
      params: { role },
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
  }, [boardId, role]);

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

  return { shapes, upsertShape, removeShape };
}
```

- [ ] **Step 4: Wire Canvas.tsx to the shared doc**

Replace `client/src/canvas/Canvas.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Rect, Ellipse, Transformer } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Tool } from "./types";
import { useBoardDoc } from "../board/useBoardDoc";

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;

interface CanvasProps {
  boardId: string;
  role: "editor" | "viewer";
  tool: Tool;
  onToolUsed: () => void;
}

export default function Canvas({ boardId, role, tool, onToolUsed }: CanvasProps) {
  const canEdit = role === "editor";
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef(new Map<string, Konva.Node>());

  const [size, setSize] = useState({ width: 0, height: 0 });
  const { shapes, upsertShape, removeShape } = useBoardDoc(boardId, role);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const drawingId = useRef<string | null>(null);
  const drawStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    if (!selectedId) {
      tr.nodes([]);
      return;
    }
    const node = shapeRefs.current.get(selectedId);
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, shapes]);

  function toStagePoint(stage: Konva.Stage) {
    const pointer = stage.getPointerPosition();
    if (!pointer) return { x: 0, y: 0 };
    const transform = stage.getAbsoluteTransform().copy().invert();
    return transform.point(pointer);
  }

  function handleWheel(e: KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const scaleBy = 1.05;
    const newScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, direction > 0 ? oldScale * scaleBy : oldScale / scaleBy),
    );

    stage.scale({ x: newScale, y: newScale });
    stage.position({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  }

  function handleStageMouseDown(e: KonvaEventObject<MouseEvent>) {
    const stage = stageRef.current;
    if (!stage) return;

    const clickedOnEmpty = e.target === stage;
    if (clickedOnEmpty) setSelectedId(null);

    if (!canEdit) return;
    if (tool === "select") return;
    if (!clickedOnEmpty) return;

    const point = toStagePoint(stage);
    drawStart.current = point;
    const id = crypto.randomUUID();
    drawingId.current = id;
    upsertShape({ id, type: tool as "rect" | "ellipse", x: point.x, y: point.y, width: 0, height: 0 });
  }

  function handleStageMouseMove() {
    const id = drawingId.current;
    const stage = stageRef.current;
    if (!id || !stage) return;

    const point = toStagePoint(stage);
    const start = drawStart.current;
    const current = shapes.find((s) => s.id === id);
    if (!current) return;
    upsertShape({
      ...current,
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  }

  function handleStageMouseUp() {
    if (!drawingId.current) return;
    const id = drawingId.current;
    drawingId.current = null;

    const shape = shapes.find((s) => s.id === id);
    if (shape && shape.width < 2 && shape.height < 2) {
      removeShape(id);
      onToolUsed();
      return;
    }
    setSelectedId(id);
    onToolUsed();
  }

  return (
    <div ref={containerRef} className="canvas-container">
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        draggable={tool === "select"}
        onWheel={handleWheel}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
      >
        <Layer>
          {shapes.map((shape) => {
            const commonProps = {
              ref: (node: Konva.Node | null) => {
                if (node) shapeRefs.current.set(shape.id, node);
                else shapeRefs.current.delete(shape.id);
              },
              x: shape.x,
              y: shape.y,
              fill: "oklch(93% 0.03 250)",
              stroke: "oklch(55% 0.18 250)",
              strokeWidth: 2,
              draggable: canEdit && tool === "select",
              onClick: () => setSelectedId(shape.id),
              onTap: () => setSelectedId(shape.id),
              onDragEnd: (e: KonvaEventObject<DragEvent>) => {
                const node = e.target;
                const isEllipse = shape.type === "ellipse";
                upsertShape({
                  ...shape,
                  x: isEllipse ? node.x() - shape.width / 2 : node.x(),
                  y: isEllipse ? node.y() - shape.height / 2 : node.y(),
                });
              },
              onTransformEnd: (e: KonvaEventObject<Event>) => {
                const node = e.target;
                const isEllipse = shape.type === "ellipse";
                const scaleX = node.scaleX();
                const scaleY = node.scaleY();
                node.scaleX(1);
                node.scaleY(1);
                const width = Math.max(2, shape.width * scaleX);
                const height = Math.max(2, shape.height * scaleY);
                upsertShape({
                  ...shape,
                  x: isEllipse ? node.x() - width / 2 : node.x(),
                  y: isEllipse ? node.y() - height / 2 : node.y(),
                  width,
                  height,
                });
              },
            };

            if (shape.type === "rect") {
              return <Rect key={shape.id} {...commonProps} width={shape.width} height={shape.height} />;
            }
            return (
              <Ellipse
                key={shape.id}
                {...commonProps}
                x={shape.x + shape.width / 2}
                y={shape.y + shape.height / 2}
                radiusX={shape.width / 2}
                radiusY={shape.height / 2}
              />
            );
          })}
          {canEdit && <Transformer ref={transformerRef} rotateEnabled={false} />}
        </Layer>
      </Stage>
    </div>
  );
}
```

Only `rect`/`ellipse` are rendered — that matches what Canvas already supported before this plan. The Yjs/Postgres data model this plan built isn't shape-type-specific, so text/freehand/image/sticky-note rendering can be added later (frontend work, phase 03) without touching the sync engine.

- [ ] **Step 5: Replace App.tsx with a throwaway connect form**

`client/src/App.tsx`:

```tsx
import { useState } from "react";
import Canvas from "./canvas/Canvas";
import Toolbar from "./canvas/Toolbar";
import type { Tool } from "./canvas/types";
import "./App.css";

// Throwaway stand-in for real sign-in + a board picker (phases 08/09/02
// aren't built yet) -- just enough to manually exercise the sync engine.
function ConnectForm({
  onConnect,
}: {
  onConnect: (boardId: string, role: "editor" | "viewer") => void;
}) {
  const [boardId, setBoardId] = useState("demo-board");
  const [role, setRole] = useState<"editor" | "viewer">("editor");

  return (
    <form
      className="connect-form"
      onSubmit={(e) => {
        e.preventDefault();
        onConnect(boardId, role);
      }}
    >
      <h1>Join a board</h1>
      <input value={boardId} onChange={(e) => setBoardId(e.target.value)} placeholder="Board ID" required />
      <select value={role} onChange={(e) => setRole(e.target.value as "editor" | "viewer")}>
        <option value="editor">Editor</option>
        <option value="viewer">Viewer</option>
      </select>
      <button type="submit">Join</button>
    </form>
  );
}

function App() {
  const [tool, setTool] = useState<Tool>("select");
  const [session, setSession] = useState<{ boardId: string; role: "editor" | "viewer" } | null>(null);

  if (!session) {
    return <ConnectForm onConnect={(boardId, role) => setSession({ boardId, role })} />;
  }

  return (
    <div className="app">
      {session.role === "editor" && <Toolbar tool={tool} onChange={setTool} />}
      <Canvas
        boardId={session.boardId}
        role={session.role}
        tool={tool}
        onToolUsed={() => setTool("select")}
      />
    </div>
  );
}

export default App;
```

- [ ] **Step 6: Manual end-to-end verification**

Prerequisite: `docker compose up -d postgres`, `npm run migrate -w server`, `npm run dev -w server`, `npm run dev -w client`.

1. Open the client URL in two browser tabs. In both, enter the same Board ID (e.g. `demo-board`) and role `Editor`, click Join.
2. Draw a rectangle in tab 1 — confirm it appears in tab 2 within a second, with no page refresh.
3. Drag/resize a shape in tab 2 — confirm tab 1 updates live.
4. Open a third tab, same Board ID, role `Viewer`. Confirm: no toolbar, and shapes drawn in tabs 1/2 still appear live.
5. In the viewer tab's browser devtools console, confirm there's no way to trigger a draw (toolbar isn't rendered, `canEdit` is false) — this is the client-side half of the lock; Task 5's automated test already covers the server-side half (viewer writes are dropped even if a client were modified to send them anyway).
6. Close all tabs, wait a few seconds, then run in `psql`: `SELECT board_id, count(*) FROM board_updates GROUP BY board_id;` — expect `0` rows for `demo-board` (compaction ran on last disconnect) and `SELECT board_id FROM board_snapshots;` to include it.

- [ ] **Step 7: Commit**

```bash
git add client/src client/vite.config.ts client/package.json client/package-lock.json
git commit -m "Wire canvas to the Yjs sync engine with a throwaway board/role picker"
```

---

## Non-goals for this plan (unchanged from the spec)

- Sign-in (Google/password), the boards REST API, and any real board-picker/dashboard UI — separate phases, not started.
- Live cursors / presence.
- Image upload mechanics.
- Rendering for text, freehand, image, and sticky-note shape types — the data model supports them; the canvas UI to create/render them is separate frontend work.
