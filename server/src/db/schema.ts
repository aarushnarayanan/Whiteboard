import {
  bigserial,
  boolean,
  customType,
  doublePrecision,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  googleId: text("google_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const boards = pgTable("boards", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull().default("Untitled board"),
  thumbnail: bytea("thumbnail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const boardRole = pgEnum("board_role", ["owner", "editor", "viewer"]);

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("oklch(60% 0.18 0)"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const boardMembers = pgTable(
  "board_members",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    role: boardRole("role").notNull(),
    starred: boolean("starred").notNull().default(false),
    tagId: uuid("tag_id").references(() => tags.id, { onDelete: "set null" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.boardId] })],
);

export const boardUpdates = pgTable(
  "board_updates",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    update: bytea("update").notNull(),
    // Nullable: the update-log rows this points at are themselves routinely
    // deleted by compaction, so this is only ever used to compute a version's
    // contributor list at snapshot time, not as a durable audit trail.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("board_updates_board_id_idx").on(table.boardId, table.id)],
);

export const boardSnapshots = pgTable("board_snapshots", {
  boardId: uuid("board_id")
    .primaryKey()
    .references(() => boards.id, { onDelete: "cascade" }),
  snapshot: bytea("snapshot").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// F8 — version history. Deliberately a full Yjs-state snapshot per row, not
// an operation log: board_updates is already routinely compacted away (see
// compaction.ts), so a log-based history would have gaps every time a board
// goes briefly idle. label is null for an automatic snapshot (session end,
// or the safety-net taken right before a restore) and set for a user-named
// version. contributorIds is computed once at snapshot time from
// board_updates rows since the previous version, not recomputed on read.
export const boardVersions = pgTable(
  "board_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    snapshot: bytea("snapshot").notNull(),
    label: text("label"),
    contributorIds: uuid("contributor_ids").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("board_versions_board_id_idx").on(table.boardId, table.createdAt)],
);

// A comment pins to exactly one of a fixed canvas point (x, y) or a shape —
// enforced in the route handler, not here. A shape lives inside the board's
// Yjs doc, not a Postgres row, so shapeId is a plain opaque id, no FK.
export const commentThreads = pgTable("comment_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  x: doublePrecision("x"),
  y: doublePrecision("y"),
  shapeId: text("shape_id"),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const commentMessages = pgTable(
  "comment_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => commentThreads.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    mentionedUserIds: uuid("mentioned_user_ids").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("comment_messages_thread_id_idx").on(table.threadId, table.createdAt)],
);
