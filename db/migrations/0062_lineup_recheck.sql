-- Reconferência com a escalação (#619, PR B; ADR 0041 adendo). IF NOT EXISTS: o DB de preview da Vercel é compartilhado entre branches.
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "enable_lineup_recheck" boolean DEFAULT true NOT NULL;
