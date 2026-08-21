ALTER TABLE "board_members" DROP CONSTRAINT "board_members_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "board_members" DROP CONSTRAINT "board_members_board_id_boards_id_fk";
--> statement-breakpoint
ALTER TABLE "board_snapshots" DROP CONSTRAINT "board_snapshots_board_id_boards_id_fk";
--> statement-breakpoint
ALTER TABLE "board_updates" DROP CONSTRAINT "board_updates_board_id_boards_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_members" ADD CONSTRAINT "board_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_members" ADD CONSTRAINT "board_members_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_snapshots" ADD CONSTRAINT "board_snapshots_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_updates" ADD CONSTRAINT "board_updates_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
