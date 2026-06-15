# HANDOFF — #288 Seam OddsProvider + DTO NormalizedOdds (ADR 0025)

> Continuidade entre sessões (vive em `docs/handoffs/`, versionado — ver o README).
> **Nova fase (pos-pivot):** o pivot multi-mercado fechou (épico #183). Issue
> auto-contida — handoff curto de propósito.

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

## Inegociável: byte-idêntico
É refactor, não feature. A rede de segurança são os testes de paridade — devem ficar
verdes SEM editar as asserções: `lib/odds/persisted-parity.test.ts`,
`lib/odds/scenario.test.ts`, `lib/odds/select-bookmaker.test.ts`,
`lib/odds/market-descriptor.test.ts`, `lib/providers/odds-api*.test.ts`. Se uma
asserção precisar mudar, o comportamento mudou — pare e reavalie.

## Invioláveis / landmines (carregam)
- Fronteira `lib/providers/` (nunca `fetch` fora); `lib/ai/predict.ts` é a única porta
  do LLM. **SEM migration** nesta issue (refactor puro) — não rode `db:generate`.
- Drizzle numeric→string (Number() no boundary) onde tocar odds.
- `pnpm-workspace.yaml` untracked + HANDOFF-*/PLAN-* — **NUNCA commitar**. Instalar com
  `pnpm install --ignore-workspace` se precisar ([[pnpm-worktree-ignore-workspace]]).
- Label **só `pos-pivot`** — NUNCA `pivot`/`pivot-fase-*` ([[pos-pivot-label-only]]).
- CI = GH Actions (typecheck+lint+test) no PR; merge→deploy de prod (aqui sem migration).

## Critério de saída
Os 6 ACs do #288: OddsProvider+NormalizedOdds definidos (The Odds API = 1º adapter);
os 3 consumidores + descriptor dependem do DTO; semântica preservada; **paridade
byte-idêntica verde**; errata (.env.example Pro 7500/dia + ADR 0005 + comentário
odds-api-constants revisado vs #158); triade verde. **Destrava #289 → #290.**
