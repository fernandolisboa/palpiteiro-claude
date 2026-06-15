# PLAN — Fase 1 (expand + backfill) · design concreto p/ review

> Scratch (não commitar). Aterrado no `db/schema.ts` REAL (head migration `0008`, próxima `0009`).
> Princípio: **expand-migrate-contract** (ADR 0015/D6). Só EXPAND (cols/tabelas nullable) + MIGRATE
> (backfill). Zero contract. Zero `if (market === X)`. Dashboard idêntico antes/depois.

## Ground truth confirmado (db/schema.ts)
- `marketEnum = ["over_under_2_5"]` (:32) — consumido em `predictions.market` (:211) e `matchOddsSnapshots.market` (:159). PERMANECE.
- `recommendationEnum = ["over","under","pass"]` (:34). PERMANECE.
- `outcomeResultEnum = ["won","lost","void"]` (:40) — **sem push**. #161 adiciona.
- `matches.homeScore`/`awayScore` integer **nullable** (:144-145) — fonte do split p/ result_data.
- `matchOddsSnapshots`: market, line(2.5), overOdd, underOdd, overroundPct, capturedAt (:151).
- `predictions`: market enum (:211), oddAtRecommendation (:217), overOddAtPrediction/underOddAtPrediction numeric(6,3) nullable (:227-228, ADR0012, sem backfill histórico), stakeUnits notNull default "1" (:229).
- `predictionOutcomes`: predictionId UNIQUE cascade (:245), totalGoals integer notNull (:247), result, profitUnits numeric(8,2), overrideByUserId, settledAt.
- Dashboard `getUserDashboardRows` (dashboard.ts:28) seleciona `predictions.market` (enum) — **NÃO** lê nenhuma coluna nova. `kpis.ts` soma profitUnits/stakeUnits. **Logo: paridade é estrutural** (dashboard lê as MESMAS colunas; backfill não toca profit/result/stake/total_goals/recommendation/market-enum).
- Precedente de enum: `0002_plain_caretaker.sql` = SÓ `ALTER TYPE "public"."league" ADD VALUE 'world_cup';` (standalone, deployou no Neon). → isolar ADD VALUE é o padrão PROVADO.
- drizzle.config: casing snake_case, out ./db/migrations, strict.
- `.env.local` existe (DATABASE_URL → Neon compartilhado/prod). NÃO rodar db:migrate/backfill local; validação = Vercel preview (Neon branch). db:generate é offline (safe).

## Decisões cravadas neste plano (documentar nos PRs)
- **D-a result_data shape:** `{ homeScore:int|null, awayScore:int|null, totalGoals:int }` (camelCase, +totalGoals) — segue #161/#162 (spec mais recente/específica) em vez do `{home_score,away_score}` literal do ADR 0016 (ilustrativo, snake). totalGoals SEMPRE presente (vem do escalar `total_goals` existente); home/away degradam a null onde `matches` não tiver. Validado por Zod no boundary.
- **D-b flags de markets:** dois booleans `isActive` + `isGraduated` (D9: active=feature-flag ligado; graduated=passou ≥30 resolvidas + Yield+). Nada lê isso na Fase 1. Seed over_under = active:true, graduated:true (mercado maduro/live).
- **D-c settlementRuleKey:** text notNull = `"over_under"` (chave do registry ADR 0016).
- **D-d seed via MIGRATION, não db/seed.ts:** a row `markets(over_under)` + seleções precisam existir em TODO ambiente (preview+prod) porque predictions FK→markets em Fase 2+. db/seed.ts é dev-only (`pnpm db:seed`, não roda em prod). → INSERT idempotente (`ON CONFLICT DO NOTHING`) **appendado à migration 0009** (DML numa migration não altera o snapshot; safe). db/seed.ts NÃO precisa replicar.
- **D-e enum isolado:** #161 faz db:generate em DOIS passos → migration só-`ADD VALUE 'push'` (igual 0002) + migration tabela/coluna. Evita a questão transacional inteira.
- **D-f FKs:** predictions.market_id/selection_id → onDelete restrict (igual matchId/userId/aiCallId). Child tables (prediction_selection_odds, selection_odds_snapshots) → predictionId/matchId cascade; selectionId/marketId restrict.

---

## #159 — markets + market_selections + seed (migration 0009)

