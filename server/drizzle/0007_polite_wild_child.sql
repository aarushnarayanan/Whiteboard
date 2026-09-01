ALTER TABLE "tags" ADD COLUMN "color" text DEFAULT 'oklch(60% 0.18 0)' NOT NULL;
--> statement-breakpoint
WITH ranked AS (
	SELECT "id", ROW_NUMBER() OVER (PARTITION BY "user_id" ORDER BY "created_at") - 1 AS rn
	FROM "tags"
)
UPDATE "tags" SET "color" = (ARRAY[
	'oklch(60% 0.18 0)', 'oklch(60% 0.18 36)', 'oklch(60% 0.18 72)', 'oklch(60% 0.18 108)',
	'oklch(60% 0.18 144)', 'oklch(60% 0.18 180)', 'oklch(60% 0.18 216)', 'oklch(60% 0.18 252)',
	'oklch(60% 0.18 288)', 'oklch(60% 0.18 324)'
])[(ranked.rn % 10) + 1]
FROM ranked
WHERE "tags"."id" = ranked."id";