# Real-Time Collaboration — Design

Status: approved, pending spec review by user before implementation planning.
Phase: 04 (architecture map, phase 04 of `stack-blueprint`). Also resolves the two remaining open items in phase 08 (auth session mechanics), which this design depends on.

## Goal

Multiple people editing the same board see each other's shapes, text, freehand strokes, images, and sticky notes appear live, with edits from different people merging automatically — including when two people touch the same shape at once. A board's content survives after everyone disconnects.

## Non-goals (backlog, not this design)

- Live cursors / "who's viewing" presence — deferred; Yjs's Awareness API covers this later without changing anything here.
- Image upload mechanics (phase 10) — the shape schema below has a slot for an image URL, but how that URL gets populated (direct-to-bucket vs. proxied upload) is a separate design.
- Partial-document / region-level edit permissions — backlog per the original auth & permissions plan, no schema decisions made around it here.

## Dependencies

This design assumes the phase 08 sign-in flow (Google OAuth + email/password, issuing the JWT described below) already exists — it defines how a board connection *authenticates using* a token, not how that token gets issued in the first place. Neither flow has been implemented yet; the implementation plan for this design needs to build basic sign-in (enough to issue a valid cookie) as a prerequisite, before the WebSocket auth step in this doc can be tested end to end.

## Architecture

The browser holds a `Y.Doc` (Yjs's shared document object) for whichever board is open. `y-websocket` — Yjs's official companion library — connects that `Y.Doc` to the server over a WebSocket and handles the sync handshake, update broadcasting, and reconnection. The server keeps its own in-memory `Y.Doc` per board while at least one person is connected to it, and Postgres holds the durable copy.

Redis is not part of this design. Its usual job — relaying updates between multiple server processes — doesn't apply while the server runs as a single process (settled in phase 14); it's dropped rather than provisioned unused.

## Data model

### The `Y.Doc` shape

A board's document contains one `Y.Map` named `shapes`, keyed by shape id. Each value is itself a `Y.Map` holding that shape's properties:

- `type`: `"rect" | "ellipse" | "text" | "freehand" | "image" | "sticky-note"`
- `x`, `y`, `width`, `height`
- `style` (fill, stroke, etc.)
- type-specific fields:
  - `text` / `sticky-note`: a `content` string field
  - `freehand`: a `points` field, a `Y.Array` of `{x, y}` appended to as someone draws
  - `image`: a `url` field pointing at wherever phase 10's file storage ends up (empty/unset until that phase lands)

Properties are nested in per-shape `Y.Map`s — not one flat JSON blob — specifically so Yjs can merge edits to different shapes, or different properties of the same shape, without conflict. This is the property that makes "two people drag the same rectangle at once" resolve automatically instead of needing hand-written collision logic.

### Postgres schema (new tables)

```
boards
  id            uuid primary key
  title         text
  owner_id      uuid references users(id)
  created_at    timestamptz

board_members
  user_id       uuid references users(id)
  board_id      uuid references boards(id)
  role          text  -- 'owner' | 'editor' | 'viewer', exact set pending phase 09
  primary key (user_id, board_id)

board_updates
  id            bigserial primary key
  board_id      uuid references boards(id)
  update        bytea       -- one raw Yjs update chunk
  created_at    timestamptz

board_snapshots
  board_id      uuid primary key references boards(id)
  snapshot      bytea       -- a merged Yjs state, via Y.mergeUpdates
  updated_at    timestamptz
```

Opening a board: read `board_snapshots` for that board (if any), then replay `board_updates` rows created after `snapshot.updated_at`, applying each via `Y.applyUpdate`. This reconstructs the current document without needing the full history every time.

### Persistence & compaction

Every incoming update from a connected client gets appended to `board_updates` as it arrives — this is the durable, append-only record. A periodic compaction job (run on a timer, or triggered when a board's last connection closes) does:

1. Load the current snapshot (or an empty doc if none exists).
2. Apply all `board_updates` rows newer than the snapshot.
3. Write the merged result back to `board_snapshots` via `Y.encodeStateAsUpdate`.
4. Delete the now-merged rows from `board_updates`.

This keeps `board_updates` small (only holds updates since the last compaction) while `board_snapshots` stays a single row per board — the same shape Notion/Figma/Google Docs use (operation log for durability, materialized into a fast-loading checkpoint), built here entirely on Yjs's own update-merging primitives rather than custom replay logic.

## Auth token mechanics (resolves phase 08)

- The JWT issued at sign-in (via Google or password, per the existing auth plan) lives in an **httpOnly cookie** — not `localStorage` — so it's sent automatically on every request, including the WebSocket handshake, and is never readable by page JavaScript.
- Two tokens: a short-lived **access token**, and a **refresh token** that rotates on a 7–30 day cycle. The exact access-token lifetime and refresh mechanics are an implementation-time detail, not re-litigated here.

This was resolved as part of this design because it directly determines how the WebSocket connection authenticates below — a header-based token doesn't reach a WebSocket handshake, since browsers can't attach custom headers to a WS connection request.

## Network & auth flow

1. Sign-in issues the httpOnly cookie described above.
2. Client opens a board → `y-websocket` connects to `/ws/boards/:id`; the cookie is sent automatically as part of the WebSocket upgrade request.
3. Server reads the cookie during the upgrade request, verifies the access token, and looks up the connecting user's role for `board_id` in `board_members`.
4. No row in `board_members` for this (user, board) pair → connection is refused outright.
5. Role = `viewer` → connection is accepted read-only: the server subscribes them to outgoing updates (via `y-websocket`) but any update *they* send is dropped before it's applied to the in-memory `Y.Doc` or written to `board_updates`. This is the server-side half of the hard read-only guarantee — the client-side half (disabled toolbar, non-draggable shapes) is a separate, existing UI concern.
6. Role = `editor` or `owner` → full read-write, handled from there by `y-websocket`'s normal sync protocol.

## Testing

- **Merge convergence**: two in-memory `Y.Doc`s are edited independently (no server involved), synced against each other, and asserted to converge to identical state. Proves the core merge guarantee without a browser.
- **Role enforcement**: a simulated `viewer`-role connection sends an update; assert it's dropped and the server's in-memory document (and `board_updates`) are unchanged.
- **Manual**: two browser tabs, two accounts (one editor, one viewer), confirm live sync and the viewer lock both behave as designed.

Both automated checks fit Vitest, which pairs naturally with the existing Vite build tool — no new test framework decision required for this design.
