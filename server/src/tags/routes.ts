import { Router } from "express";
import { and, asc, eq } from "drizzle-orm";
import { asyncHandler } from "../asyncHandler.js";
import { db } from "../db/index.js";
import { tags } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { pickTagColor } from "./tagColors.js";

export const tagsRouter = Router();

tagsRouter.use(requireAuth);

const MAX_TAGS_PER_USER = 10;

tagsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const rows = await db
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(tags)
      .where(eq(tags.userId, req.userId!))
      .orderBy(asc(tags.createdAt));
    res.json(rows);
  }),
);

tagsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { name } = req.body ?? {};
    if (typeof name !== "string" || name.trim() === "") {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const trimmed = name.trim();

    const existingTags = await db
      .select({ name: tags.name, color: tags.color })
      .from(tags)
      .where(eq(tags.userId, req.userId!));
    if (existingTags.length >= MAX_TAGS_PER_USER) {
      res.status(400).json({ error: `you can have up to ${MAX_TAGS_PER_USER} tags` });
      return;
    }
    if (existingTags.some((t) => t.name === trimmed)) {
      res.status(409).json({ error: "you already have a tag with that name" });
      return;
    }

    const color = pickTagColor(existingTags.map((t) => t.color));
    const [tag] = await db.insert(tags).values({ userId: req.userId!, name: trimmed, color }).returning();
    res.status(201).json({ id: tag.id, name: tag.name, color: tag.color });
  }),
);

tagsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const [existing] = await db
      .select()
      .from(tags)
      .where(and(eq(tags.id, req.params.id), eq(tags.userId, req.userId!)));
    if (!existing) {
      res.status(404).json({ error: "tag not found" });
      return;
    }

    await db.delete(tags).where(eq(tags.id, req.params.id));
    res.status(200).json({ ok: true });
  }),
);
