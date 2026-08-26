import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { asyncHandler } from "../asyncHandler.js";
import { db } from "../db/index.js";
import { boardMembers, boards, users } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";

export const boardsRouter = Router();

boardsRouter.use(requireAuth);

boardsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { title } = req.body ?? {};
    const boardTitle = typeof title === "string" && title.trim() !== "" ? title : "Untitled board";

    const board = await db.transaction(async (tx) => {
      const [board] = await tx.insert(boards).values({ title: boardTitle }).returning();
      await tx.insert(boardMembers).values({ userId: req.userId!, boardId: board.id, role: "owner" });
      return board;
    });

    res.status(201).json({ id: board.id, title: board.title, role: "owner" as const });
  }),
);

boardsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = await db
      .select({
        id: boards.id,
        title: boards.title,
        thumbnail: boards.thumbnail,
        updatedAt: boards.updatedAt,
        role: boardMembers.role,
      })
      .from(boardMembers)
      .innerJoin(boards, eq(boardMembers.boardId, boards.id))
      .where(eq(boardMembers.userId, req.userId!));

    res.json(
      rows.map((row) => ({
        ...row,
        thumbnail: row.thumbnail ? `data:image/png;base64,${row.thumbnail.toString("base64")}` : null,
      })),
    );
  }),
);

boardsRouter.post(
  "/:id/thumbnail",
  asyncHandler(async (req, res) => {
    const boardId = req.params.id;
    const { thumbnail } = req.body ?? {};
    if (typeof thumbnail !== "string" || !thumbnail.startsWith("data:image/")) {
      res.status(400).json({ error: "thumbnail must be a data:image/... URL" });
      return;
    }

    const [membership] = await db
      .select()
      .from(boardMembers)
      .where(and(eq(boardMembers.userId, req.userId!), eq(boardMembers.boardId, boardId)));
    if (!membership) {
      res.status(404).json({ error: "board not found" });
      return;
    }

    const base64 = thumbnail.slice(thumbnail.indexOf(",") + 1);
    await db
      .update(boards)
      .set({ thumbnail: Buffer.from(base64, "base64"), updatedAt: new Date() })
      .where(eq(boards.id, boardId));

    res.status(200).json({ ok: true });
  }),
);

boardsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const boardId = req.params.id;
    const { title } = req.body ?? {};
    if (typeof title !== "string" || title.trim() === "") {
      res.status(400).json({ error: "title is required" });
      return;
    }

    const [membership] = await db
      .select()
      .from(boardMembers)
      .where(and(eq(boardMembers.userId, req.userId!), eq(boardMembers.boardId, boardId)));
    if (!membership || membership.role === "viewer") {
      res.status(403).json({ error: "you don't have permission to rename this board" });
      return;
    }

    await db.update(boards).set({ title, updatedAt: new Date() }).where(eq(boards.id, boardId));
    res.status(200).json({ ok: true });
  }),
);

boardsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const boardId = req.params.id;

    const [membership] = await db
      .select()
      .from(boardMembers)
      .where(and(eq(boardMembers.userId, req.userId!), eq(boardMembers.boardId, boardId)));
    if (!membership || membership.role !== "owner") {
      res.status(403).json({ error: "only the owner can delete this board" });
      return;
    }

    // board_members, board_updates, and board_snapshots all cascade-delete
    // from this via their foreign keys (migration 0003) — nothing else to clean up.
    await db.delete(boards).where(eq(boards.id, boardId));
    res.status(200).json({ ok: true });
  }),
);

boardsRouter.post(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const boardId = req.params.id;
    const { email, role } = req.body ?? {};
    if (typeof email !== "string" || (role !== "editor" && role !== "viewer")) {
      res.status(400).json({ error: "email and role ('editor' or 'viewer') are required" });
      return;
    }

    const [requesterMembership] = await db
      .select()
      .from(boardMembers)
      .where(and(eq(boardMembers.userId, req.userId!), eq(boardMembers.boardId, boardId)));
    if (!requesterMembership || requesterMembership.role !== "owner") {
      res.status(403).json({ error: "only the owner can share this board" });
      return;
    }

    const [invitee] = await db.select().from(users).where(eq(users.email, email));
    if (!invitee) {
      res.status(404).json({ error: "no account found for that email" });
      return;
    }

    await db
      .insert(boardMembers)
      .values({ userId: invitee.id, boardId, role })
      .onConflictDoUpdate({ target: [boardMembers.userId, boardMembers.boardId], set: { role } });

    res.status(200).json({ ok: true });
  }),
);

boardsRouter.get(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const boardId = req.params.id;

    const [requesterMembership] = await db
      .select()
      .from(boardMembers)
      .where(and(eq(boardMembers.userId, req.userId!), eq(boardMembers.boardId, boardId)));
    if (!requesterMembership) {
      res.status(404).json({ error: "board not found" });
      return;
    }

    const rows = await db
      .select({ userId: users.id, email: users.email, name: users.name, role: boardMembers.role })
      .from(boardMembers)
      .innerJoin(users, eq(boardMembers.userId, users.id))
      .where(eq(boardMembers.boardId, boardId));

    res.json(rows);
  }),
);

boardsRouter.delete(
  "/:id/members/:userId",
  asyncHandler(async (req, res) => {
    const boardId = req.params.id;
    const targetUserId = req.params.userId;

    const [requesterMembership] = await db
      .select()
      .from(boardMembers)
      .where(and(eq(boardMembers.userId, req.userId!), eq(boardMembers.boardId, boardId)));
    if (!requesterMembership || requesterMembership.role !== "owner") {
      res.status(403).json({ error: "only the owner can remove members" });
      return;
    }

    const [targetMembership] = await db
      .select()
      .from(boardMembers)
      .where(and(eq(boardMembers.userId, targetUserId), eq(boardMembers.boardId, boardId)));
    if (!targetMembership) {
      res.status(404).json({ error: "that person isn't a member of this board" });
      return;
    }
    if (targetMembership.role === "owner") {
      res.status(400).json({ error: "can't remove the board owner" });
      return;
    }

    await db
      .delete(boardMembers)
      .where(and(eq(boardMembers.userId, targetUserId), eq(boardMembers.boardId, boardId)));
    res.status(200).json({ ok: true });
  }),
);
