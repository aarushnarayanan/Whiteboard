import { bigserial, customType, index, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
});

export const boardRole = pgEnum("board_role", ["owner", "editor", "viewer"]);

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
