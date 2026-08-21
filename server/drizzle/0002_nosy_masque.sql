CREATE TYPE "public"."board_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "board_members" (
	"user_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"role" "board_role" NOT NULL,
	CONSTRAINT "board_members_user_id_board_id_pk" PRIMARY KEY("user_id","board_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT 'Untitled board' NOT NULL,
	"thumbnail" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_snapshots" ALTER COLUMN "board_id" SET DATA TYPE uuid USING "board_id"::uuid;--> statement-breakpoint
ALTER TABLE "board_updates" ALTER COLUMN "board_id" SET DATA TYPE uuid USING "board_id"::uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_members" ADD CONSTRAINT "board_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_members" ADD CONSTRAINT "board_members_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_snapshots" ADD CONSTRAINT "board_snapshots_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_updates" ADD CONSTRAINT "board_updates_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
