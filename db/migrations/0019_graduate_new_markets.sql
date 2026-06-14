-- Graduação de audiência (#261): torna match_result (1X2), btts (ambas marcam) e
-- double_chance (dupla chance) visíveis pra TODOS os usuários — não só admin.
-- Decisão do dono (2026-06-14): sobrepõe o soak admin-only + backtest>=20 (D9).
--
-- Graduação é flip DATA-DRIVEN de is_graduated (market-catalog.ts:62), SEM mudança
-- de código: usuário comum passa a ver mercados is_active AND is_graduated.
-- over_under já era graduado (0009). O gate de LIGA (coveredLeagues) fica INTACTO:
-- btts/double_chance seguem world_cup-only até a cobertura de odds ser validada em
-- outras ligas (marketsForLeague). match_result não tem gate de liga → all-leagues.
--
-- Idempotente (modelo 0014/0016/0018): só promove quem ainda não é graduado.
UPDATE "markets"
SET "is_graduated" = true
WHERE "key" IN ('match_result', 'btts', 'double_chance')
  AND "is_graduated" = false;
