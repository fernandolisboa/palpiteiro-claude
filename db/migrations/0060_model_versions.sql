-- Versões novas automáticas de Haiku, Sonnet e Opus (ADR 0062, PLAN-608). IF NOT EXISTS / DO block /
-- DROP CONSTRAINT IF EXISTS antes de re-ADD: o DB de preview da Vercel é compartilhado entre branches,
-- então tudo aqui pode rodar de novo. ai_calls.match_id só afrouxa (DROP NOT NULL), e os CHECKs
-- mantêm o nome: ai_calls_user_id_system_only passa a aceitar também a sondagem (model_probe_*).
CREATE TABLE IF NOT EXISTS "model_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"family" text NOT NULL,
	"display_name" text NOT NULL,
	"api_created_at" timestamp with time zone,
	"capabilities" jsonb,
	"max_tokens" integer,
	"status" text NOT NULL,
	"pricing" jsonb NOT NULL,
	"price_confirmed_at" timestamp with time zone,
	"adopted_at" timestamp with time zone,
	"failure_reason" text,
	"probe_ai_call_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_versions_family_check" CHECK ("model_versions"."family" IN ('opus', 'sonnet', 'haiku')),
	CONSTRAINT "model_versions_status_check" CHECK ("model_versions"."status" IN ('active', 'superseded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "ai_calls" DROP CONSTRAINT IF EXISTS "ai_calls_user_id_system_only";--> statement-breakpoint
ALTER TABLE "ai_calls" DROP CONSTRAINT IF EXISTS "ai_calls_match_id_system_only";--> statement-breakpoint
ALTER TABLE "ai_calls" ALTER COLUMN "match_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "enable_auto_model_versions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "model_versions_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "model_versions_check_summary" jsonb;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_probe_ai_call_id_ai_calls_id_fk" FOREIGN KEY ("probe_ai_call_id") REFERENCES "public"."ai_calls"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_versions_one_active_per_family" ON "model_versions" USING btree ("family") WHERE status = 'active';--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_match_id_system_only" CHECK ("ai_calls"."match_id" IS NOT NULL OR "ai_calls"."prompt_version" LIKE 'model_probe_%');--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_user_id_system_only" CHECK ("ai_calls"."user_id" IS NOT NULL OR "ai_calls"."provider" = 'typesafe' OR "ai_calls"."prompt_version" LIKE 'model_probe_%');
