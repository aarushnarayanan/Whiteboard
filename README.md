# Whiteboard

A real-time collaborative whiteboard — sticky notes, shapes, connectors, tables, images, and version history, synced live across sessions.

## Link To Try

https://whiteboard-production-9b84.up.railway.app/

## Stack

- **Client:** React, Konva (canvas rendering), Yjs (CRDT sync)
- **Server:** Express, ws (WebSocket), Yjs, Postgres (Drizzle ORM)
- **Storage:** Cloudflare R2 (images)

## Setup

```bash
npm install
docker compose up -d      # Postgres
npm run migrate -w server
```

Create `server/.env` with:

```
PORT=3001
DATABASE_URL=postgres://whiteboard:whiteboard@localhost:5432/whiteboard
JWT_SECRET=
APP_URL=http://localhost:5173
EMAIL_FROM=
EMAIL_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

## Run

```bash
npm run dev:server   # http://localhost:3001
npm run dev:client   # http://localhost:5173
```

## Test

```bash
npm test -w server
```

## Project layout

- `client/` — React app (canvas, boards, auth UI)
- `server/` — Express API + WebSocket sync server
- `docs/BACKLOG.md` — feature backlog and build order
