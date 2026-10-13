-- Base do modelo por jogo (#555, ADR 0052). IF NOT EXISTS / DO block: o DB de preview da Vercel é compartilhado entre branches.
CREATE TABLE IF NOT EXISTS "match_model_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model_version" text NOT NULL,
	"fingerprint" text NOT NULL,
	"lambda_source" text NOT NULL,
	"lambda_degraded" boolean NOT NULL,
	"lambda_fallback_reason" text,
	"rho" double precision,
	"neutral" boolean NOT NULL,
	"lambda_home_base" double precision NOT NULL,
	"lambda_away_base" double precision NOT NULL,
	"lambda_home" double precision NOT NULL,
	"lambda_away" double precision NOT NULL,
	"jev_status" text NOT NULL,
	"judgments" jsonb,
	"probabilities" jsonb NOT NULL,
	"top_scorelines" jsonb NOT NULL
);
--> statement-breakpoint
-- Chamadas de sistema (JEV do cron da base) não têm usuário. DROP NOT NULL é idempotente.
ALTER TABLE "ai_calls" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "enable_match_model_jev" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "match_model_snapshots" ADD CONSTRAINT "match_model_snapshots_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "match_model_snapshots_match_computed_idx" ON "match_model_snapshots" USING btree ("match_id","computed_at" DESC NULLS LAST);--> statement-breakpoint
-- Só o JEV de sistema (provider = JUDGMENT_PROVIDER_KEY, lib/ai/models.ts) pode ficar sem
-- usuário: um insert Claude/narração sem user_id é bug e deve falhar no banco. Rows
-- existentes têm user_id.
DO $$ BEGIN
  ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_user_id_system_only" CHECK ("ai_calls"."user_id" IS NOT NULL OR "ai_calls"."provider" = 'typesafe');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
