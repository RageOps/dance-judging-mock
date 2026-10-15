CREATE TABLE "round_impressions" (
	"judge_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"competitor_id" uuid NOT NULL,
	"score" real NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "round_impressions_judge_id_round_id_competitor_id_pk" PRIMARY KEY("judge_id","round_id","competitor_id"),
	CONSTRAINT "round_impressions_score_check" CHECK ("round_impressions"."score" >= 1 and "round_impressions"."score" <= 10)
);
--> statement-breakpoint
ALTER TABLE "round_impressions" ADD CONSTRAINT "round_impressions_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_impressions" ADD CONSTRAINT "round_impressions_submission_fk" FOREIGN KEY ("judge_id","round_id") REFERENCES "public"."round_submissions"("judge_id","round_id") ON DELETE cascade ON UPDATE no action;