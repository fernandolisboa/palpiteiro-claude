-- Escudo do time (#578), preenchido pelo sync de fixtures. IF NOT EXISTS: o DB de preview da Vercel é compartilhado entre branches.
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "home_team_crest_url" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "away_team_crest_url" text;
