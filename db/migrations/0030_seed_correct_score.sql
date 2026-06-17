-- Seed do mercado placar exato (correct_score) — DML idempotente (modelo
-- 0009/0014/0016/0018). A row + as 16 seleções (cs_0_0..cs_3_3, grid 0..3 × 0..3)
-- precisam existir em TODO ambiente (preview + prod) pra o mercado ser selecionável.
-- is_active=true + is_graduated=false = flag admin-only (#290, ADR 0025): ativo, mas
-- só admin vê até graduar por D9 viva (sem backtest). settlement_rule_key
-- 'correct_score' resolve em lib/settlement/registry.ts. SEM linha (market_params
-- null). SEM ALTER TYPE (as keys são `text` livre desde o contrato #179). ON CONFLICT
-- DO NOTHING = re-aplicação no-op. As 16 keys casam byte-a-byte CORRECT_SCORE.selectionKeys
-- (sort 0..15 row-major: home externo, away interno); labels '0-0'..'3-3' IGUAIS a
-- lib/view/markets/presentation.ts (seed-parity, pinado por
-- presentation-seed-parity.pglite.test.ts). Migração custom (sem delta de schema).
INSERT INTO "markets" ("key", "label", "settlement_rule_key", "is_active", "is_graduated")
VALUES ('correct_score', 'Placar exato', 'correct_score', true, false)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "market_selections" ("market_id", "key", "label", "sort_order")
SELECT m."id", v."key", v."label", v."sort_order"
FROM "markets" m
CROSS JOIN (VALUES
  ('cs_0_0', '0-0', 0),
  ('cs_0_1', '0-1', 1),
  ('cs_0_2', '0-2', 2),
  ('cs_0_3', '0-3', 3),
  ('cs_1_0', '1-0', 4),
  ('cs_1_1', '1-1', 5),
  ('cs_1_2', '1-2', 6),
  ('cs_1_3', '1-3', 7),
  ('cs_2_0', '2-0', 8),
  ('cs_2_1', '2-1', 9),
  ('cs_2_2', '2-2', 10),
  ('cs_2_3', '2-3', 11),
  ('cs_3_0', '3-0', 12),
  ('cs_3_1', '3-1', 13),
  ('cs_3_2', '3-2', 14),
  ('cs_3_3', '3-3', 15)
) AS v ("key", "label", "sort_order")
WHERE m."key" = 'correct_score'
ON CONFLICT ("market_id", "key") DO NOTHING;
