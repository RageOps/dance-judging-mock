CREATE TYPE "public"."score_submission_status" AS ENUM('editing', 'locked');--> statement-breakpoint
CREATE TABLE "judge_event_assignments" (
	"judge_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "judge_event_assignments_judge_id_event_id_pk" PRIMARY KEY("judge_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "score_submissions" (
	"judge_id" uuid NOT NULL,
	"division_id" uuid NOT NULL,
	"status" "score_submission_status" DEFAULT 'editing' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_submissions_judge_id_division_id_pk" PRIMARY KEY("judge_id","division_id")
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"judge_id" uuid NOT NULL,
	"division_id" uuid NOT NULL,
	"competitor_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scores_judge_id_division_id_competitor_id_pk" PRIMARY KEY("judge_id","division_id","competitor_id"),
	CONSTRAINT "scores_range_check" CHECK ("scores"."score" between 1 and 10)
);
--> statement-breakpoint
ALTER TABLE "division_registrations" DROP CONSTRAINT "division_registrations_competitor_id_competitors_id_fk";
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "judge_event_assignments" ADD CONSTRAINT "judge_event_assignments_judge_id_users_id_fk" FOREIGN KEY ("judge_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_event_assignments" ADD CONSTRAINT "judge_event_assignments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_submissions" ADD CONSTRAINT "score_submissions_judge_id_users_id_fk" FOREIGN KEY ("judge_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_submissions" ADD CONSTRAINT "score_submissions_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_submission_fk" FOREIGN KEY ("judge_id","division_id") REFERENCES "public"."score_submissions"("judge_id","division_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "division_registrations" ADD CONSTRAINT "division_registrations_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;