# PLAN — #164 Seletor de bookmaker + fetch-and-snapshot + queries genéricos (N seleções)

> Fase 2, passo 2. **v4 — final (incorpora REWORK + re-verify: db.batch, capturedAt=write-time,
> pglite-first, descriptor, read coerente, idempotência).**
> **Pré-requisito DURO:** #163 está em `origin/main` (squash `42db949c`), mas a checkout COMPARTILHADA
> está stale (branch `chore/neon-preview-branch-cleanup`, sem #163). ⇒ criar o worktree do #164
> **off `origin/main`** (`git worktree add -b feat/164-... <path> origin/main`), onde
> `computeMarketImpliedProbabilities(odds[]) → {probs, overround:FRAÇÃO}` JÁ existe.
> Critério-mestre: over/under IDÊNTICO (mesmo book + odds + STRINGS persistidas + quota) +
> 1X2 (h2h, 3 outcomes) write→read ponta-a-ponta contra Postgres REAL (pglite).

## Decisões de arquitetura
- **Dual-write atômico via `db.batch([...])`** — neon-http NÃO suporta `db.transaction` (LANÇA em
  runtime: `node_modules/drizzle-orm/neon-http/session.js:151-153`; precedente do repo:
  `lib/db/queries/invites.ts:65-71`). `db.batch` roda os INSERTs num único round-trip transacional.
  **O fetch (`getOddsForSport`, rede) e a resolução de market/selection ids (reads) acontecem ANTES
  do batch**; só os query builders NÃO-awaited dos 2 INSERTs entram em `db.batch([...])` (espelhar
  invites.ts). Falha antes do batch ⇒ nenhuma escrita.
- **Descriptor local tipado** (NÃO o registry do #165): 3 vocabulários separados — `providerMarketKey`
  (`'totals'`/`'h2h'`), `dbMarketKey` (`'over_under'`/`'match_result'`, ≠ enum legado
  `'over_under_2_5'`), `dbSelectionKey` (`'over'`/`'under'`, `'home'`/`'draw'`/`'away'`). Linha em
  `market_params.line`, nunca em sufixo de key.
- **`DEFAULT_MARKETS=['totals']` fica** em odds-api.ts (odds-api.test.ts inalterado — os ~6 asserts
  de default seguem válidos pois DEFAULT_MARKETS não muda e o caminho genérico passa markets
  explícito). O genérico **asserta markets[] não-vazio** antes do fetch (guarda contra o fallback
  silencioso de `resolveCsv`, odds-api.ts:150-160).

## `lib/odds/market-descriptor.ts` (NOVO; tipado + exportado)
```ts
export type MarketDescriptor = {
  dbMarketKey: string; providerMarketKey: string; params?: { line: number };
  resolveSelectionKey(o: ProviderOutcome, ctx: {homeTeam:string; awayTeam:string}, params?: {line:number}): string | null;
  selectionKeys: string[]; // ordem canônica; valida mercado completo
};
export const OVER_UNDER: MarketDescriptor;    // ativo
export const MATCH_RESULT: MarketDescriptor;  // is_active=false; só dev/test
```
- OVER_UNDER: `name==='Over' && point===params.line → 'over'`; idem under.
- MATCH_RESULT: `name==='Draw' → 'draw'`; senão `teamsMatch(name, homeTeam) → 'home'` /
  `teamsMatch(name, awayTeam) → 'away'` via `normalizeTeamName`/`teamsMatch` (fetch-and-snapshot.ts:17-22),
  NÃO igualdade exata.

## Mudança 1 — `lib/odds/select-bookmaker.ts`
- **`pickBestBookmaker({ event, match, descriptor }): MarketOddsBundle | null`**:
  ```ts
  export type MarketOddsBundle = {
    bookmakerKey: string; bookmakerTitle: string;
    lastUpdate: string;                       // provider market.last_update — SÓ p/ input do LLM
    selections: { key: string; odd: number }[]; overround: number;
  };
  ```
  - por bookmaker: acha market `providerMarketKey`; mapeia outcomes→dbSelectionKeys; exige TODAS as
    `selectionKeys` (senão descarta o book). `overround = computeMarketImpliedProbabilities(odds).overround`.
    escolhe menor overround completo. `lastUpdate = market.last_update` (string) do book escolhido.
  - **`lastUpdate` (provider, string) ≠ o `captured_at` PERSISTIDO** (esse é o now de escrita — Mudança 3).
    `lastUpdate` existe só p/ o wrapper preservar `OddsBundle.capturedAt` byte-a-byte no input do LLM
    (predict.ts:403). `bookmakerKey` não é load-bearing (hoje `''`).
- **Wrapper binário** `pickBestTotalsBookmaker(event): OddsBundle | null` RETIDO (assinatura inalterada):
  chama `pickBestBookmaker` com OVER_UNDER → remapeia p/ `OddsBundle {bookmakerKey, bookmakerTitle,
  overOdd, underOdd, capturedAt: bundle.lastUpdate}`. **Bit-exato** (overround idêntico ao inline :34
  por #163). predict.ts:356 + fetch-and-snapshot:109 inalterados. `lib/ai/__tests__/predict.test.ts`
  monta event real e NÃO mocka o seletor → shape de OddsBundle byte-idêntico.

## Mudança 2 — `lib/db/queries/odds-snapshots.ts` (KEEP binárias; ADD genéricas)
Invariante de escrita: **uma captura = mercado completo de UM book** — N seleções com MESMO
`captured_at` (now de escrita), MESMO bookmaker, MESMO overround_pct.
- **`insertSelectionOddsSnapshotsBatch(rows[])`** onde cada row =
  `{ matchId; marketId; selectionId; marketParams:{line?}; odd:string; overroundPct:string; bookmaker:string; capturedAt:Date }`.
  `capturedAt` **EXPLÍCITO** (mesmo p/ as N linhas), `onConflictDoNothing` na chave de 5 col. Drizzle
  numeric = string (Number() no boundary). **Retorna o query builder não-awaited** p/ caber em db.batch.
- **`insertOddsSnapshotsBatch` (binária, velha)**: adicionar param OPCIONAL `capturedAt?: Date`
  (default = `defaultNow()` p/ back-compat; único caller é fetch-and-snapshot). Assim a dual-write
  passa o MESMO `now` às duas tabelas → `old.captured_at === new.captured_at` (impossível se a velha
  ficasse em defaultNow e a nova noutro valor). Também expõe builder não-awaited p/ db.batch.
- **`getLatestSelectionOddsSnapshots({ matchId, dbMarketKey, params? }): { bookmaker; capturedAt; overroundPct; selections:{key,odd}[] } | null`**:
  - resolve marketId+selectionIds por key (join markets/market_selections; cache por chamada; hard-fail
    se faltar — estilo selId do backfill).
  - **read coerente**: `WHERE matchId AND marketId [AND sql\`market_params->>'line' = ${String(params.line)}\`]`,
    `.selectDistinctOn([selectionId]).orderBy(selectionId, desc(capturedAt))` (1ª expr do ORDER BY = a
    coluna do DISTINCT ON — forma válida, espelha odds-snapshots.ts:56-65). Como toda captura é atômica,
    "última por seleção" = "última captura"; **asserta em app code que as N linhas têm o MESMO
    (capturedAt, bookmaker)** (hard-fail senão). Predicado de `line` OBRIGATÓRIO p/ over_under (senão
    mistura 2.5/3.5 — mesmo marketId/selectionId); h2h OMITE. line no jsonb como **number**, comparado
    via `->>'line'` text contra `String(line)` (testar 3.5 ∌ read 2.5).
- **`getLatestFreshSelectionOddsSnapshots(...)`**: reusa a constante/`isFresh` de
  `getLatestFreshOddsSnapshot` (odds-snapshots.ts:32-33) — mesmo comparador `<`.

## Mudança 3 — `lib/odds/fetch-and-snapshot.ts`
- **`ensureOddsSnapshotsFresh(match, opts: { now?: Date; markets?: MarketDescriptor[] })`** — objeto de
  opções no 2º slot (preserva o clock injetável; NÃO reusar o slot posicional `now: Date`). Default
  `markets=[OVER_UNDER]`. Caller `app/match/[id]/page.tsx:50` (só match) fica idêntico.
- por descriptor:
  - **gate de frescor market-aware**: over_under checa a tabela VELHA (`getLatestFreshOddsSnapshot`,
    comportamento atual); novos (match_result) checam a NOVA. Sem isso, um snapshot fresco de
    over/under daria early-return antes do fetch h2h.
  - se stale: traduz descriptor → markets[] do provider, **asserta não-vazio**, `getOddsForSport`,
    `pickBestBookmaker({event, match, descriptor})` UMA vez → MarketOddsBundle. Resolve market/selection
    ids (read). **Tudo isso ANTES do batch.**
  - `const now = opts.now ?? new Date()`. **`db.batch([...])`** com os builders não-awaited:
    - over_under: `insertOddsSnapshotsBatch(oldRows, now)` (velha, strings idênticas) **+**
      `insertSelectionOddsSnapshotsBatch(newRows com capturedAt=now)` (nova). Ambos do MESMO bundle →
      mesmo overround/bookmaker/now.
    - match_result: SÓ a nova.
- **Nota de fronteira**: a NOVA tabela só é populada por `ensureOddsSnapshotsFresh` (page-render); o
  fetch standalone de `predict.ts:336` grava SÓ a velha até #165 — **#165 NÃO pode assumir a nova
  sempre populada**.

## Mudança 4 — `lib/providers/odds-api.ts`
`DEFAULT_MARKETS`/`DEFAULT_REGIONS` permanecem; `request()`/URL já genéricos. Produção busca só totals
→ quota inalterada. match_result nunca entra no fetch de produção.

## Testes
- **PRIMEIRO PASSO de implementação = spike pglite** (`pnpm add -D @electric-sql/pglite` + driver
  `drizzle-orm/pglite` + setup vitest que roda as migrations reais 1x). pglite é greenfield no repo
  (não há dep nem harness real-DB; odds-snapshots.test.ts é chain-stub; vitest é jsdom). Se funcionar
  no WSL: testes real-DB da NOVA tabela — DISTINCT-ON coerente, `onConflictDoNothing` na chave de 5 col,
  predicado jsonb de line (3.5 ∌ read 2.5), coerência (capturedAt/bookmaker único), **1X2 write→read
  ponta-a-ponta** (fetch mockado → pickBestBookmaker → 3 linhas → read 3 coerentes; o teste SEMEIA
  match_result+home/draw/away no schema de teste — NÃO migration de prod; ativação real é Fase 4/#173).
  **Se pglite falhar no WSL** (time-box ~30min): rodar os 2 caminhos SQL reworked (DISTINCT-ON+line;
  onConflict de 5 col) contra Postgres REAL de outra forma (NÃO inspeção-só) + extrair dedup/coerência/
  shaping em funções puras testadas; **logar o residual explicitamente** no PR (sem cap silencioso).
- **idempotência (real-DB)**: 2 writes com o MESMO `lastUpdate` do provider mas `now` de escrita
  DIFERENTE → DUAS linhas (prova que o histórico é chaveado no captured_at=DB-now, não no last_update sticky).
- **coerência dual-write**: `old.captured_at === new.captured_at` e bookmaker/odds iguais p/ a mesma captura.
- **seletor (puro, event mockado; NÃO existe select-bookmaker.test.ts — NOVO)**: paridade over/under
  (`pickBestBookmaker(OVER_UNDER)` == `pickBestTotalsBookmaker`: mesmo book+odds+overround); 1X2 (3
  outcomes, menor overround; nome de time divergente casado por teamsMatch); book incompleto descartado.
- **paridade de STRINGS persistidas**: overOdd/underOdd `.toFixed(3)`, overroundPct `.toFixed(2)` do
  caminho wrapper == as do atual; helper de formatação ÚNICO; igualdade estrita na math de overround.
- `lib/ai/__tests__/predict.test.ts` (monta event real, NÃO mocka seletor): OddsBundle byte-idêntico.
- `odds-api.test.ts` inalterado. Nenhum teste chama Odds API real nem DB de prod.

## Critérios de saída
- [ ] over/under idêntico: book + odds + **strings persistidas** + quota
- [ ] 1X2 (h2h, 3 outcomes) write→read em pglite (ou fallback rodando o SQL reworked contra PG real)
- [ ] readers legados (predict.ts/app/page.tsx/app/match) INTACTOS e compilando
- [ ] dual-write atômico via **db.batch** (falha = nenhuma escrita); `old.captured_at === new.captured_at`
- [ ] idempotência: mesmo last_update + now diferente = 2 linhas (histórico DB-now)
- [ ] read coerente por book (sem Frankenstein; line scoping)
- [ ] zero `if (market === X)` fora do descriptor; `typecheck`/`lint`/`test` verdes
- [ ] #165 importa `getLatestFreshSelectionOddsSnapshots` + `pickBestBookmaker` + `MarketOddsBundle` +
      descriptors; ciente de que a nova tabela não é sempre populada

## Riscos
- Confirmar no CÓDIGO se fetch-and-snapshot grava UM best-book ou vários — espelhar nas 2 tabelas
  (paridade de strings pega divergência).
- pglite + migrations reais no WSL: spike PRIMEIRO; fallback documentado se travar.
- Os builders não-awaited p/ db.batch: as funções de insert precisam expor o builder (espelhar invites.ts:65-71).
