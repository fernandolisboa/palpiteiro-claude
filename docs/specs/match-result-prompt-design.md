# 1X2 (Resultado final) — Prompt Design Spec (cartucho `match_result`)

**Status:** PLANEJADO (implementação em [#173](https://github.com/fernandolisboa/palpiteiro-claude/issues/173),
atrás de feature-flag) · **Versão:** `match_result_v1` (a confirmar ao aterrissar) · **Mercado:** N=3, **sem linha**.

Design spec — o contrato que #173 implementa. Instancia a [spec-mãe](./cartridge-prompt-contract.md);
aqui ficam só os pontos específicos do 1X2. É o **pathfinder** do pivot: 1º mercado de 3 seleções, a prova
real de que o caminho é genérico (implícita de 3 vias, cenários em grid, settlement por placar, odds N-vias
ao vivo). Reconciliar versão + paths quando o cartucho aterrissar. Ref.: ADR
[0003](../decisions/0003-over-under-only-market.md) ("1X2 é mais difícil de prever, exige cuidado de
calibração"), [0018](../decisions/0018-edge-ev-cenarios-multi-mercado.md) (edge N-vias).

## Seleções e descriptor

- **Seleções:** `home` / `draw` / `away` (`selectionKeys = ["home","draw","away"]`).
- **Provider:** `providerMarketKey = "h2h"` (The Odds API, mercado *featured* — cobertura garantida na
  região `eu`, casas BR inclusas). `resolveSelectionKey`: `"draw"` → `draw`; senão casa o nome do outcome
  contra `homeTeam`/`awayTeam` via `teamsMatch` (normaliza grafia divergente do provider) → `home`/`away`.
- **Sem linha:** `params = undefined` → `market_params = null`.
- O **descriptor `MATCH_RESULT` já existe** (`lib/odds/market-descriptor.ts`, `is_active=false`, criado pra
  exercitar o caminho N≥3); #173 "promove a produção" = seed `markets`/`market_selections` + cartucho +
  registro no registry + regra de settlement, **sem** mexer no descriptor.

## Saída do LLM — **decisão de design aberta (resolver no plan-gate do #173)**

ADR 0018-D2 ("recomendação sai quando **alguma** seleção tem `edge_i ≥ 5pp`") exige `modelProb_i` por
seleção pra computar `edge_i`. Em N=2 (over/under) um único `confidence_pct = P(over)` basta porque
`P(under) = 100 − P(over)`; em N=3 **isso cai**. Duas opções para o output schema:

- **(A) Single-rec + `confidence_pct`** (paridade com over/under): LLM emite `recommendation`
  (`home`/`draw`/`away`/`pass`) + `confidence_pct` do lado recomendado. `predict.ts` (~:419) já roteia a
  implícita pelo núcleo N-vias `computeMarketImpliedProbabilities` (`lib/odds/implied-probability.ts`),
  **mas o call site está hardcoded no bundle over/under** (`overOdd`/`underOdd`, N=2) — #173 alimenta as 3
  odds h2h por ele e computa o `edge` só do recomendado. Simples, mas o LLM faz o trabalho de "alguma
  seleção tem edge" implicitamente ao escolher o lado.
- **(B) Probabilidades por seleção:** LLM emite `prob_home`/`prob_draw`/`prob_away` (somando ~100, com
  tolerância) + `recommendation`. `predict.ts` computa `edge_i` de cada uma e checa o floor — alinhamento
  literal com ADR 0018-D2, ao custo de pedir uma distribuição calibrada (mais difícil pro LLM; mais
  superfície de erro/validação Zod).

Recomendação default a levar ao gate: **(A)** pela paridade com o fluxo existente e menor superfície de
calibração — o "edge por seleção" do ADR 0018 já é honrado na camada de **cenários/implícita** (que é N-vias),
sem exigir N probabilidades do LLM. Decidir explicitamente no plan-gate; seja qual for, `confidence_pct`
em `pass` precisa de uma convenção definida (não há "lado over" canônico em 1X2).

Tolerância de prosa: mesmo padrão da spec-mãe §6 (shape rígido, `rationale`/`key_factors` truncados, nunca
descartar recomendação válida).

## Edge / cenários (N=3, ADR 0018)

`implied_i = (1/o_i) / Σ_j(1/o_j)` sobre as **3** odds; `edge_i = modelProb_i − implied_i`. **Nada de
`100 − x`** nem `edge_oposto = −edge` (só N=2). Os cenários mostram as 3 seleções, recomendada destacada,
cada uma com `modelProb_i`/`implied_i`/`edge_i`/`o_i`/`EV_i` (`computeMarketScenarios`/`toOutcomesView` —
caminho N-vias que existe mas ainda não tem consumidor ao vivo; #173 é o 1º a exercê-lo).

## Settlement (`settlement_rule_key = "match_result"`)

Regra pura `(selection, _params, resultData) → outcome` lendo `home_score`/`away_score` (placar 90'):
`resultado = home>away ? "home" : home<away ? "away" : "draw"`; `won = selection === resultado`. **Sem
push** (todo placar resolve exatamente uma seleção). `void` só no `pass`. Testar os 3 outcomes por cenário.

## Calibração, baseline e ativação

- **Backtest ≥20 jogos** com resultado conhecido **antes** de ativar a flag, comparado a baselines triviais
  ("sempre favorito pela odd", "sempre empate") — o LLM tem que bater o baseline (ADR 0003 alerta o risco de
  calibração do 1X2). Registrar calibração (confiança vs frequência real) na issue.
- **Feature-flag:** o mercado entra `is_active=false` e só vira analisável quando #173 construir o **gate de
  ativação** (hoje **nada lê `markets.is_active`** pra dispatch — a flag é inerte; #173 implementa o gate,
  não só vira o booleano).
- **Graduação (D9):** ≥30 resolvidas neste mercado **E** Yield positivo neste mercado.
- **Replay-eval:** primeira versão não tem baseline de versão anterior → usa o backtest (spec-mãe §8/§11).
  Generalizar `scripts/replay-prompt-eval.ts` por cartucho faz parte de #173. **PAGO** — orçar no PR.
