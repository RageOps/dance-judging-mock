CREATE TYPE "public"."judging_scope" AS ENUM('lead', 'follow', 'both');--> statement-breakpoint
ALTER TABLE "divisions" ADD COLUMN "show_competitor_names" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "score_submissions" ADD COLUMN "scope" "judging_scope" DEFAULT 'both' NOT NULL;