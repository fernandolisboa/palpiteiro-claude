CREATE TABLE "selection_odds_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"selection_id" uuid NOT NULL,
	"bookmaker" text NOT NULL,
	"market_params" jsonb,
	"odd" numeric(6, 3) NOT NULL,
	"overround_pct" numeric(5, 2) NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "selection_odds_snapshots_dedup_key" UNIQUE("match_id","market_id","selection_id","captured_at","bookmaker")
);
--> statement-breakpoint
ALTER TABLE "prediction_outcomes" ADD COLUMN "result_data" jsonb;--> statement-breakpoint
ALTER TABLE "selection_odds_snapshots" ADD CONSTRAINT "selection_odds_snapshots_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selection_odds_snapshots" ADD CONSTRAINT "selection_odds_snapshots_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selection_odds_snapshots" ADD CONSTRAINT "selection_odds_snapshots_selection_id_market_selections_id_fk" FOREIGN KEY ("selection_id") REFERENCES "public"."market_selections"("id") ON DELETE restrict ON UPDATE no action;