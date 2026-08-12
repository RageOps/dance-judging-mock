CREATE TABLE "division_pairs" (
	"division_id" uuid NOT NULL,
	"lead_competitor_id" uuid NOT NULL,
	"follow_competitor_id" uuid NOT NULL,
	CONSTRAINT "division_pairs_division_id_lead_competitor_id_pk" PRIMARY KEY("division_id","lead_competitor_id")
);
--> statement-breakpoint
ALTER TABLE "division_pairs" ADD CONSTRAINT "division_pairs_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "division_pairs" ADD CONSTRAINT "division_pairs_lead_competitor_id_competitors_id_fk" FOREIGN KEY ("lead_competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "division_pairs" ADD CONSTRAINT "division_pairs_follow_competitor_id_competitors_id_fk" FOREIGN KEY ("follow_competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "division_pairs_division_follow_unique" ON "division_pairs" USING btree ("division_id","follow_competitor_id");