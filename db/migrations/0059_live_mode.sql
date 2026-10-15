-- Modo ao vivo (#580, ADR 0060). IF NOT EXISTS / DO block: o DB de preview da Vercel é compartilhado entre branches.
-- Tudo aditivo; o DROP NOT NULL de prediction_selection_odds.odd só afrouxa e pode rodar de novo.
CREATE TABLE IF NOT EXISTS "match_live_states" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'api_football' NOT NULL,
	"provider_fixture_id" integer,
	"status_short" text,
	"elapsed" smallint,
	"extra" smallint,
	"home_goals" smallint,
	"away_goals" smallint,
	"home_red" smallint,
	"away_red" smallint,
	"fetched_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "prediction_selection_odds" ALTER COLUMN "odd" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "enable_live_mode" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bet_slips" ADD COLUMN IF NOT EXISTS "is_live" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bet_slips" ADD COLUMN IF NOT EXISTS "live_state" jsonb;--> statement-breakpoint
ALTER TABLE "friend_pool_entries" ADD COLUMN IF NOT EXISTS "is_live" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "friend_pool_entries" ADD COLUMN IF NOT EXISTS "live_state" jsonb;--> statement-breakpoint
ALTER TABLE "friend_pools" ADD COLUMN IF NOT EXISTS "bets_closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "friend_pools" ADD COLUMN IF NOT EXISTS "bets_extended_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "friend_pools" ADD COLUMN IF NOT EXISTS "bets_extended_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "palpite_sets" ADD COLUMN IF NOT EXISTS "is_live" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "palpite_sets" ADD COLUMN IF NOT EXISTS "live_state" jsonb;--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN IF NOT EXISTS "is_live" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN IF NOT EXISTS "live_state" jsonb;--> statement-breakpoint
ALTER TABLE "user_palpite_analyses" ADD COLUMN IF NOT EXISTS "is_live" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_palpite_analyses" ADD COLUMN IF NOT EXISTS "live_state" jsonb;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "match_live_states" ADD CONSTRAINT "match_live_states_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "friend_pools" ADD CONSTRAINT "friend_pools_bets_extended_by_user_id_users_id_fk" FOREIGN KEY ("bets_extended_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bet_slips" ADD CONSTRAINT "bet_slips_live_state_check" CHECK ("bet_slips"."is_live" = false OR "bet_slips"."live_state" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "friend_pool_entries" ADD CONSTRAINT "friend_pool_entries_live_state_check" CHECK ("friend_pool_entries"."is_live" = false OR "friend_pool_entries"."live_state" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "palpite_sets" ADD CONSTRAINT "palpite_sets_live_state_check" CHECK ("palpite_sets"."is_live" = false OR "palpite_sets"."live_state" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "predictions" ADD CONSTRAINT "predictions_live_state_check" CHECK ("predictions"."is_live" = false OR "predictions"."live_state" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_palpite_analyses" ADD CONSTRAINT "user_palpite_analyses_live_state_check" CHECK ("user_palpite_analyses"."is_live" = false OR "user_palpite_analyses"."live_state" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;