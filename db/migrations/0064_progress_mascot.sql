-- Personagem do progresso da análise (#640, ADR 0068). IF NOT EXISTS: o DB de preview da Vercel é compartilhado entre branches.
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "progress_mascot" text DEFAULT 'robo' NOT NULL;
