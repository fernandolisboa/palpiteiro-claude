CREATE TYPE "public"."bet_leg_kind" AS ENUM('over_under', 'match_result', 'btts', 'double_chance', 'exact_score', 'margin', 'clean_sheet', 'first_half_score', 'first_half_over_under', 'first_to_score', 'cards', 'corners');--> statement-breakpoint
CREATE TYPE "public"."grade_source" AS ENUM('cartridge', 'scoreline_model', 'none');--> statement-breakpoint
CREATE TYPE "public"."grade_status" AS ENUM('graded', 'not_covered', 'no_data', 'rate_limited', 'degraded_no_snapshot');--> statement-breakpoint
CREATE TABLE "bet_leg_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"leg_id" uuid NOT NULL,
	"result" "outcome_result" NOT NULL,
	"result_data" jsonb,
	"override_by_user_id" uuid,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bet_leg_outcomes_legId_unique" UNIQUE("leg_id")
);
--> statement-breakpoint
CREATE TABLE "bet_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slip_id" uuid NOT NULL,
	"kind" "bet_leg_kind" NOT NULL,
	"params" jsonb NOT NULL,
	"user_odd" numeric(6, 3),
	"model_prob_pct" numeric(5, 2),
	"grade_source" "grade_source" NOT NULL,
	"grade_status" "grade_status" NOT NULL,
	"pinned_prediction_id" uuid,
	"settleable" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bet_slips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"raw_input" text,
	"parse_ai_call_id" uuid,
	"combo_user_odd" numeric(6, 3),
	"joint_prob_pct" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bet_leg_outcomes" ADD CONSTRAINT "bet_leg_outcomes_leg_id_bet_legs_id_fk" FOREIGN KEY ("leg_id") REFERENCES "public"."bet_legs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bet_leg_outcomes" ADD CONSTRAINT "bet_leg_outcomes_override_by_user_id_users_id_fk" FOREIGN KEY ("override_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bet_legs" ADD CONSTRAINT "bet_legs_slip_id_bet_slips_id_fk" FOREIGN KEY ("slip_id") REFERENCES "public"."bet_slips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bet_legs" ADD CONSTRAINT "bet_legs_pinned_prediction_id_predictions_id_fk" FOREIGN KEY ("pinned_prediction_id") REFERENCES "public"."predictions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bet_slips" ADD CONSTRAINT "bet_slips_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bet_slips" ADD CONSTRAINT "bet_slips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bet_slips" ADD CONSTRAINT "bet_slips_parse_ai_call_id_ai_calls_id_fk" FOREIGN KEY ("parse_ai_call_id") REFERENCES "public"."ai_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bet_legs_slip_id_idx" ON "bet_legs" USING btree ("slip_id");--> statement-breakpoint
CREATE INDEX "bet_slips_user_id_created_at_idx" ON "bet_slips" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "bet_slips_match_id_idx" ON "bet_slips" USING btree ("match_id");