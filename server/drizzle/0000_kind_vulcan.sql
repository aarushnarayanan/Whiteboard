CREATE TABLE IF NOT EXISTS "board_snapshots" (
	"board_id" text PRIMARY KEY NOT NULL,
	"snapshot" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "board_updates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"update" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_updates_board_id_idx" ON "board_updates" USING btree ("board_id","id");