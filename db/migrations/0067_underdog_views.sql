-- Chances do azarão (#671, ADR 0073). IF NOT EXISTS / DO block: o DB de preview da Vercel é compartilhado entre branches.
CREATE TABLE IF NOT EXISTS "underdog_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"model_snapshot_id" uuid NOT NULL,
	"underdog_side" text NOT NULL,
	"facts" jsonb NOT NULL,
	"narrative" jsonb NOT NULL,
	"narrative_source" text NOT NULL,
	"versions" jsonb NOT NULL,
	"advocate_ai_call_id" uuid,
	"reviewer_ai_call_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "enable_underdog_view" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "underdog_views" ADD CONSTRAINT "underdog_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "underdog_views" ADD CONSTRAINT "underdog_views_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "underdog_views" ADD CONSTRAINT "underdog_views_model_snapshot_id_match_model_snapshots_id_fk" FOREIGN KEY ("model_snapshot_id") REFERENCES "public"."match_model_snapshots"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "underdog_views" ADD CONSTRAINT "underdog_views_advocate_ai_call_id_ai_calls_id_fk" FOREIGN KEY ("advocate_ai_call_id") REFERENCES "public"."ai_calls"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "underdog_views" ADD CONSTRAINT "underdog_views_reviewer_ai_call_id_ai_calls_id_fk" FOREIGN KEY ("reviewer_ai_call_id") REFERENCES "public"."ai_calls"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "underdog_views_user_snapshot_uniq" ON "underdog_views" USING btree ("user_id","model_snapshot_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "underdog_views_user_match_created_idx" ON "underdog_views" USING btree ("user_id","match_id","created_at" DESC NULLS LAST);
