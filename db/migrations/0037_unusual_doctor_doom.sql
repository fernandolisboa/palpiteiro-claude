ALTER TYPE "public"."ai_call_status" ADD VALUE 'fidelity_divergence';--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN "enable_fidelity_validation" boolean DEFAULT true NOT NULL;