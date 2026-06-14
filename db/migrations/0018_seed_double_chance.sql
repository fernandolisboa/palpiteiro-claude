-- Seed do mercado dupla chance (1X/X2/12) — DML idempotente (modelo 0009/0014/0016).
-- A row + as 3 seleções (home_or_draw/away_or_draw/home_or_away) precisam existir em
-- TODO ambiente (preview + prod) pra o mercado ser selecionável. is_active=true +
-- is_graduated=false = flag admin-only (#176): ativo, mas só admin vê até graduar.
-- settlement_rule_key 'double_chance' resolve em lib/settlement/registry.ts. SEM
-- linha (market_params null). ON CONFLICT DO NOTHING = re-aplicação no-op. Labels
-- IGUAIS a lib/view/markets/presentation.ts (seed-parity, pinado por
-- presentation-seed-parity.pglite.test.ts). Migração custom (sem delta de schema).
INSERT INTO "markets" ("key", "label", "settlement_rule_key", "is_active", "is_graduated")
VALUES ('double_chance', 'Dupla chance', 'double_chance', true, false)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "market_selections" ("market_id", "key", "label", "sort_order")
SELECT m."id", v."key", v."label", v."sort_order"
FROM "markets" m
CROSS JOIN (VALUES ('home_or_draw', 'Casa ou empate', 0), ('away_or_draw', 'Empate ou fora', 1), ('home_or_away', 'Casa ou fora', 2)) AS v ("key", "label", "sort_order")
WHERE m."key" = 'double_chance'
ON CONFLICT ("market_id", "key") DO NOTHING;
