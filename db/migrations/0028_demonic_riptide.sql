ALTER TABLE "match_odds_snapshots" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "match_odds_snapshots" CASCADE;--> statement-breakpoint
ALTER TABLE "predictions" ALTER COLUMN "market" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "predictions" ALTER COLUMN "recommendation" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "prediction_outcomes" DROP COLUMN "total_goals";--> statement-breakpoint
ALTER TABLE "predictions" DROP COLUMN "over_odd_at_prediction";--> statement-breakpoint
ALTER TABLE "predictions" DROP COLUMN "under_odd_at_prediction";--> statement-breakpoint
DROP TYPE "public"."market";--> statement-breakpoint
DROP TYPE "public"."recommendation";