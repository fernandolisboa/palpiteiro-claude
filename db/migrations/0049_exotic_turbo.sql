ALTER TABLE "ai_config" ADD COLUMN "analysis_engine" text DEFAULT 'llm' NOT NULL;--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "judgments" jsonb;