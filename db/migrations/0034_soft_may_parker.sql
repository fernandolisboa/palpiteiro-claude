CREATE TYPE "public"."palpite_type" AS ENUM('exact_score', 'red_card', 'corners');--> statement-breakpoint
CREATE TABLE "palpite_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"palpite_id" uuid NOT NULL,
	"result_data" jsonb,
	"result" "outcome_result" NOT NULL,
	"override_by_user_id" uuid,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "palpite_outcomes_palpiteId_unique" UNIQUE("palpite_id")
);
--> statement-breakpoint
CREATE TABLE "palpite_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"ai_call_id" uuid,
	"model_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "palpites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"palpite_set_id" uuid NOT NULL,
	"type" "palpite_type" NOT NULL,
	"text" text NOT NULL,
	"params" jsonb,
	"settleable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "palpite_outcomes" ADD CONSTRAINT "palpite_outcomes_palpite_id_palpites_id_fk" FOREIGN KEY ("palpite_id") REFERENCES "public"."palpites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "palpite_outcomes" ADD CONSTRAINT "palpite_outcomes_override_by_user_id_users_id_fk" FOREIGN KEY ("override_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "palpite_sets" ADD CONSTRAINT "palpite_sets_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "palpite_sets" ADD CONSTRAINT "palpite_sets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "palpite_sets" ADD CONSTRAINT "palpite_sets_ai_call_id_ai_calls_id_fk" FOREIGN KEY ("ai_call_id") REFERENCES "public"."ai_calls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "palpites" ADD CONSTRAINT "palpites_palpite_set_id_palpite_sets_id_fk" FOREIGN KEY ("palpite_set_id") REFERENCES "public"."palpite_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "palpite_sets_match_id_idx" ON "palpite_sets" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "palpite_sets_user_id_idx" ON "palpite_sets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "palpite_sets_created_at_idx" ON "palpite_sets" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "palpites_palpite_set_id_idx" ON "palpites" USING btree ("palpite_set_id");--> statement-breakpoint
CREATE INDEX "palpites_type_idx" ON "palpites" USING btree ("type");