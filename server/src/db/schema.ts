import { bigserial, customType, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const boardUpdates = pgTable(
  "board_updates",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    boardId: text("board_id").notNull(),
    update: bytea("update").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("board_updates_board_id_idx").on(table.boardId, table.id)],
);

export const boardSnapshots = pgTable("board_snapshots", {
  boardId: text("board_id").primaryKey(),
  snapshot: bytea("snapshot").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
