# HANDOFF — #288 Seam OddsProvider + DTO NormalizedOdds (ADR 0025)

> Continuidade entre sessões (vive em `docs/handoffs/`, versionado — ver o README).
> **Nova fase (pos-pivot):** o pivot multi-mercado fechou (épico #183). Issue
> auto-contida — handoff curto de propósito.
>
> **Posição na fila ([[work-order-post-pivot]]):** #245 MERGED (PR #300) — esta é a
> PRÓXIMA. #245 mexeu só na camada de análise/UI (`predictions.ts`/`new-analysis-form`);
> a superfície de odds do #288 (abaixo) NÃO foi tocada por ele. Depois: #289 → #290.
> Refs de linha **verificados em 2026-06-16** (seção "Ancoragem no código").

## O que é (2026-06-15)
Refactor **puro, byte-idêntico**. Hoje NÃO existe abstração de provider de odds: o
formato de fio do The Odds API (`OddsApiEventOdds`/`OddsApiOutcome`) vaza direto pra
3 consumidores + o descriptor. ADR 0025 (duplo-provider) pede pagar essa dívida
ANTES do 2º provider (api-football, #289/#290).

Extrair `OddsProvider` (interface) + `NormalizedOdds` (DTO provider-neutro),
envolvendo o cliente atual do The Odds API como **1º adapter**. Sem 2º provider,
sem mudança de produto, sem migration.

## Ler primeiro
- `gh issue view 288 -R fernandolisboa/palpiteiro-claude` (ACs).
- `docs/decisions/0025-api-football-provider-de-odds-duplo-provider.md` (o porquê).
- **O seam a ESPELHAR** (precedente, ADR 0005): `lib/providers/sports-data/` —
  `types.ts` (`SportsDataProvider` + `NormalizedFixture`), `api-football/adapter.ts`,
  `football-data-org/`, `fallback-provider.ts`, `index.ts`. Copiar essa forma pra odds.

## Escopo (do corpo do #288)
- **Interface `OddsProvider` + DTO `NormalizedOdds`** (análogos a SportsDataProvider/
  NormalizedFixture). The Odds API vira o 1º adapter atrás dela.
- **3 consumidores passam a depender do DTO**, não do fio:
  `lib/odds/fetch-and-snapshot.ts`, `lib/ai/predict.ts`, `lib/odds/select-bookmaker.ts`.
- **`lib/odds/market-descriptor.ts` mapeia do DTO** — tirar `providerMarketKey` e
  `resolveSelectionKey(outcome: OddsApiOutcome)` acoplados; **preservar** semântica
  `dbMarketKey`/`dbSelectionKey`/`coveredLeagues`/`oddsSource`/`impliedSumTarget`.
- **Errata de docs** (o ADR 0025 apontou): `.env.example` + ADR 0005 erram o plano da
  api-football (assumem free 100/dia; a chave de prod é **Pro 7500/dia**, ver `GET /status`)
  → adicionar errata; **revisar** (não corrigir cego) o comentário de
  `lib/providers/odds-api-constants.ts` sobre casas BR em `region=eu` à luz da #158.

## Ancoragem no código (line refs verificados 2026-06-16, pós #245)
Onde o fio do The Odds API vaza HOJE (é o que o DTO `NormalizedOdds` tem de esconder):
- **Wire types**: `lib/providers/odds-api-schemas.ts:19-24` (`OutcomeSchema` = `{name,price,point?,description?}`)
  + `:44-52` (`EventOddsSchema` = `id/commence_time/home_team/away_team/bookmakers[].markets[].outcomes[]`).
  Exportados como `OddsApiEventOdds`/`OddsApiOutcome`. **Devem virar PRIVADOS do adapter** — zero re-export.
- **Cliente** (`lib/providers/odds-api.ts`): `getOddsForSport` `:375-406` (→`OddsApiEventOdds[]`),
  `getOddsForEvent` `:408-439` (→`OddsApiEventOdds`), `getEventsForSport` `:357-373` (free, 0 créditos).
- **Consumidor 1 — `lib/odds/select-bookmaker.ts`** (o acoplamento MAIS DURO): `pickBestBookmaker(event: OddsApiEventOdds)`
  `:41-109`; `:57` `m.key === descriptor.providerMarketKey`; `:64-72` `descriptor.resolveSelectionKey(outcome: OddsApiOutcome,…)`;
  **`:77-85` o invariante "mercado COMPLETO de um ÚNICO book"** (hard-fail se faltar qualquer `selectionKey`) — é exatamente
  o que o #289 (correct score ~30 vias só no Bet365) terá de satisfazer; `:94-96` overround via `computeMarketImpliedProbabilities`;
  `:98-104` campos de fio (`bookmaker.title`, `market.last_update`) embutidos no `MarketOddsBundle` → persistidos.
- **Consumidor 2 — `lib/ai/predict.ts`**: import `:18`; `findMatchingEvent` `:119-136` (lê `commence_time/home_team/away_team`);
  `getOddsForSport` `:449-460`; `pickBestBookmaker` `:475-479`; `deriveImplied` `:541-550`; **`impliedSumTarget` dual-site
  `:526/:554` (+ `computeMarketScenarios` na view)** — se os dois sites divergirem o edge quebra (ADR 0018).
- **Consumidor 3 — `lib/odds/fetch-and-snapshot.ts`**: import `:25`; `regions:['eu']` hardcoded `:72`/`:104`;
  `descriptor.providerMarketKey` → client em `:103`/`:199`; persiste `SelectionSnapshotRow` (`lib/db/queries/odds-snapshots.ts:13-22`).
- **`lib/odds/market-descriptor.ts`**: tipo `:22-60`; `providerMarketKey` `:24` (+ por-descriptor `:82/111/123/139/162`);
  `resolveSelectionKey(outcome: OddsApiOutcome,…)` `:26-30`; `ALL_DESCRIPTORS` `:197-202`; `getDescriptor` `:206-210`.
- **O SEAM a espelhar (exato)**: `lib/providers/sports-data/types.ts:166-212` (`SportsDataProvider`) + `:22-40`
  (`NormalizedFixture` DTO + Zod) → copiar a forma interface+DTO+adapter+fallback pra odds.
- **Errata (locais exatos)**: `.env.example:42` ("free 100/dia" → Pro 7500/dia); `docs/decisions/0005-…:15`;
  `lib/providers/odds-api-constants.ts:52-53` (região eu/casas BR — **revisar** vs #158) e `:35-47` (source-of-truth do `providerMarketKey`).

## Inegociável: byte-idêntico
É refactor, não feature. A rede de segurança são os testes de paridade/golden — devem ficar
verdes SEM editar as asserções: `lib/odds/persisted-parity.test.ts`, `lib/odds/scenario.test.ts`,
`lib/odds/select-bookmaker.test.ts`, `lib/odds/market-descriptor.test.ts`,
`lib/odds/implied-probability.test.ts`, `lib/odds/fetch-and-snapshot.pglite.test.ts`,
`lib/providers/odds-api{,-schemas,-constants}.test.ts`, `components/__tests__/odds-card-parity.golden.test.tsx`.
Os mocks de `lib/odds/clv*.test.ts` + `*selection-odds-snapshots*.pglite.test.ts` usam a forma
ANTIGA do bundle — confirmar que ainda compilam/passam. Se uma asserção precisar mudar, o
comportamento mudou — pare e reavalie.

## Invioláveis / landmines (carregam)
- Fronteira `lib/providers/` (nunca `fetch` fora); `lib/ai/predict.ts` é a única porta
  do LLM. **SEM migration** nesta issue (refactor puro) — não rode `db:generate`.
- **`resolveSelectionKey` deve parar de receber `OddsApiOutcome`** — trocar por um tipo de
  outcome provider-agnóstico (`NormalizedOddsOutcome`). A mudança de assinatura cascata pra
  TODOS os descriptors (OVER_UNDER/MATCH_RESULT/BTTS/DOUBLE_CHANCE + OVER_UNDER_ALT via spread).
  **NÃO** usar union types cross-provider — o adapter normaliza ANTES do descriptor.
- **Wrapper binário `pickBestTotalsBookmaker`** (back-compat) tem callers legados
  (`predict.ts:356`, `fetch-and-snapshot.ts:109`) — deve continuar funcionando (mapeia o
  bundle N-ário de volta pra `{overOdd,underOdd}`).
- **`OVER_UNDER_ALT`** (`market-descriptor.ts:109-115`) NÃO está em `ALL_DESCRIPTORS` mas é
  referenciado DIRETO pelo cartucho v3 (`lib/ai/markets/over_under/index-v3.ts:10`) — o refactor
  tem de manter essa ref direta válida.
- Drizzle numeric→string (Number() no boundary) onde tocar odds.
- **Gitignored = NUNCA commitar:** só `.playwright-mcp/` + `pnpm-workspace.yaml` (o stub do
  workspace quebra `pnpm install` em CI). HANDOFF-*/PLAN-* **SÃO versionados** (commit
  `docs(handoff):`/`docs(plan):` ou junto no PR — ver #293/#299/#300). Em worktree, instalar com
  `pnpm install --ignore-workspace` ([[pnpm-worktree-ignore-workspace]]).
- Label **só `pos-pivot`** — NUNCA `pivot`/`pivot-fase-*` ([[pos-pivot-label-only]]).
- CI = GH Actions (typecheck+lint+test) no PR; merge→deploy de prod (aqui sem migration).

## Critério de saída
Os 6 ACs do #288: OddsProvider+NormalizedOdds definidos (The Odds API = 1º adapter);
os 3 consumidores + descriptor dependem do DTO; semântica preservada; **paridade
byte-idêntica verde**; errata (.env.example Pro 7500/dia + ADR 0005 + comentário
odds-api-constants revisado vs #158); triade verde. **Destrava #289 → #290.**
