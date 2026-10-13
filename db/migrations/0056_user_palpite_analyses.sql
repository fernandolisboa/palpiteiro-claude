-- Seu palpite (#564, ADR 0054). IF NOT EXISTS / DO block: o DB de preview da Vercel é compartilhado entre branches.
CREATE TABLE IF NOT EXISTS "user_palpite_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"palpite" jsonb NOT NULL,
	"palpite_source" text NOT NULL,
	"reason_text" text NOT NULL,
	"claims" jsonb NOT NULL,
	"model" jsonb NOT NULL,
	"reading" jsonb NOT NULL,
	"narration" jsonb NOT NULL,
	"narration_source" text NOT NULL,
	"extraction_ai_call_id" uuid,
	"narration_ai_call_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "enable_user_context" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_palpite_analyses" ADD CONSTRAINT "user_palpite_analyses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_palpite_analyses" ADD CONSTRAINT "user_palpite_analyses_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_palpite_analyses" ADD CONSTRAINT "user_palpite_analyses_extraction_ai_call_id_ai_calls_id_fk" FOREIGN KEY ("extraction_ai_call_id") REFERENCES "public"."ai_calls"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_palpite_analyses" ADD CONSTRAINT "user_palpite_analyses_narration_ai_call_id_ai_calls_id_fk" FOREIGN KEY ("narration_ai_call_id") REFERENCES "public"."ai_calls"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_palpite_analyses_user_match_created_idx" ON "user_palpite_analyses" USING btree ("user_id","match_id","created_at");
