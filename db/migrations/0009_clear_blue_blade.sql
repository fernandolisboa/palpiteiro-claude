CREATE TABLE "market_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "market_selections_market_id_key_unique" UNIQUE("market_id","key")
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"settlement_rule_key" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"is_graduated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "market_selections" ADD CONSTRAINT "market_selections_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Seed do catálogo (ADR 0015 D3). DML idempotente appendada à migration (não ao
-- db/seed.ts, que é dev-only): a row over_under + seleções precisam existir em TODO
-- ambiente (preview + prod) porque predictions/snapshots vão FK a markets (#160/#161).
-- ON CONFLICT DO NOTHING torna a re-aplicação um no-op. Não altera o snapshot (schema-only).
INSERT INTO "markets" ("key", "label", "settlement_rule_key", "is_active", "is_graduated")
VALUES ('over_under', 'Over/Under gols', 'over_under', true, true)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "market_selections" ("market_id", "key", "label", "sort_order")
SELECT m."id", v."key", v."label", v."sort_order"
FROM "markets" m
CROSS JOIN (VALUES ('over', 'Over', 0), ('under', 'Under', 1)) AS v ("key", "label", "sort_order")
WHERE m."key" = 'over_under'
ON CONFLICT ("market_id", "key") DO NOTHING;