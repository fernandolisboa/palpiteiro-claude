# Dupla chance — Prompt Design Spec (cartucho `double_chance`)

**Status:** IMPLEMENTADO ([#176](https://github.com/fernandolisboa/palpiteiro-claude/issues/176), ATIVO
atrás de flag, admin-only, restrito a `world_cup`) · **Versão:** `double_chance_v1` · **Mercado:** N=3
(cobertura sobreposta), **sem linha**.

Design spec — o contrato que #176 implementa. Instancia a [spec-mãe](./cartridge-prompt-contract.md).
Terceiro mercado de seleções múltiplas — **reusa o shape 3-vias do 1X2** (#173 é dependência). Reconciliar
versão + paths ao aterrissar.

## Seleções e descriptor

- **Seleções:** `home_or_draw` (1X) / `away_or_draw` (X2) / `home_or_away` (12)
  (`selectionKeys = ["home_or_draw","away_or_draw","home_or_away"]`). Confirmar as chaves exatas do seed ao
  implementar — as labels leigas vêm da apresentação (`1X`/`X2`/`12` ou por extenso).
- **Provider:** `providerMarketKey = "double_chance"` (The Odds API, mercado **additional**). Os outcomes do
  provider carregam nome de time → `resolveSelectionKey` casa via `teamsMatch` (como o 1X2) pra mapear a
  dupla. Descriptor `DOUBLE_CHANCE` **não existe ainda** — #176 o adiciona.
- ⚠️ Odds **lazy por evento** (`markets=double_chance`), idem BTTS; **pode compartilhar o request do BTTS**
  (1 request, 2 markets) quando ambos analisados.

## Saída do LLM

Single-rec + `confidence_pct` (mesma decisão de design do 1X2 — ver
[match-result](./match-result-prompt-design.md), "Saída do LLM"): `recommendation`
(`home_or_draw`/`away_or_draw`/`home_or_away`/`pass`) + `confidence_pct` do lado recomendado. Tolerância de
prosa: spec-mãe §6.

## Edge (N=3 NÃO-PARTIÇÃO, ADR 0018 + emenda)

As 3 duplas se **sobrepõem** (1X/X2/12 cobrem 2 de 3 resultados cada) → a prob real soma **~200%**, não
100%. A implícita é de-vigada das 3 odds **mantendo a semântica de par** (`implied_i = (raw_i / Σ raw)·2`,
Σ=2) via `MarketDescriptor.impliedSumTarget = 2` — ver a **Emenda** do ADR 0018 (cobertura não-partição).
Normalizar Σ=1 (como partição) deixaria o floor ~2× rígido OU exibiria prob enganosa (~48% pra uma dupla
de favorito ~92%). O LLM emite as probs de par HONESTAS (somam ~200, cada ≤100) e
`edge_i = modelProb_i − implied_i` fica na escala de par. **Atenção de produto:** odds de dupla chance são
baixas (favoritos ~1.20) → a implícita é alta → o floor de edge ≥ 5pp vai gerar **muito `pass`**. Isso é
**esperado e saudável** (`pass` é cidadão de 1ª classe); não relaxar o floor pra "achar" apostas.

## Settlement (`settlement_rule_key = "double_chance"`)

Regra pura lendo `home_score`/`away_score`: `resultado = home>away ? "home" : home<away ? "away" : "draw"`;
mapa seleção → conjunto permitido (`home_or_draw → {home,draw}`, `away_or_draw → {draw,away}`,
`home_or_away → {home,away}`); `won = conjunto.has(resultado)`. **Sem push.** Testar os 3 outcomes (vitória
casa / empate / vitória fora) contra as 3 seleções.

## Baseline e ativação

- **Cobertura validada em 2026-06-12** ([#158](https://github.com/fernandolisboa/palpiteiro-claude/issues/158)):
  williamhill/codere_it/onexbet na região `eu` (ex.: 1.95/1.18/1.30). Mesma pendência do BTTS — re-checar o
  Brasileirão antes de ativar a flag pra ele.
- **Backtest ≥20 jogos** vs baseline trivial; feature-flag + graduação D9 (spec-mãe §11). Replay-eval
  **PAGO** — orçar no PR.

**Critério de saída da Fase 4:** cada mercado ativo passou por flag + backtest ≥20 + baseline e tem régua D9
visível no dashboard; o over/under 2.5 segue com tracking intacto.
