CREATE TYPE "public"."ai_call_status" AS ENUM('ok', 'invalid_output', 'provider_error', 'timeout', 'tool_missing', 'rate_limited');--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "status" "ai_call_status" DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD COLUMN "error_message" text;