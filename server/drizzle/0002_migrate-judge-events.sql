INSERT INTO "judge_event_assignments" ("judge_id", "event_id")
SELECT "id", "event_id"
FROM "users"
WHERE "role" = 'judge' AND "event_id" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "event_id";