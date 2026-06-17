-- Seed dos mercados independent_binary artilheiro (anytime_scorer) + assistência
-- (assist) — #290 PR2, ADR 0025 emenda. DML idempotente (modelo 0030).
-- DIFERENTE de correct_score: SÓ as rows `markets`, ZERO market_selections — as
-- seleções por JOGADOR são materializadas LAZY no 1º predict (ensureScorerSelections,
-- key scorer_<slug>/assist_<slug> + nome no label). O conjunto de jogadores é
-- ilimitado/desconhecido até o fetch de odds (bet_92/212), então não há lista fixa a
-- seedar. is_active=true + is_graduated=false = flag admin-only (graduação por D9 viva,
-- sem backtest). settlement_rule_key resolve em lib/settlement/registry.ts
-- (anytime_scorer/assist). SEM ALTER TYPE (keys são `text` livre desde #179). ON
-- CONFLICT DO NOTHING = re-aplicação no-op. Labels 'Artilheiro'/'Assistência' IGUAIS a
-- lib/view/markets/presentation.ts.
INSERT INTO "markets" ("key", "label", "settlement_rule_key", "is_active", "is_graduated")
VALUES
  ('anytime_scorer', 'Artilheiro', 'anytime_scorer', true, false),
  ('assist', 'Assistência', 'assist', true, false)
ON CONFLICT ("key") DO NOTHING;
