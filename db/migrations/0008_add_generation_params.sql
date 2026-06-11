ALTER TABLE "ai_config" ADD COLUMN "max_tokens" integer DEFAULT 16000 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN "effort" text DEFAULT 'high' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN "temperature" numeric(3, 2) DEFAULT '0.30' NOT NULL;