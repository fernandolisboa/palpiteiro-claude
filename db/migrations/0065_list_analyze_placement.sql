-- Onde fica o "analisar" na linha de /jogos no desktop (Fernando, 2026-11-05). IF NOT EXISTS: o DB de preview da Vercel é compartilhado entre branches.
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "list_analyze_placement" text DEFAULT 'lateral' NOT NULL;
