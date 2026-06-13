CREATE TABLE "prediction_selection_odds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prediction_id" uuid NOT NULL,
	"selection_id" uuid NOT NULL,
	"odd" numeric(6, 3) NOT NULL,
	CONSTRAINT "prediction_selection_odds_prediction_id_selection_id_unique" UNIQUE("prediction_id","selection_id")
);
--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "market_id" uuid;--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "selection_id" uuid;--> statement-breakpoint
ALTER TABLE "predictions" ADD COLUMN "market_params" jsonb;--> statement-breakpoint
ALTER TABLE "prediction_selection_odds" ADD CONSTRAINT "prediction_selection_odds_prediction_id_predictions_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."predictions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_selection_odds" ADD CONSTRAINT "prediction_selection_odds_selection_id_market_selections_id_fk" FOREIGN KEY ("selection_id") REFERENCES "public"."market_selections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prediction_selection_odds_prediction_id_idx" ON "prediction_selection_odds" USING btree ("prediction_id");--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_selection_id_market_selections_id_fk" FOREIGN KEY ("selection_id") REFERENCES "public"."market_selections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "predictions_market_id_idx" ON "predictions" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "predictions_selection_id_idx" ON "predictions" USING btree ("selection_id");