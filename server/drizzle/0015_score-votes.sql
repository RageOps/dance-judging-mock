CREATE TABLE "score_votes" (
	"judge_id" uuid NOT NULL,
	"division_id" uuid NOT NULL,
	"competitor_id" uuid NOT NULL,
	"vote" "callback_vote" NOT NULL,
	"alt_rank" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_votes_judge_id_division_id_competitor_id_pk" PRIMARY KEY("judge_id","division_id","competitor_id"),
	CONSTRAINT "score_votes_alt_rank_check" CHECK ("score_votes"."alt_rank" between 1 and 2)
);
--> statement-breakpoint
ALTER TABLE "score_votes" ADD CONSTRAINT "score_votes_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_votes" ADD CONSTRAINT "score_votes_submission_fk" FOREIGN KEY ("judge_id","division_id") REFERENCES "public"."score_submissions"("judge_id","division_id") ON DELETE cascade ON UPDATE no action;