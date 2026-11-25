-- Notícias do jogo como fator conferido (#672, PLAN-672 §2). IF NOT EXISTS / DO block /
-- DROP CONSTRAINT IF EXISTS antes de re-ADD: o DB de preview da Vercel é compartilhado entre
-- branches, então tudo aqui pode rodar de novo. ai_calls_user_id_system_only mantém o nome e
-- passa a aceitar também a extração das notícias no cron da base (match_news_*), uma Haiku
-- sem usuário. O CHECK entra NOT VALID e depois VALIDATE (o VALIDATE varre ai_calls sem
-- bloquear escrita). No LIKE, o `_` é escapado (escape padrão `\`).
CREATE TABLE IF NOT EXISTS "match_news" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"snippet" text,
	"published_at" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'ge' NOT NULL,
	"feed_side" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_news_source_check" CHECK ("match_news"."source" IN ('ge')),
	CONSTRAINT "match_news_feed_side_check" CHECK ("match_news"."feed_side" IS NULL OR "match_news"."feed_side" IN ('home', 'away'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "match_news_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"batch_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"items" jsonb NOT NULL,
	"status" text NOT NULL,
	"claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"partial" boolean DEFAULT false NOT NULL,
	"unknown_opponent" boolean DEFAULT false NOT NULL,
	"ai_call_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"usable_at" timestamp with time zone,
	CONSTRAINT "match_news_batches_status_check" CHECK ("match_news_batches"."status" IN ('ok', 'empty', 'failed'))
);
--> statement-breakpoint
-- usable_at entrou depois da 1ª versão desta migration (DB de preview que já a rodou).
ALTER TABLE "match_news_batches" ADD COLUMN IF NOT EXISTS "usable_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_calls" DROP CONSTRAINT IF EXISTS "ai_calls_user_id_system_only";--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "enable_news_factors" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "match_news" ADD CONSTRAINT "match_news_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "match_news_batches" ADD CONSTRAINT "match_news_batches_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "match_news_batches" ADD CONSTRAINT "match_news_batches_ai_call_id_ai_calls_id_fk" FOREIGN KEY ("ai_call_id") REFERENCES "public"."ai_calls"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "match_news_match_url_uniq" ON "match_news" USING btree ("match_id","url");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "match_news_match_published_idx" ON "match_news" USING btree ("match_id","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "match_news_batches_match_hash_version_uniq" ON "match_news_batches" USING btree ("match_id","batch_hash","prompt_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "match_news_batches_match_checked_idx" ON "match_news_batches" USING btree ("match_id","checked_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_user_id_system_only" CHECK ("ai_calls"."user_id" IS NOT NULL OR "ai_calls"."provider" = 'typesafe' OR "ai_calls"."prompt_version" LIKE 'model\_probe\_%' OR "ai_calls"."prompt_version" LIKE 'match\_news\_%') NOT VALID;--> statement-breakpoint
ALTER TABLE "ai_calls" VALIDATE CONSTRAINT "ai_calls_user_id_system_only";
