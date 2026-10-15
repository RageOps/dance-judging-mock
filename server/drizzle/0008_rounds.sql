CREATE TYPE "public"."callback_vote" AS ENUM('yes', 'alternate', 'no');--> statement-breakpoint
CREATE TYPE "public"."division_scoring_mode" AS ENUM('numeric', 'rounds');--> statement-breakpoint
CREATE TYPE "public"."round_status" AS ENUM('pending', 'active', 'complete');--> statement-breakpoint
CREATE TYPE "public"."round_type" AS ENUM('callback', 'relative_placement');--> statement-breakpoint
CREATE TABLE "callback_votes" (
	"judge_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"competitor_id" uuid NOT NULL,
	"vote" "callback_vote" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "callback_votes_judge_id_round_id_competitor_id_pk" PRIMARY KEY("judge_id","round_id","competitor_id")
);
--> statement-breakpoint
CREATE TABLE "division_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"division_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "round_type" NOT NULL,
	"position" integer NOT NULL,
	"status" "round_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "heat_entries" (
	"heat_id" uuid NOT NULL,
	"competitor_id" uuid NOT NULL,
	CONSTRAINT "heat_entries_heat_id_competitor_id_pk" PRIMARY KEY("heat_id","competitor_id")
);
--> statement-breakpoint
CREATE TABLE "heats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "placements" (
	"judge_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"competitor_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "placements_judge_id_round_id_competitor_id_pk" PRIMARY KEY("judge_id","round_id","competitor_id"),
	CONSTRAINT "placements_rank_check" CHECK ("placements"."rank" >= 1)
);
--> statement-breakpoint
CREATE TABLE "round_submissions" (
	"judge_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"status" "score_submission_status" DEFAULT 'editing' NOT NULL,
	"scope" "judging_scope" DEFAULT 'both' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "round_submissions_judge_id_round_id_pk" PRIMARY KEY("judge_id","round_id")
);
--> statement-breakpoint
ALTER TABLE "divisions" ADD COLUMN "scoring_mode" "division_scoring_mode" DEFAULT 'numeric' NOT NULL;--> statement-breakpoint
ALTER TABLE "callback_votes" ADD CONSTRAINT "callback_votes_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "callback_votes" ADD CONSTRAINT "callback_votes_submission_fk" FOREIGN KEY ("judge_id","round_id") REFERENCES "public"."round_submissions"("judge_id","round_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "division_rounds" ADD CONSTRAINT "division_rounds_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heat_entries" ADD CONSTRAINT "heat_entries_heat_id_heats_id_fk" FOREIGN KEY ("heat_id") REFERENCES "public"."heats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heat_entries" ADD CONSTRAINT "heat_entries_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heats" ADD CONSTRAINT "heats_round_id_division_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."division_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_submission_fk" FOREIGN KEY ("judge_id","round_id") REFERENCES "public"."round_submissions"("judge_id","round_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_submissions" ADD CONSTRAINT "round_submissions_judge_id_users_id_fk" FOREIGN KEY ("judge_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_submissions" ADD CONSTRAINT "round_submissions_round_id_division_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."division_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "division_rounds_division_position_unique" ON "division_rounds" USING btree ("division_id","position");