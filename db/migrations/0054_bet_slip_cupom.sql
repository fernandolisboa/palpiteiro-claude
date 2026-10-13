ALTER TABLE "bet_legs" ADD COLUMN IF NOT EXISTS "model_source" text;--> statement-breakpoint
ALTER TABLE "bet_legs" ADD COLUMN IF NOT EXISTS "reference_odd" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "bet_legs" ADD COLUMN IF NOT EXISTS "market_implied_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "bet_legs" ADD COLUMN IF NOT EXISTS "stake_units" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "bet_legs" ADD COLUMN IF NOT EXISTS "suggested_stake_units" numeric(4, 2);--> statement-breakpoint
ALTER TABLE "bet_slips" ADD COLUMN IF NOT EXISTS "mode" text;--> statement-breakpoint
ALTER TABLE "bet_slips" ADD COLUMN IF NOT EXISTS "stake_units" numeric(5, 2);