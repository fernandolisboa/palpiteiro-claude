-- Placar da disputa de pênaltis ao vivo (#600). IF NOT EXISTS: o DB de preview da Vercel é compartilhado entre branches.
ALTER TABLE "match_live_states" ADD COLUMN IF NOT EXISTS "home_pens" smallint;--> statement-breakpoint
ALTER TABLE "match_live_states" ADD COLUMN IF NOT EXISTS "away_pens" smallint;
