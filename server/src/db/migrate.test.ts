import { describe, it, expect, afterAll } from "vitest";
import { runMigrations } from "./migrate.js";
import { pool } from "./pool.js";

describe("runMigrations", () => {
  it("creates the board sync tables", async () => {
    await runMigrations();
    const { rows } = await pool.query(
      "SELECT to_regclass('public.board_updates') AS updates, to_regclass('public.board_snapshots') AS snapshots",
    );
    expect(rows[0].updates).toBe("board_updates");
    expect(rows[0].snapshots).toBe("board_snapshots");
  });

  afterAll(async () => {
    await pool.end();
  });
});
