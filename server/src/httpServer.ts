import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import { createApp } from "./app.js";
import { authenticateWSRequest } from "./ws/roleStub.js";
import { handleBoardConnection } from "./ws/syncHandler.js";

/**
 * Builds the HTTP + WebSocket server without listening, so that tests can run
 * the real wiring on an ephemeral port instead of re-implementing it.
 */
export function createBoardServer(): Server {
  const server = createServer(createApp());

  // maxPayload caps a single frame; ws defaults to 100 MiB, which is an OOM on a
  // small instance. Whiteboard updates are kilobytes.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  wss.on("error", (err) => console.error("websocket server error", err));

  server.on("upgrade", (req, socket, head) => {
    // Registered first: an unhandled 'error' on the raw socket (a peer that
    // resets the connection mid-handshake, or before the 401 write flushes)
    // would otherwise crash the process.
    socket.on("error", (err) => console.error("upgrade socket error", err));

    // authenticateWSRequest now does a DB lookup, so this handler is async.
    // Wrapped in an IIFE with .catch() so a rejection (bad cookie parsing,
    // an unexpected DB error not already caught inside) can't become an
    // unhandled rejection that kills the process — same class of bug fixed
    // here once already.
    (async () => {
      const auth = await authenticateWSRequest(req);
      if (!auth) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        handleBoardConnection(ws, auth.boardId, auth.role).catch((err) => {
          console.error("failed to handle board connection", err);
          // No releaseDoc here: either acquireDoc itself rejected (it rolls its own
          // ref count back) or the doc was acquired and handleBoardConnection has
          // already registered its 'close' handler, which this close() triggers.
          ws.close();
        });
      });
    })().catch((err) => {
      console.error("failed to authenticate WS upgrade", err);
      socket.destroy();
    });
  });

  return server;
}
