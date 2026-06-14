# BTTS (ambas marcam) — Prompt Design Spec (cartucho `btts`)

**Status:** PLANEJADO (implementação em [#174](https://github.com/fernandolisboa/palpiteiro-claude/issues/174),
atrás de feature-flag) · **Versão:** `btts_v1` (a confirmar) · **Mercado:** N=2, **sem linha**.

Design spec — o contrato que #174 implementa. Instancia a [spec-mãe](./cartridge-prompt-contract.md). É o
**validador binário** do caminho genérico Tier 2: 2 seleções como over/under, mas settlement trivial por
placar e odds via mercado *additional* (não *featured*). Reconciliar versão + paths ao aterrissar.

## Seleções e descriptor

- **Seleções:** `yes` / `no` (`selectionKeys = ["yes","no"]`). Sem linha (`market_params = null`).
- **Provider:** `providerMarketKey = "btts"` (The Odds API, mercado **additional**). `resolveSelectionKey`:
  `outcome.name.toLowerCase()` → `"yes"`/`"no"`. O descriptor `BTTS` **não existe ainda** — #174 o adiciona
  em `lib/odds/market-descriptor.ts`.
- ⚠️ **Odds só pelo endpoint por evento** (`/events/{id}/odds`, `markets=btts`): fetch **lazy por evento**
  quando o usuário analisa — **nunca em batch** (quota 500 req/mês; custo = nº de markets × regiões). Pode
  compartilhar o request com dupla chance (1 request, 2 markets) quando ambos forem analisados.

## Saída do LLM

Single-rec + `confidence_pct` (paridade com over/under — N=2): `recommendation` (`yes`/`no`/`pass`) +
`confidence_pct` do lado recomendado. Convenção de `confidence_pct` em `pass` a definir (ex.: P(yes)).
`minimum_odd` obrigatório fora de `pass`. Tolerância de prosa: spec-mãe §6.

## Edge (N=2, ADR 0018)

`implied_yes`/`implied_no` normalizados pelo overround do par; `edge_i = modelProb_i − implied_i`. Caso
binário (mesma forma do over/under, sem linha).

## Settlement (`settlement_rule_key = "btts"`)

Regra pura lendo `home_score`/`away_score`: `both = home_score > 0 && away_score > 0`;
`won = selection === "yes" ? both : !both`. **Sem push.** Testar `0x0` (no), `2x0`/`0x1` (no), `1x1`/`2x1`
(yes).

## Cobertura, baseline e ativação

- **Cobertura validada em 2026-06-12** ([#158](https://github.com/fernandolisboa/palpiteiro-claude/issues/158)):
  com `regions=eu`, `btts` retornou de pinnacle/williamhill/onexbet/matchbook em jogos da Copa (ex.:
  Yes=2.06/No=1.81). **Pendência:** re-checar o Brasileirão na volta da pausa — se negativo, **restringir o
  mercado às ligas com cobertura** antes de ativar a flag pra elas.
- **Backtest ≥20 jogos** vs baseline trivial (ex.: "sempre yes"); calibração registrada. Feature-flag +
  graduação D9: mesmo protocolo da spec-mãe §11. Replay-eval **PAGO** — orçar no PR.
