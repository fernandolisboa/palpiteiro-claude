ALTER TABLE "predictions" ALTER COLUMN "market" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "predictions" ALTER COLUMN "market" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prediction_selection_odds" ADD COLUMN "model_prob_pct" numeric(5, 2);--> statement-breakpoint
-- Seed do mercado 1X2 (match_result) — DML idempotente appendada (modelo 0009). A
-- row + as 3 seleções precisam existir em TODO ambiente (preview + prod) pra o
-- mercado ser selecionável. is_active=true + is_graduated=false = flag admin-only
-- (#173): ativo, mas só admin vê até graduar. ON CONFLICT DO NOTHING = re-aplicação
-- no-op. Labels IGUAIS a lib/view/markets/presentation.ts (seed-parity). Não altera
-- o snapshot (schema-only).
INSERT INTO "markets" ("key", "label", "settlement_rule_key", "is_active", "is_graduated")
VALUES ('match_result', 'Resultado (1X2)', 'match_result', true, false)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "market_selections" ("market_id", "key", "label", "sort_order")
SELECT m."id", v."key", v."label", v."sort_order"
FROM "markets" m
CROSS JOIN (VALUES ('home', 'Casa', 0), ('draw', 'Empate', 1), ('away', 'Fora', 2)) AS v ("key", "label", "sort_order")
WHERE m."key" = 'match_result'
ON CONFLICT ("market_id", "key") DO NOTHING;