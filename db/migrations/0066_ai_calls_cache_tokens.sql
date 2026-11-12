-- Prompt caching (ADR 0071, #664): tokens escritos no cache e lidos do cache por chamada. IF NOT EXISTS: o DB de preview da Vercel é compartilhado entre branches.
ALTER TABLE "ai_calls" ADD COLUMN IF NOT EXISTS "cache_creation_input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN IF NOT EXISTS "cache_read_input_tokens" integer DEFAULT 0 NOT NULL;
