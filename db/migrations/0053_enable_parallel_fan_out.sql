ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "enable_parallel_fan_out" boolean DEFAULT true NOT NULL;
