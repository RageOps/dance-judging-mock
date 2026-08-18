ALTER TYPE "public"."user_role" ADD VALUE 'coordinator';--> statement-breakpoint
CREATE TABLE "coordinator_event_assignments" (
	"coordinator_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coordinator_event_assignments_coordinator_id_event_id_pk" PRIMARY KEY("coordinator_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "coordinator_event_assignments" ADD CONSTRAINT "coordinator_event_assignments_coordinator_id_users_id_fk" FOREIGN KEY ("coordinator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_event_assignments" ADD CONSTRAINT "coordinator_event_assignments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;