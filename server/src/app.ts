import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { authRouter } from "./auth/routes.js";
import { boardsRouter } from "./boards/routes.js";

const clientDist = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");

export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: "2mb" })); // thumbnails ride in as base64 JSON

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/auth", authRouter);
  app.use("/boards", boardsRouter);

  if (process.env.NODE_ENV === "production") {
    // This one process also serves the built client in production — no
    // separate static host needed, matching the single-process design.
    // In dev, Vite's own dev server handles the client (see vite.config.ts).
    app.use(express.static(clientDist));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  // Last-resort net: an error passed to next() (including from asyncHandler)
  // lands here instead of crashing the process or hanging the request.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("request error", err);
    if (res.headersSent) return;
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