schema.ts (depois dos enums, antes/depois de matches — colocar perto do topo das tabelas de domínio):
```ts
export const markets = pgTable("markets", {
  id: uuid().primaryKey().defaultRandom(),
  key: text().notNull().unique(),               // "over_under"
  label: text().notNull(),                      // "Over/Under gols"
  settlementRuleKey: text().notNull(),          // "over_under" (registry ADR 0016)
  isActive: boolean().notNull().default(false),
  isGraduated: boolean().notNull().default(false),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const marketSelections = pgTable("market_selections", {
  id: uuid().primaryKey().defaultRandom(),
  marketId: uuid().notNull().references(() => markets.id, { onDelete: "cascade" }),
  key: text().notNull(),                         // "over" / "under"
  label: text().notNull(),
  sortOrder: integer().notNull().default(0),
}, (t) => [
  unique("market_selections_market_id_key_unique").on(t.marketId, t.key),
]);
```
- `unique` importado de drizzle-orm/pg-core.
- Seed (appendar ao 0009.sql, idempotente):
```sql
INSERT INTO "markets" ("key","label","settlement_rule_key","is_active","is_graduated")
VALUES ('over_under','Over/Under gols','over_under', true, true)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "market_selections" ("market_id","key","label","sort_order")
SELECT m.id, v.key, v.label, v.sort_order
FROM "markets" m
CROSS JOIN (VALUES ('over','Over',0),('under','Under',1)) AS v(key,label,sort_order)
WHERE m.key='over_under'
ON CONFLICT ("market_id","key") DO NOTHING;
```
- Aditivo puro. Não toca predictions/outcomes/snapshots. Zero comportamento.

## #160 — predictions cols + prediction_selection_odds (migration 0010)

Em `predictions` (todas nullable):
```ts
  marketId: uuid().references(() => markets.id, { onDelete: "restrict" }),
  selectionId: uuid().references(() => marketSelections.id, { onDelete: "restrict" }),
  marketParams: jsonb(),
```
+ index `predictions_market_id_idx` (dashboard JOIN). selectionId index opcional (join Fase 3) — incluir `predictions_selection_id_idx` (barato, forward).

