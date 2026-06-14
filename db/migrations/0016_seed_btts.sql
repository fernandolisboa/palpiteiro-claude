-- Seed do mercado BTTS (ambas marcam) — DML idempotente (modelo 0009/0014). A row
-- + as 2 seleções (yes/no) precisam existir em TODO ambiente (preview + prod) pra o
-- mercado ser selecionável. is_active=true + is_graduated=false = flag admin-only
-- (#174): ativo, mas só admin vê até graduar. settlement_rule_key 'btts' resolve em
-- lib/settlement/registry.ts. SEM linha (btts é binário, market_params null). ON
-- CONFLICT DO NOTHING = re-aplicação no-op. Labels IGUAIS a
-- lib/view/markets/presentation.ts (seed-parity, pinado por
-- presentation-seed-parity.pglite.test.ts). Migração custom (sem delta de schema).
INSERT INTO "markets" ("key", "label", "settlement_rule_key", "is_active", "is_graduated")
VALUES ('btts', 'Ambas marcam', 'btts', true, false)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "market_selections" ("market_id", "key", "label", "sort_order")
SELECT m."id", v."key", v."label", v."sort_order"
FROM "markets" m
CROSS JOIN (VALUES ('yes', 'Sim', 0), ('no', 'Não', 1)) AS v ("key", "label", "sort_order")
WHERE m."key" = 'btts'
ON CONFLICT ("market_id", "key") DO NOTHING;
