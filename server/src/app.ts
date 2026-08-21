import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { authRouter } from "./auth/routes.js";
import { boardsRouter } from "./boards/routes.js";

export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: "2mb" })); // thumbnails ride in as base64 JSON

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/auth", authRouter);
  app.use("/boards", boardsRouter);

  // Last-resort net: an error passed to next() (including from asyncHandler)
  // lands here instead of crashing the process or hanging the request.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("request error", err);
    if (res.headersSent) return;
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