Nova tabela:
```ts
export const predictionSelectionOdds = pgTable("prediction_selection_odds", {
  id: uuid().primaryKey().defaultRandom(),
  predictionId: uuid().notNull().references(() => predictions.id, { onDelete: "cascade" }),
  selectionId: uuid().notNull().references(() => marketSelections.id, { onDelete: "restrict" }),
  odd: numeric({ precision: 6, scale: 3 }).notNull(),
}, (t) => [
  index("prediction_selection_odds_prediction_id_idx").on(t.predictionId),
  unique("prediction_selection_odds_prediction_id_selection_id_unique").on(t.predictionId, t.selectionId),
]);
```
- 1 row/(prediction,selection), odd congelada (inclusive pass). UNIQUE → upsert idempotente no backfill.
- predict.ts NÃO preenche (Fase 2 #165). Aditivo. Zero comportamento.

## #161 — selection_odds_snapshots + push + result_data (migrations 0011 + 0012)

Passo A (schema: só enum) → db:generate → **0011** = `ALTER TYPE "public"."outcome_result" ADD VALUE 'push';`
```ts
export const outcomeResultEnum = pgEnum("outcome_result", ["won","lost","void","push"]);
```
Passo B (schema: tabela + coluna) → db:generate → **0012**:
```ts
export const selectionOddsSnapshots = pgTable("selection_odds_snapshots", {
  id: uuid().primaryKey().defaultRandom(),
  matchId: uuid().notNull().references(() => matches.id, { onDelete: "cascade" }),
  marketId: uuid().notNull().references(() => markets.id, { onDelete: "restrict" }),
  selectionId: uuid().notNull().references(() => marketSelections.id, { onDelete: "restrict" }),
  bookmaker: text().notNull(),
  marketParams: jsonb(),
  odd: numeric({ precision: 6, scale: 3 }).notNull(),
  overroundPct: numeric({ precision: 5, scale: 2 }).notNull(),
  capturedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("selection_odds_snapshots_match_market_selection_captured_idx")
    .on(t.matchId, t.marketId, t.selectionId, desc(t.capturedAt)),
]);
```
+ `predictionOutcomes.resultData = jsonb()` (nullable). totalGoals permanece.
- `desc` importado de drizzle-orm. Index espelha o DISTINCT ON (matchId) da odds-snapshots.ts, generalizado p/ "última por match+market+selection".
- push: nenhum código emite (settlement plugável = Fase 2 #166).

## #162 — backfill determinístico (tsx script, sem migration)

Script `db/scripts/backfill-multimarket.ts` (espelha db/seed.ts: dotenv .env.local → neon-http). Flags `--dry-run` (default? não — default seguro = dry-run; `--apply` p/ escrever). Idempotente (WHERE ... IS NULL / ON CONFLICT DO NOTHING). Transação por etapa.
Lógica determinística (pura, testável sem DB):
1. **predictions**: para toda row → `market_id = (over_under).id`, `market_params = {"line":2.5}`. `selection_id`: recommendation `over`→sel over, `under`→sel under, `pass`→NULL. (idempotente: só onde market_id IS NULL.)
2. **prediction_selection_odds**: p/ cada prediction com `overOddAtPrediction` E `underOddAtPrediction` não-null → 2 rows: (sel over, overOdd), (sel under, underOdd). Onde par null → SEM rows (degrada, ADR0012/5). ON CONFLICT(prediction_id,selection_id) DO NOTHING.
3. **prediction_outcomes.result_data**: `{ homeScore: matches.home_score, awayScore: matches.away_score, totalGoals: prediction_outcomes.total_goals }`. home/away null onde matches não tiver. Só onde result_data IS NULL. **NÃO** toca profit_units/result/total_goals.
4. **selection_odds_snapshots**: cada match_odds_snapshot → 2 rows (over/under) com mesmo overround_pct, captured_at, bookmaker, market_id=over_under, selection_id, market_params={line: snapshot.line}, odd=overOdd/underOdd. ON CONFLICT/where-not-exists p/ idempotência. (Critério: count = 2× match_odds_snapshots.)
- Unit tests: funções puras de mapping (recommendation→selectionKey; par→linhas; scores→result_data) — sem DB, sem LLM.
- **Paridade:** script/print de KPIs (reusa computeDashboardKpis sobre getUserDashboardRows p/ todos users) antes/depois → 1:1. RUN contra DB real precisa de credencial (ver questão aberta).

## RESOLUÇÕES do plan-review adversarial (4 lentes) — aplicar na implementação

- **R1 (BLOCKER #161 typecheck):** `ADD VALUE 'push'` NÃO é code-free. Widena `DbPredictionOutcome['result']` →
  quebra `tsc` em: `lib/settlement/compute.ts:7` (`OutcomeResult`), `app/admin/predictions/[id]/page.tsx:~34`
  (`defaultResult: OutcomeResult`), `lib/view/dashboard.ts:~155/211` (union do view), `lib/dashboard/kpis.ts:24`
  (`DashboardRow.result`) + `RowStatus`/`StatusFilter`. #161 DEVE widenar essas unions p/ incluir `"push"` (verificar
  sites reais + rodar typecheck). Behavior-idêntico (zero rows push). Em kpis.ts: excluir `push` do yield/winrate como o
  `void` (estrutural) — com zero push rows os números são byte-idênticos. Verificar cada site lendo o arquivo real.
- **R2 (rationale enum split):** manter o split 0011(ADD VALUE)/0012(tabela) por HIGIENE, mas a segurança vem de
  PG12+ (Neon é PG15+: `ADD VALUE` roda em txn; só não pode USAR o valor na mesma txn). `drizzle-kit migrate` envolve
  TODAS as migrations pendentes em UMA transação. Invariante: nenhuma migration que USE `'push'` pode ir no mesmo batch
  do 0011 (na Fase 1 nada usa). Documentar no PR #161.
- **R3 (BLOCKER #162 neon-http sem transação):** `db.transaction()` LANÇA no neon-http (precedente: `invites.ts:65-67`,
  `predict.ts:516`). Backfill = SQL set-based (`UPDATE ... FROM`, `INSERT ... SELECT`) + idempotência por-statement
  (`WHERE ... IS NULL` / `ON CONFLICT DO NOTHING`), agrupar com `db.batch([...])` se preciso. Sem `db.transaction`.
- **R4 (BLOCKER idempotência selection_odds_snapshots):** a tabela PRECISA de um UNIQUE p/ o `ON CONFLICT` do backfill,
  senão 2ª run → 4x rows (falha o critério "=2x" + "roda 2x sem efeito"). Adicionar em #161:
  `unique("selection_odds_snapshots_dedup_key").on(matchId, marketId, selectionId, capturedAt, bookmaker)` — serve TAMBÉM
  de index de leitura "última por (match,market,selection)" (prefixo + backward scan no captured_at). SEM index `desc`
  separado, SEM import `desc`. No #162: rodar check read-only de duplicatas em (match_id,bookmaker,captured_at) ANTES do
  backfill; se houver colisão real, tratar explícito (provavelmente odds idênticas → colapso ok, ou refinar).
- **R5 (result_data):** manter `{homeScore, awayScore, totalGoals}` (spec das issues; NÃO contradiz a ADR 0016 D2, que
  fala do ESCALAR `total_goals` virar derivado — não proíbe a key no jsonb). `totalGoals` := cópia VERBATIM do escalar
  `total_goals` (idênticos por construção; unit-test). `homeScore`/`awayScore`: NÃO confiar cegamente em `matches.home/away`
  como o fato de 90' (pode ser full-time c/ ET — ver memória football-data). No #162 rodar check read-only:
  `COUNT(*) WHERE matches.home_score+away_score <> total_goals` p/ rows settled; se bater, usar matches; senão null no split
  (degrada, ADR 0016 D2). Override: `result_data.totalGoals` = o `total_goals` da PRÓPRIA row (verdade do override), nunca
  recomputar de matches. Backfill só onde `result_data IS NULL`; nunca toca total_goals/result/profit/settled/override.
- **R6 (markets flags):** manter `isActive`+`isGraduated` (forma do handoff). Seed over_under: isActive=true,
  isGraduated=true (mercado flagship maduro — ground-truth, não asserção vazia). Inerte na Fase 1 (zero readers; verificado
  git grep limpo). #171 é dono do writer de graduação p/ mercados novos. Documentar a ressalva da lente ADR no PR.
- **R7 (jsonb $type):** declarar `predictions.marketParams.$type<{ line: number }>()` e
  `predictionOutcomes.resultData.$type<{ homeScore: number | null; awayScore: number | null; totalGoals: number }>()`
  p/ tipo inferido honesto + `.values()` type-checked no backfill. Zod guard runtime entra na Fase 2 (lib/settlement p/
  result_data, lib/ai/schemas p/ market_params) quando surgir um reader.
- **R8 (imports schema.ts):** ADICIONAR `unique` ao bloco `drizzle-orm/pg-core` (hoje só o método de coluna `.unique()` é
  usado; o builder de tabela `unique("name").on(...)` é export distinto, ainda não importado). `boolean`/`jsonb`/`index`
  já importados. NÃO importar `desc` (não uso mais index ordenado).
- **R9 (prediction_selection_odds = candidate set):** comentar no schema/backfill que guarda as odds CONGELADAS de TODAS as
  seleções do mercado na análise (candidate set), independente de `predictions.selection_id` (lado escolhido; NULL em pass).
  Pass com par congelado → 2 rows (over+under). Assert no #162: 2 rows por prediction com par; 0 sem par.
- **R10 (registry key):** `markets.key = settlement_rule_key = 'over_under'` fica COMMITTED como a string que o registry da
  Fase 2 (#166 settlement, #165/#167 cartucho) resolve. Registrar no PR #159 + HANDOFF-fase-2.
- **R11 (seed via migration):** confirmar pós-`db:generate`: 0009_snapshot.json + _journal.json gerados; INSERTs APPENDADOS
  ABAIXO do DDL com `--> statement-breakpoint`; `ON CONFLICT (market_id, key)` casa o nome do constraint emitido. Re-rodar
  `db:generate` deve dar diff VAZIO (sem drift). NÃO editar meta/ à mão.
- **R12 (paridade ≠ preview verde):** a preview Vercel fica verde SEM provar paridade (backfill é script fora do build).
  No #162: prova de paridade é gate SEPARADO — KPIs (computeDashboardKpis sobre getUserDashboardRows p/ todos users)
  ANTES, `--apply`, DEPOIS, diff 1:1 colado no PR. O sinal de saída da fase é o diff de KPI, não o build verde.

## Questões abertas (resolver no devido passo)
- **Execução do backfill + prova de paridade**: precisa do DB com histórico real (.env.local → prod/compartilhado). Opções: (a) usuário roda `--dry-run` depois `--apply` e cola before/after no PR #162; (b) tornar backfill uma migration SQL p/ rodar auto na preview branch (mas issue pede "script com dry-run"). Decidir no #162.
- Index do selection_odds_snapshots: 4-col (match,market,selection,captured desc) cobre prefixo match+market. OK? ou só (match,market,captured desc)?
- prediction_selection_odds: gravar em pass? Sim (par congelado existe em pass, ADR0012). Confirmar backfill cria rows mesmo p/ pass.
