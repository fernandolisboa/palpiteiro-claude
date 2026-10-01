-- Final em jogo único com sede neutra (#529), preenchido pelo sync de fixtures. IF NOT EXISTS: o DB de preview da Vercel é compartilhado entre branches.
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "neutral_venue" boolean DEFAULT false NOT NULL;
