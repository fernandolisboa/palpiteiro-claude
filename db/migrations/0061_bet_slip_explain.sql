-- "Explicar com IA" nas apostas registradas (#562, ADR 0063). IF NOT EXISTS / DO block: o DB de preview da Vercel é compartilhado entre branches.
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "enable_bet_slip_explain" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bet_slips" ADD COLUMN IF NOT EXISTS "model_snapshot_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bet_slips" ADD CONSTRAINT "bet_slips_model_snapshot_id_match_model_snapshots_id_fk" FOREIGN KEY ("model_snapshot_id") REFERENCES "public"."match_model_snapshots"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
