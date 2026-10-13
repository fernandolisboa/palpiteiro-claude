# PLAN-555 — Fase 1: base do modelo por jogo (pré-previsão sem Claude)

Issue: #555. Proposta "pré-previsão, bet slip e análise do seu palpite", Fase 1 ("Base primeiro").
ADR novo: **0052** (`docs/decisions/0052-base-do-modelo-por-jogo.md`).
O PR #554 (menu/navegação) já está mergeado nesta branch: as páginas logadas vivem em `app/(app)/`.

## 0. Sanity-check

Faz sentido. Hoje a probabilidade do modelo só existe depois de "Analisar com IA" (por usuário,
por mercado, com narração paga). O λ (Dixon-Coles/heurístico, ADR 0051) e o ajuste JEV (ADR 0041)
são do **jogo**, não do usuário: calcular uma vez por jogo, em código, separa probabilidade (estável,
grátis) de preço (volátil) e deixa as Fases 2/3 lerem da mesma base. Custo novo: JEV (~US$ 0,0001 por
chamada, só ≤48h do jogo) e chamadas de API-Football (sem The Odds API, sem Claude).

## 1. Correções às premissas (verificadas no código)

| Premissa | Realidade | Efeito no plano |
|---|---|---|
| `30 */6 * * *` roda às 07:30 e pega o refit das 07:00 | `*/6` = 00:30, 06:30, 12:30, 18:30 UTC. O 1º run depois do refit seria 12:30 | Agendar **`30 1,7,13,19 * * *`** (07:30 = 30 min depois do refit de `0 7 * * *`; 1h30 depois de sync-fixtures/prewarm-odds `0 */6`). Sem acoplar ao cron de refit (decidido) |
| "JEV" = chamada barata em código | `judgeMatch` chama a API TypeSafe (System One) e loga em `ai_calls` (`provider = JUDGMENT_PROVIDER_KEY = "typesafe"`, `lib/ai/models.ts:134`). Não é Claude | "Nenhuma chamada LLM nova" = **nenhuma chamada nova a Claude** (decidido). O JEV do cron fica atrás do flag novo |
| `runJudgments`/`resolveMatchJudgments` reusáveis de fora | São `async function` privadas de `lib/ai/predict.ts` (~l.1724/1828); `FORM_LAST = 5` também é privado (l.189) | Exportar de `predict.ts` um wrapper fino + `FORM_LAST`; a porta do JEV continua sendo `predict.ts` (ADR 0041 §5, CLAUDE.md) |
| Throughput do cron | API-Football tem throttle **8 req/min por processo** (`apiFootballClient`, adapter.ts l.86), plano de produção Pro/7500 por dia (ADR 0025). Por jogo na janela JEV: `/fixtures` (por data, cacheado), `/injuries`, `/fixtures/lineups`, 2× forma (`/fixtures?team&last`), +1–2 lineups anteriores se houver desfalque ≈ 4–7 req (pior caso ~55 s + a chamada JEV) | Prazo de **200 s** pra começar um jogo JEV (pior caso 200 + 70 = 270 s < `maxDuration = 300`) ⇒ **~4–6 jogos com JEV por run**. Fila priorizada (§4, passo 5); o resto fica pro próximo run. Standings lido **sob demanda** (só se cair no heurístico ou se o jogo for pra fila JEV) |
| `getMatchesInLeagueWindow` filtra status | Não filtra (só liga + janela de kickoff) | Filtrar `status === "scheduled" && kickoff > now` no código |
| Reuso JEV só por janela de 6h no `created_at` | Com "não grava row igual", a row do snapshot fica com o `computed_at` antigo; depois de 6h o reuso por `created_at` falha e o "Analisar com IA" volta a pagar JEV — exatamente o que a issue quer evitar | Coluna **`checked_at`** (heartbeat, único campo mutável) + janela de reuso de **12h sobre `checked_at`** pra origem snapshot (decidido; §3.3) |
| `MatchHeroView` é independente | `MatchHeroView = MatchRowView` (lib/view/types.ts l.72); `toMatchHeroView` só repassa `toMatchRowView` (lib/view/match.ts l.104) | `MatchHeroView = Omit<MatchRowView, "model">` e `toMatchHeroView` **remove** `model` (firewall ADR 0030 no tipo, não por convenção) |
| Ripple de `ai_calls.user_id` nullable | Leitores de `aiCalls.userId`: `lib/db/queries/ai-costs.ts` (`getCostByUser`, innerJoin users) e `app/actions/bets.ts` (`eq(aiCalls.userId, session.user.id)`, continua válido). `DbAiCall` (`$inferSelect`) é usado em dashboard/palpites/predictions, mas ninguém lê `.userId` | Ripple pequeno (~7 arquivos): **seguir com nullable**, travado por **CHECK** `user_id IS NOT NULL OR provider = 'typesafe'` (só o JEV de sistema pode ficar sem usuário) |
| Lock de cron reaproveitável | `lib/sync/lock.ts` (`acquireSyncLock({ ttlMs?, force? })`, l.67) usa `SET NX EX` no KV, mas a chave é fixa (`SYNC_LOCK_KEY`) e o `releaseSyncLock()` não recebe chave | Generalizar o módulo por chave (§4, "Lock"), com `acquireSyncLock/releaseSyncLock` virando wrappers (o `lib/sync/__tests__/lock.test.ts` segue igual) |
| Cupom (Fase 2) relê o modelo | `confirmBet` (`app/actions/bets.ts` l.581–602) monta o `ModelScoreline` do CAMINHO B com `getModelScoreline` memoizado (busca tabela + ratings a cada confirmação) | Seam `getMatchModelScoreline` (§4) que reconstrói o MESMO `ModelScoreline` da base; na fase do cupom, `confirmBet` tenta ele primeiro e cai no caminho atual (este PR só entrega o seam) |

## 2. Arquivos

### Criar
- `docs/decisions/0052-base-do-modelo-por-jogo.md` — ADR.
- `db/migrations/0054_match_model_snapshots.sql` (+ `meta/0054_snapshot.json`, `_journal.json`) — via `pnpm db:generate --name match_model_snapshots`, editado à mão com `IF NOT EXISTS`/DO block.
- `lib/model-base/version.ts` — `MATCH_MODEL_VERSION = "match_model_v1"`.
- `lib/model-base/types.ts` — schemas Zod + tipos (`MatchModelProbabilities`, `TopScoreline`, `MatchModelJudgments`, `MatchModelSnapshot`).
- `lib/model-base/build-snapshot.ts` — puro: probabilidades, top placares, fingerprint, montagem da row.
- `lib/model-base/judgment-data.ts` — busca dos dados do state JEV (forma, desfalques, escalação) via `lib/providers/`.
- `lib/model-base/compute-match-models.ts` — orquestração do cron (+ `orderJevQueue` puro, exportado).
- `lib/model-base/reading.ts` — loader server-side da "Leitura do modelo" (DB + odds já gravadas, nenhuma chamada nova).
- `lib/model-base/model-scoreline.ts` — `getMatchModelScoreline` (seam da Fase 2).
- `lib/db/queries/match-model-snapshots.ts` — boundary única da tabela.
- `lib/view/match-model.ts` — mappers puros (linha do /jogos e bloco da página).
- `app/api/cron/compute-match-models/route.ts`.
- `components/match-model-line.tsx` — linha compacta do /jogos (sem `"use client"`, sem deps de servidor; usada pela `MatchRow` server e pela `UpcomingMatchesDesktop` client).
- `components/match-model-reading.tsx` — `MatchModelReading` (async server) + `MatchModelReadingSkeleton`.
- Testes (§9).

### Modificar
- `db/schema.ts` — tabela `matchModelSnapshots`; `aiConfig.enableMatchModelJev`; `aiCalls.userId` sem `.notNull()` + `check("ai_calls_user_id_system_only", ...)` nos extras da tabela (pro snapshot do drizzle-kit ficar coerente com o SQL).
- `lib/quant/scoreline-model.ts` — `topScorelines(matrix, n)`.
- `lib/ai/judgments/state-hash.ts` — exportar `canonicalHash(value: unknown): string` (sha256 do `canonicalJson` já existente; `judgmentStateHash` passa a chamá-lo, saída idêntica).
- `lib/ai/engine/types.ts` — `PredictionJudgments.reusedFromModelSnapshotId?: string | null`.
- `lib/ai/predict.ts` — `runJudgments` com `userId: string | null` e origem snapshot no reuso; export `resolveModelBaseJudgments`, `type JudgmentRun`, `FORM_LAST`, `JUDGMENT_REUSE_WINDOW_MS`, `MODEL_BASE_JEV_REUSE_WINDOW_MS`.
- `lib/db/queries/judgments.ts` — `findReusableJudgments` cai no snapshot quando não há predição.
- `lib/ai/ai-call-logging.ts` — `persistJudgmentAiCall({ userId: string | null, ... })`.
- `lib/db/queries/ai-costs.ts` — `getCostByUser` com `leftJoin`; `CostByUser.userId/email: string | null`.
- `app/(app)/admin/costs/page.tsx` — `key={u.userId ?? "system"}`, rótulo `u.email ?? "sistema"`.
- `lib/sync/lock.ts` — lock genérico por chave (wrappers do sync mantidos).
- `lib/config/admin-flags.ts` — entrada `enableMatchModelJev`.
- `lib/db/queries/ai-config.ts` — `getEnableMatchModelJev()`.
- `lib/view/types.ts` — `MatchModelLineView`, `MatchModelReadingView`; `MatchRowView.model?: MatchModelLineView`; `MatchHeroView = Omit<MatchRowView, "model">`.
- `lib/view/match.ts` — `toMatchRowView` aceita `modelSnapshot?: MatchModelSnapshot | null`; `toMatchHeroView` remove `model`.
- `components/match-row.tsx`, `components/upcoming-matches-desktop.tsx` — renderizam `<MatchModelLine>` quando `m.model` existe.
- `app/(app)/jogos/page.tsx` — +1 leitura batch no `Promise.all` existente (l.149), +1 arg no map.
- `app/(app)/match/[id]/page.tsx` — +1 promise (depois de `analyzable`, l.245), +1 prop em `Common`, +1 `<Suspense>` no mobile e no desktop.
- ~~`app/actions/bets.ts`~~ — **deixado pra fase do cupom (Fase 2)**: outra thread está reescrevendo o bet slip nesse arquivo. Este PR só entrega e testa o seam `getMatchModelScoreline` (§4), sem ligá-lo ao `confirmBet`.
- `vercel.json` — cron novo.

## 3. Modelo de dados (migration 0054, uma só)

### 3.1 Tabela `match_model_snapshots`

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK `defaultRandom()` | |
| `match_id` | uuid NOT NULL FK `matches.id` ON DELETE restrict | |
| `computed_at` | timestamptz NOT NULL default now() | quando ESTE resultado foi calculado |
| `checked_at` | timestamptz NOT NULL default now() | último run que recalculou e achou o mesmo fingerprint (heartbeat; único campo atualizado, sempre via `GREATEST`) |
| `model_version` | text NOT NULL | `MATCH_MODEL_VERSION` |
| `fingerprint` | text NOT NULL | sha256 hex (§3.2) |
| `lambda_source` | text NOT NULL | `dixon_coles` \| `heuristic` (Zod na leitura) |
| `lambda_degraded` | boolean NOT NULL | |
| `lambda_fallback_reason` | text NULL | `DixonColesFallbackReason`; null quando DC |
| `rho` | double precision NULL | null = `DIXON_COLES_RHO` pinado (mesma semântica de `ModelScoreline.rho` ausente) |
| `neutral` | boolean NOT NULL | `isNeutralVenue(match)` |
| `lambda_home_base`, `lambda_away_base` | double precision NOT NULL | λ do `getModelScoreline` |
| `lambda_home`, `lambda_away` | double precision NOT NULL | pós-JEV (= base sem JEV) |
| `jev_status` | text NOT NULL | `not_attempted` \| `applied` \| `failed` |
| `judgments` | jsonb NULL `$type<MatchModelJudgments>()` | null quando `not_attempted` |
| `probabilities` | jsonb NOT NULL `$type<MatchModelProbabilities>()` | |
| `top_scorelines` | jsonb NOT NULL `$type<TopScoreline[]>()` | |

Índice: `match_model_snapshots_match_computed_idx` em `(match_id, computed_at DESC)`. Sem unique em `(match_id, fingerprint)`: A→B→A é legítimo (ex.: flag liga/desliga).

Formas (pp, 0–100, 2 casas — a mesma de `selectionProbsFromMatrix`):

```ts
type MatchModelProbabilities = {
  match_result: { home: number; draw: number; away: number };
  double_chance: { home_or_draw: number; away_or_draw: number; home_or_away: number }; // Σ≈200
  btts: { yes: number; no: number };
  over_under: Record<"1.5" | "2.5" | "3.5", { over: number; under: number }>;
};
type TopScoreline = { home: number; away: number; pct: number }; // até 5, desc
// Subconjunto de PredictionJudgments com os MESMOS caminhos jsonb usados no reuso
// (applied, stateHash, versions.judgments/weights/jevModel), sem engine/lambda/narrator.
type MatchModelJudgments = {
  applied: boolean;
  answers: JudgmentAnswers | null;
  multipliers: JudgmentMultipliers | null;
  versions: { judgments: string; weights: string; jevModel: string | null; jevModelServed: string | null };
  failure: { kind: string; message: string } | null;
  stateHash: string;
  aiCallId: string | null;
  reusedFromPredictionId: string | null;
  reusedFromModelSnapshotId: string | null;
};
```

Nunca gravar o `state` nem os desfalques no snapshot (o `state` já vai pro `ai_calls.input_payload`, como no predict; minimização LGPD).

### 3.2 Fingerprint (definição exata)

`matchModelFingerprint(...) = canonicalHash({...})` sobre:

```ts
{
  modelVersion: MATCH_MODEL_VERSION,
  lambda: {
    source, degraded,
    fallbackReason: fallbackReason ?? null,
    rho: (rho ?? DIXON_COLES_RHO).toFixed(6),   // ρ EFETIVO usado na matriz (pinado quando ausente)
    neutral,
    base:     { home: lambdaHomeBase.toFixed(6), away: lambdaAwayBase.toFixed(6) },
    adjusted: { home: lambdaHome.toFixed(6),     away: lambdaAway.toFixed(6) },
  },
  jev: jevStatus === "not_attempted" ? null : {
    status: jevStatus,                 // applied | failed
    stateHash,                         // sem ele, um state novo com as mesmas respostas não
                                       // gravaria o hash novo e o reuso do predict erraria
    judgmentsVersion: JUDGMENTS_VERSION,
    weightsVersion: JUDGMENT_WEIGHTS_VERSION,
    jevModel,                          // pin (JUDGMENT_MODEL_ID) ou null em falha
  },
}
```

Fora do fingerprint: `computed_at/checked_at`, `aiCallId`, `reusedFrom*`, texto/kind da falha. As probabilidades são função pura de (λ ajustado, ρ efetivo, `MATCH_MODEL_VERSION`), então não entram. Um refit que mexe no λ na 6ª casa gera row nova (na prática: ~1 row por jogo por dia, no run das 07:30). Fingerprint igual ao da última row do jogo → só heartbeat de `checked_at`, sem insert.

### 3.3 Migration (SQL à mão sobre o gerado)

```sql
-- Base do modelo por jogo (#555, ADR 0052). IF NOT EXISTS / DO block: o DB de preview da Vercel é compartilhado entre branches.
CREATE TABLE IF NOT EXISTS "match_model_snapshots" ( ...colunas acima... );
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "match_model_snapshots" ADD CONSTRAINT "match_model_snapshots_match_id_matches_id_fk"
    FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "match_model_snapshots_match_computed_idx" ON "match_model_snapshots" ("match_id","computed_at" DESC);
--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "enable_match_model_jev" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
-- Chamadas de sistema (JEV do cron da base) não têm usuário. DROP NOT NULL é idempotente.
ALTER TABLE "ai_calls" ALTER COLUMN "user_id" DROP NOT NULL;
--> statement-breakpoint
-- Só o JEV de sistema (provider = JUDGMENT_PROVIDER_KEY) pode ficar sem usuário: um insert
-- Claude/narração sem user_id é bug e deve falhar no banco. Rows existentes têm user_id.
DO $$ BEGIN
  ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_user_id_system_only"
    CHECK ("user_id" IS NOT NULL OR "provider" = 'typesafe');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

O literal `'typesafe'` é o valor de `JUDGMENT_PROVIDER_KEY` (`lib/ai/models.ts:134`); o `check()` do `db/schema.ts` interpola a constante. Os testes pglite aplicam as migrations reais (`migrate()`), então o SQL editado é exercitado.

## 4. Funções (assinaturas)

### `lib/quant/scoreline-model.ts`
```ts
// Os n placares mais prováveis da matriz, desc por p; empate → menos gols totais, depois
// mandante menor (determinístico). n ≤ 0 → []. p = célula renormalizada (0..1).
export function topScorelines(matrix: ScorelineMatrix, n: number): { home: number; away: number; p: number }[];
```

### `lib/model-base/build-snapshot.ts` (puro)
```ts
export const MODEL_BASE_OVER_UNDER_LINES = [1.5, 2.5, 3.5] as const;
export const TOP_SCORELINES_N = 5;
export function modelProbabilities(matrix: ScorelineMatrix): MatchModelProbabilities;
  // selectionProbsFromMatrix (code-jev.ts) pra match_result, double_chance, btts e over_under×3
export type JevForSnapshot =
  | { status: "not_attempted" }
  | { status: "applied" | "failed"; run: JudgmentRun; applied: AppliedJudgments };
export function buildMatchModelSnapshot(args: {
  matchId: string; scoreline: ModelScoreline; neutral: boolean; jev: JevForSnapshot;
}): NewMatchModelSnapshot;
  // λ ajustado = applyJudgments(scoreline, run.answers) quando applied; matriz =
  // scorelineMatrix(adj.home, adj.away, { rho: scoreline.rho }) — a MESMA de runCodeJevEngine;
  // sem JEV usa scoreline.matrix. Monta judgments (MatchModelJudgments), probabilities,
  // top_scorelines (pct = round2(p*100)) e fingerprint (ρ efetivo, §3.2).
export function matchModelFingerprint(input: FingerprintInput): string;
```

### `lib/db/queries/match-model-snapshots.ts`
```ts
export type NewMatchModelSnapshot = typeof matchModelSnapshots.$inferInsert;
export async function insertMatchModelSnapshot(row: NewMatchModelSnapshot): Promise<string>;
// UPDATE ... SET checked_at = GREATEST(checked_at, $checkedAt): heartbeat monotônico
// (um run atrasado/sobreposto nunca recua o relógio).
export async function touchMatchModelSnapshot(id: string, checkedAt: Date): Promise<void>;
// Zod na leitura: row inválida → null (log), nunca derruba a página.
export async function getLatestMatchModelSnapshot(matchId: string): Promise<MatchModelSnapshot | null>;
// DISTINCT ON (match_id) ORDER BY match_id, computed_at DESC; inválidas omitidas.
export async function getLatestMatchModelSnapshotsForMatches(matchIds: string[]): Promise<Map<string, MatchModelSnapshot>>;
// Mesmos filtros jsonb do findReusableJudgments (applied, stateHash, versions.*), + checked_at ≥ since
// + jsonb_typeof(judgments->'answers') = 'object' (o JSON null em jsonb NÃO é SQL NULL).
// ORDER BY checked_at DESC LIMIT 1.
export async function findReusableSnapshotJudgments(args: {
  matchId: string; judgmentsVersion: string; weightsVersion: string; jevModel: string;
  stateHash: string; since: Date;
}): Promise<{ snapshotId: string; judgments: MatchModelJudgments } | null>;
```

### `lib/db/queries/judgments.ts`
```ts
export type ReusableJudgmentsRecord = Pick<PredictionJudgments, "answers" | "aiCallId" | "reusedFromPredictionId" | "reusedFromModelSnapshotId">
  & { versions: Pick<PredictionJudgments["versions"], "jevModel" | "jevModelServed"> };
export type ReusableJudgments = {
  predictionId: string | null;        // origem predição (como hoje)
  modelSnapshotId?: string | null;    // origem snapshot (#555); opcional p/ não quebrar o mock
  judgments: ReusableJudgmentsRecord;
};
export async function findReusableJudgments(args: {...igual..., snapshotSince?: Date}): Promise<ReusableJudgments | null>;
// 1) predições (≤ since = 6h, comportamento atual, preferida); 2) se nada, snapshot com
// checked_at ≥ snapshotSince (default since). Assinatura compatível: o único teste que
// mocka "@/lib/db/queries/judgments" é lib/ai/__tests__/predict.code-jev.test.ts; o fake
// dele (l.79-103) ganha um `snapshotStore` e o ramo de origem snapshot (§9).
```

### `lib/ai/predict.ts` (mudança mínima)
- `runJudgments({ userId: string | null, ... })`; passa `snapshotSince: now − MODEL_BASE_JEV_REUSE_WINDOW_MS (12h)`.
- Reuso: origem = quem CHAMOU o JEV. `src.reusedFromPredictionId` → essa predição; senão `src.reusedFromModelSnapshotId` → esse snapshot; senão o registro achado (`reused.predictionId` ou `reused.modelSnapshotId`). `JudgmentRun` ganha `reusedFromModelSnapshotId`; `toPredictionJudgments` grava o campo.
- Exports novos:
```ts
export const FORM_LAST = 5;
export const JUDGMENT_REUSE_WINDOW_MS = 6 * 60 * 60 * 1000;
export const MODEL_BASE_JEV_REUSE_WINDOW_MS = 12 * 60 * 60 * 1000;
export type { JudgmentRun };
/** JEV da base do modelo (#555, ADR 0052): mesmo state, reuso e log do predict, sem
 * usuário (ai_calls.user_id null, permitido só pra provider typesafe). Guarda defensiva:
 * sem TYPESAFE_API_KEY → null sem chamar nem logar (o cron já checa antes, passo 1). Nunca lança. */
export async function resolveModelBaseJudgments(args: {
  matchId: string; provider: SportsDataProvider; data: Omit<MatchJudgmentData, "previousLineups">;
}): Promise<{ input: MatchJudgmentInput; run: JudgmentRun } | null>;
```

### `lib/model-base/judgment-data.ts`
```ts
// Espelha o passo 3 do predict (mesmo FORM_LAST, mesma degradação de desfalques
// Unsupported/Transient → listas vazias). Forma/escalação que falham → lança (o caller
// pula o JEV do jogo; o state ficaria diferente do predict e o reuso erraria).
export async function fetchMatchJudgmentData(args: {
  match: DbMatch; provider: SportsDataProvider; standings: NormalizedStanding | undefined;
}): Promise<Omit<MatchJudgmentData, "previousLineups">>;
```

### Lock (`lib/sync/lock.ts`)
API atual: `acquireSyncLock(opts?: { ttlMs?: number; force?: boolean }): Promise<boolean>` e `releaseSyncLock(): Promise<void>`, chave fixa `SYNC_LOCK_KEY`, fail-open in-memory sem KV. Generalizar sem mudar o comportamento:
```ts
export async function acquireKvLock(key: string, opts?: { ttlMs?: number; force?: boolean }): Promise<boolean>;
export async function releaseKvLock(key: string): Promise<void>;
// acquireSyncLock(opts) = acquireKvLock(SYNC_LOCK_KEY, opts); releaseSyncLock() = releaseKvLock(SYNC_LOCK_KEY)
```
`COMPUTE_MATCH_MODELS_LOCK_KEY = "model-base:compute:lock"`, TTL 300 s (`SET NX EX 300`, = `maxDuration`).

### `lib/model-base/compute-match-models.ts`
```ts
export const MODEL_BASE_WINDOW_HOURS = 7 * 24;
export const JEV_WINDOW_MS = 48 * 60 * 60 * 1000;   // kickoff − now ≤ 48h
export const JEV_STALE_MS = 6 * 60 * 60 * 1000;     // prioridade na fila JEV
// Prazo pra COMEÇAR um jogo JEV. Pior caso por jogo ≈ 7 req a 8/min (~55 s) + JEV (~15 s)
// ≈ 70 s ⇒ 200 + 70 = 270 s < maxDuration 300.
export const RUN_DEADLINE_MS = 200_000;
export type ComputeMatchModelsSummary = {
  skipped?: "locked";
  jevEnabled: boolean;
  jevMissingKey: boolean;
  leagues: { league: SupportedLeague; matches: number; error: boolean }[];
  considered: number; inserted: number; unchanged: number; noModel: number; errors: number;
  jev: { queued: number; applied: number; reused: number; failed: number;
         dataUnavailable: number; skippedDeadline: number; skippedMissingKey: number };
};
// Puro: bucket 0 = sem snapshot, último snapshot sem JEV (not_attempted) ou checked_at
// mais velho que JEV_STALE_MS; bucket 1 = o resto. Dentro do bucket, kickoff asc.
export function orderJevQueue<T extends { matchId: string; kickoffAt: Date }>(
  items: T[], latestByMatch: Map<string, MatchModelSnapshot>, now: Date,
): T[];
export async function computeMatchModels(opts?: {
  now?: Date; leagues?: readonly SupportedLeague[];
}): Promise<ComputeMatchModelsSummary>;
```
Fluxo:
0. `acquireKvLock(COMPUTE_MATCH_MODELS_LOCK_KEY, { ttlMs: 300_000 })`; `false` → retorna summary zerado com `skipped: "locked"` (sem tocar em provider/DB). Corpo em `try { ... } finally { releaseKvLock(...) }` (crash no meio: o TTL libera).
1. `leagues = opts.leagues ?? getActiveLeagues()`; `jevEnabled = getEnableMatchModelJev()` (uma vez); `hasKey = hasTypeSafeKey()` (`lib/ai/providers/typesafe/client.ts:59`, uma vez); `jevMissingKey = jevEnabled && !hasKey` → um único `console.warn({ scope: "compute_match_models", event: "jev_skipped_missing_key" })` por run; `provider = getSportsDataProvider()`; `startedMs = Date.now()`.
2. Por liga (try/catch próprio; erro → `errors++`, `leagues[i].error = true`): `getMatchesInLeagueWindow({ league, fromMs, windowHours })` filtrado por `scheduled` e kickoff futuro. `standingsFor(league)` memoizado e preguiçoso (`provider.getStandings`, falha → undefined).
3. `latestByMatch = getLatestMatchModelSnapshotsForMatches(allMatchIds)` (uma leitura batch; usada na fila e na gravação).
4. Por jogo: `scoreline = getModelScoreline({ ..., standing: undefined, neutral })`; se `source !== "dixon_coles"` → refaz com `standing: await standingsFor(league)` (quota: com DC fresco não busca tabela). `null` → `noModel++`, sem row.
5. Jogo com `jevEnabled && kickoff − now ≤ JEV_WINDOW_MS`:
   - `jevMissingKey` → **não** entra na fila nem busca dados de JEV; `skippedMissingKey++`; grava com `writeBaseUnlessJev` (abaixo), `jev: not_attempted`.
   - senão → fila JEV. Fora da janela (ou flag OFF) → grava com `jev: not_attempted` (flag OFF pode rebaixar: é a intenção do kill-switch).
6. Fila JEV = `orderJevQueue(fila, latestByMatch, now)` (todas as ligas). Antes de cada jogo: `Date.now() − startedMs > RUN_DEADLINE_MS` → `skippedDeadline++` e `writeBaseUnlessJev`. Senão: `fetchMatchJudgmentData` (falha → `dataUnavailable++`, `writeBaseUnlessJev`) → `resolveModelBaseJudgments` (null → `not_attempted` via `writeBaseUnlessJev`) → `applied`/`failed`; conta `reused` quando `run.reusedFrom* !== null`.
   - `writeBaseUnlessJev`: grava a base (DC/heurístico, `not_attempted`) **a menos que** a última row do jogo tenha `jev_status ∈ {applied, failed}` (não rebaixa uma row com JEV pra uma sem JEV); em qualquer outro caso grava, pra o λ acompanhar o refit.
7. Gravação (`writeIfChanged`): `latest = latestByMatch.get(matchId)`; fingerprint igual → `touchMatchModelSnapshot(latest.id, now)` (`GREATEST`, `unchanged++`); senão `insertMatchModelSnapshot` (`inserted++`). Erro de DB num jogo → `errors++`, segue.
8. Log `{ scope: "compute_match_models", event: "run_complete", ...summary }`.

### `lib/model-base/model-scoreline.ts` (seam da Fase 2)
```ts
export const MODEL_SCORELINE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** O MESMO ModelScoreline de getModelScoreline (lib/quant/match-model.ts:26-37), lido da
 * última base do jogo: source = lambda_source, degraded = lambda_degraded, lambdaHome/Away =
 * λ AJUSTADO (lambda_home/away), rho = rho ?? (ausente), matrix = scorelineMatrix(λh, λa,
 * rho == null ? undefined : { rho }), fallbackReason = lambda_fallback_reason ?? (ausente).
 * null quando: sem snapshot; model_version ≠ MATCH_MODEL_VERSION; checked_at mais velho que
 * MODEL_SCORELINE_MAX_AGE_MS; ou o jogo já começou (kickoffAt ≤ now). Nunca lança (erro → log + null). */
export async function getMatchModelScoreline(matchId: string, now?: Date): Promise<ModelScoreline | null>;
```
Leitura via uma query nova em `match-model-snapshots.ts` (`getLatestMatchModelSnapshotWithKickoff(matchId)` → `{ snapshot, kickoffAt } | null`, join em `matches`), pra não precisar de um segundo round-trip. É o seam que a Fase 2 usa com `gradeScorelineLeg`/`computeSlipJoint` (`lib/bets/grade-scoreline.ts`).

**`app/actions/bets.ts`: deixado pra fase do cupom** (outra thread reescreve o bet slip nesse arquivo; este PR não o toca). O texto abaixo descreve a ligação que a Fase 2 faz (mudança de ~4 linhas, dentro do `model()` memoizado de `confirmBet`, l.584–602): `const fromBase = await getMatchModelScoreline(match.id); if (fromBase) return fromBase;` e só então o caminho atual (`getStandings` + `getModelScoreline`). Atualizar o comentário do passo 7 e o de `LegContext.model` (l.274). Não há teste de `confirmBet` hoje (os testes de `lib/bets/` não importam a action), então nada existente quebra; a cobertura vem do teste unitário do rebuild (§9). Efeito intencional (registrar no ADR): com base fresca, o CAMINHO B do cupom passa a usar o λ **pós-JEV** — o mesmo que a "Leitura do modelo" mostra. Se na implementação a mudança crescer além disso (ex.: precisar de mock novo em teste existente), deixar `bets.ts` intocado e registrar como próximo passo da Fase 2.

### Cron `app/api/cron/compute-match-models/route.ts`
`runtime = "nodejs"`, `dynamic = "force-dynamic"`, `maxDuration = 300`, `isAuthorizedCron(request, "compute_match_models")` → 401. `{ ok: summary.errors === 0, summary }` com 200/500 (como o refit, pro monitor do Sentry); `summary.skipped === "locked"` → 200 `ok: true`; throw → 500 `{ ok: false, error: "compute_match_models_failed" }`. `JEV failed/skippedDeadline/skippedMissingKey` não é erro (fail-open, esperado sob carga). `vercel.json`: `{ "path": "/api/cron/compute-match-models", "schedule": "30 1,7,13,19 * * *" }`. Sem chamada no fim do refit (sem acoplamento).

### Flag
- `db/schema.ts`: `enableMatchModelJev: boolean().notNull().default(true)`.
- `getEnableMatchModelJev()` (padrão de `getEnableParallelFanOut`, l.261, `?? true`).
- `ADMIN_FLAGS`: `{ key: "enableMatchModelJev", kind: "boolean", label: "Pré-previsão com JEV", description: "A base do modelo de cada jogo (recalculada a cada 6h, sem Claude) ajusta os gols esperados com os julgamentos JEV nos jogos a até 48h do início, e o \"Analisar com IA\" reaproveita essas respostas. Desligada, a base usa só o Dixon-Coles (ou o heurístico da tabela).", default: true, costNote: "~US$ 0,0001 de JEV por jogo quando desfalques/tabela mudam; 4–7 chamadas de API-Football por jogo na janela de 48h. Sem The Odds API e sem Claude." }`.

### `ai_calls.user_id` nullable
- `persistJudgmentAiCall({ userId: string | null, ... })` (as outras inserções seguem passando string; o CHECK garante no banco).
- `getCostByUser`: `.leftJoin(users, eq(aiCalls.userId, users.id))`, group by `aiCalls.userId, users.email`; `CostByUser = { userId: string | null; email: string | null; ... }`. Docstring atualizado (não é mais "toda row tem usuário"). Totais de `getCostSummary`/`getCostByDay`/`getCostByModel`/spend-alert já somam todas as rows — o custo do sistema entra sozinho.
- `/admin/costs` (`app/(app)/admin/costs/page.tsx`): rótulo "sistema" pra `userId === null`.

## 5. UI

### `/jogos`
- `toMatchRowView({..., modelSnapshot })` → `model?: MatchModelLineView` **só quando analisável** (agendado e antes do apito) e há snapshot. `MatchModelLineView = { favorite: { label: string; pct: string }; goals25: { label: string; pct: string } }`. Favorito = argmax do 1X2 (empate de pp → ordem casa, empate, fora). `goals25` = o lado **mais provável** do over/under 2.5 (empate de pp → Over), ex.: "Under 2.5 55%". Labels de `getMarketPresentation(...).outcomeLabel` ("Casa", "Over 2.5"/"Under 2.5"); pct inteiro ("52%").
- `components/match-model-line.tsx`: `Modelo · Casa 52% · Under 2.5 55%` em `font-mono text-eyebrow text-muted-fg-2`. Mobile: linha extra no fim da `MatchRow`, só com `m.model` (goldens sem `model` ficam byte-idênticos). Desktop: abaixo dos nomes na coluna "jogo". Nada de "valor"/"edge"/"odd" na linha.
- `app/(app)/jogos/page.tsx`: `getLatestMatchModelSnapshotsForMatches(matchIds)` no `Promise.all` que já lê odds e predições (l.149); passa `modelSnapshot: modelByMatch.get(m.id) ?? null`.

### Página do jogo
- `lib/model-base/reading.ts`:
```ts
export async function loadMatchModelReading(args: {
  match: DbMatch; oddsSettled: Promise<unknown>; now: Date; timeZone?: string;
}): Promise<MatchModelReadingView | null>;
```
  Lê o snapshot (erro ou sem snapshot → null). **Espera a mesma `oddsP` da página** com `await args.oddsSettled.catch(() => {})` (uma `oddsP` rejeitada nunca rejeita o loader) e só então lê do DB, best-effort **por mercado** (try/catch em volta de cada `getLatestSelectionOddsSnapshotsForMatches([id], key, params?)` pra match_result, double_chance, btts e over_under 1.5/2.5/3.5): mercado que falha → log e sem odd/edge naquele mercado, probabilidades/odd justa seguem. Odd só conta se a captura tem idade < `oddsFreshnessMsForKickoff(kickoff, now)`. **Nenhuma** chamada a `ensureOddsSnapshotsFresh`/provider de odds.
- `toMatchModelReadingView` (`lib/view/match-model.ts`, puro): por mercado, por seleção: `pct` ("52.3%"), `fairOdd` (`formatOdd(100/p)`, "—" se p ≤ 0), e com odd fresca e completa `odd` + `edge` via `computeMarketScenarios({ selections, recommendedKey: null, impliedSumTarget: getDescriptor(key)?.impliedSumTarget })` (de-vig ali; dupla chance com alvo 2) formatado por `formatEdge`. Top placares "1–0 · 12%". Rodapé: fonte (`Dixon-Coles` | `heurístico da tabela (<motivo>)` com motivos PT: flag_off "Dixon-Coles desligado", no_fit "liga sem ajuste", stale_fit "ajuste desatualizado", team_missing "time sem histórico", few_matches "pouco histórico", error "erro nos ratings"; `· dados limitados` quando `degraded`), `+ JEV` (applied) | `JEV falhou` (failed) | nada, e `atualizado há X` (`formatRelativeAgo(checkedAt)`).
- `components/match-model-reading.tsx`: Card no estilo do `OddsCard` (header "Leitura do modelo", `HelpHint` explicando odd justa = 100/probabilidade e edge = modelo − implícita sem a margem da casa). Estado vazio (null): "A leitura do modelo aparece aqui quando o cálculo do jogo rodar (a cada 6h, até 7 dias antes do jogo)."
- `app/(app)/match/[id]/page.tsx`: `const modelReadingP = analyzable ? loadMatchModelReading({ match, oddsSettled: oddsP, now, timeZone }) : null` criada **logo depois de `analyzable`** (l.245; `oddsP` já existe desde l.116); `Common.modelReading: Promise<MatchModelReadingView | null> | null`; mobile: novo `<div className="flex flex-col gap-3"><Suspense fallback={<MatchModelReadingSkeleton/>}><MatchModelReading reading={modelReading}/></Suspense></div>` logo depois do bloco `data-tour="odds"`; desktop: o mesmo, full-width (`mb-6`), logo depois do grid de odds. **Fora** de `MatchHero`/`PalpiteHero` (firewall ADR 0030). Jogo não analisável (ao vivo, encerrado, adiado) → nada renderiza (decidido; "o que o modelo dizia" fica pra depois).
- Firewall no tipo: `MatchHeroView = Omit<MatchRowView, "model">`; `toMatchHeroView` faz `const { model: _model, ...hero } = toMatchRowView(args); return hero;` (mesmo se alguém passar `modelSnapshot`).

## 6. ADR 0052 (formato do 0051: Status / Contexto / Decisão / Consequências / Referências, PT-BR)
Decisão: (1) base compartilhada por jogo em `match_model_snapshots`, sem Claude e sem The Odds API; (2) λ de `getModelScoreline` (DC com fallback heurístico); (3) JEV só a ≤48h, atrás de `enable_match_model_jev` (default ON), mesma porta/log do predict, reuso por `stateHash` nos dois sentidos (predições ↔ snapshots), fail-open, sem chave TypeSafe = não tenta (um warn por run); (4) probabilidades 1X2/dupla chance/BTTS/gols 1.5–3.5 + top 5 placares, em pp; (5) edge **não** é gravado, é calculado na leitura contra a odd mais recente (`computeMarketScenarios`); (6) row nova só quando o fingerprint muda; `checked_at` é heartbeat monotônico (`GREATEST`), único UPDATE da tabela; reuso de snapshot por 12h sobre `checked_at`; (7) `ai_calls.user_id` nullable só pra chamadas de sistema TypeSafe (CHECK no banco; "sistema" no /admin/costs); (8) **rota de cron própria** em vez de pendurar no refit/sync-fixtures: precisa da agenda dela (`30 1,7,13,19 * * *`, 30 min depois do refit das 07:00) e do orçamento inteiro de `maxDuration = 300` (o throttle da API-Football consome ~55 s por jogo JEV; somado ao refit ou ao sync estouraria o tempo e acoplaria falhas), com lock KV próprio contra runs sobrepostos; (9) Fases 2 (cupom, via `getMatchModelScoreline`) e 3 (palpite do usuário) leem desta base; a ligação do cupom ao seam fica pra fase do cupom (λ pós-JEV quando a base está fresca, fallback no cálculo ao vivo). Consequências: + análise depois da base não paga JEV; + cupom não busca tabela/ratings quando há base; − throughput limitado pelo throttle da API-Football (~4–6 jogos com JEV por run, fila priorizada); − tabela cresce ~1 row/jogo/dia (sem retenção nesta fase).

## 7. Ordem de execução
1. ADR 0052.
2. `db/schema.ts` + `pnpm db:generate --name match_model_snapshots` + edição do SQL (§3.3).
3. Puro: `topScorelines`, `canonicalHash`, `lib/model-base/{version,types,build-snapshot}.ts` + testes.
4. Queries: `match-model-snapshots.ts`, extensão de `judgments.ts` + pglite.
5. `ai_calls` nullable + CHECK: logging, ai-costs (+teste), página de custos, teste pglite do CHECK.
6. Flag: registry, getter, testes.
7. `predict.ts` (reuso com origem snapshot, wrapper, exports) + `engine/types.ts` + testes code-jev (fake com ramo snapshot).
8. Lock genérico (`lib/sync/lock.ts`) + teste.
9. `judgment-data.ts`, `compute-match-models.ts` (+ `orderJevQueue`) + pglite (inclui paridade cron → predict).
10. Rota do cron + teste + `vercel.json`.
11. `model-scoreline.ts` (seam) + teste (`app/actions/bets.ts` fica pra fase do cupom).
12. View (`types`, `match.ts`, `match-model.ts`) + testes.
13. `reading.ts` + teste; componentes + edições nas páginas + testes.
14. `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## 8. Commits sugeridos
`docs(adr): 0052 base do modelo por jogo` · `feat(db): match_model_snapshots, flag JEV da base e ai_calls.user_id nullable (só sistema)` · `feat(model-base): cálculo da base por jogo + cron` · `feat(jev): predict reusa respostas JEV da base` · `feat(ui): leitura do modelo no /jogos e na página do jogo`. Sem bump de prompt (nenhum prompt muda).

## 9. Testes
- `lib/quant/__tests__/scoreline-model.test.ts` (+): `topScorelines` ordena desc; respeita n; desempate determinístico; n > células; n ≤ 0 → []; λ simétricos → 1-1/0-0 no topo plausível.
- `lib/model-base/__tests__/build-snapshot.test.ts`: probabilidades = `p1X2`/`pOverUnder`/`pBtts` da mesma matriz (2 casas); dupla chance = somas; com JEV aplicado as probabilidades de 1X2 batem com `runCodeJevEngine(...).modelProbByKey` pro mesmo scoreline+answers; DC usa o ρ do fit; fingerprint estável (ordem de chaves), muda com λ na 6ª casa, com `stateHash`, com `MATCH_MODEL_VERSION`, com jevStatus; **`rho` ausente e `rho = DIXON_COLES_RHO` dão o mesmo fingerprint**, ρ diferente muda; não muda com `aiCallId`/`reusedFrom*`.
- `lib/model-base/__tests__/model-scoreline.test.ts`: rebuild de um snapshot DC (ρ do fit) e de um heurístico (ρ null) → `matrix` igual (deep equal) a `scorelineMatrix` do λ/ρ gravados, `source/degraded/fallbackReason/rho` mapeados (ausentes quando null); null sem snapshot, com `checked_at` > 24h, com kickoff passado, com `model_version` diferente; erro de query → null.
- `lib/model-base/__tests__/compute-match-models.test.ts` (unit, puro): `orderJevQueue` — jogo sem snapshot / `not_attempted` / `checked_at` > 6h vem antes de jogo com JEV fresco mesmo com kickoff posterior; dentro de cada bucket, kickoff asc.
- `lib/model-base/__tests__/reading.test.ts`: spies em `ensureOddsSnapshotsFresh` e no provider de odds → **nunca** chamados; `oddsSettled` rejeitada → loader resolve normalmente; um mercado cujo `getLatestSelectionOddsSnapshotsForMatches` lança → esse mercado sem odd/edge, os outros com, probabilidades de todos presentes; sem snapshot / erro no snapshot → null.
- `lib/db/queries/__tests__/match-model-snapshots.pglite.test.ts`: insert/latest/batch (DISTINCT ON, pega a mais recente por jogo); row com jsonb inválido omitida; `touch` só mexe em `checked_at` e não recua (`GREATEST`: touch com data antiga mantém a nova); `findReusableSnapshotJudgments` filtra applied/hash/versões/janela em `checked_at`, ignora `answers` JSON null, e com duas candidatas devolve a de `checked_at` mais recente; `getLatestMatchModelSnapshotWithKickoff` traz o kickoff.
- `lib/db/queries/__tests__/ai-calls-system-user.pglite.test.ts`: insert em `ai_calls` com `user_id` null e `provider = 'anthropic'` **falha** (CHECK); com `provider = JUDGMENT_PROVIDER_KEY` passa.
- `lib/db/queries/__tests__/find-reusable-judgments.pglite.test.ts` (+): sem predição → acha snapshot (`predictionId: null`, `modelSnapshotId`); com os dois → predição.
- `lib/ai/__tests__/predict.code-jev.test.ts` (+): o fake de `findReusableJudgments` (l.79-103) ganha um `snapshotStore` e o ramo "sem predição → snapshot com `checkedAt ≥ snapshotSince ?? since`" (devolve `{ predictionId: null, modelSnapshotId, judgments }`); casos: origem snapshot → JEV não é chamado; `judgments.reusedFromModelSnapshotId = "snap-1"`, `reusedFromPredictionId = null`, `aiCallId` herdado; snapshot que já era reuso de predição → aponta pra predição de origem.
- `lib/ai/__tests__/ai-call-logging.test.ts` (+): `userId: null` grava null.
- `lib/db/queries/__tests__/ai-costs.test.ts`: stub ganha `leftJoin`; `getCostByUser` usa leftJoin e mapeia `userId/email` null.
- `lib/config/__tests__/admin-flags.test.ts`, `lib/db/queries/__tests__/admin-flags.pglite.test.ts`: chave nova, default true, getter mapeado; copy sem "IA" solto (diz "sem Claude").
- `lib/sync/__tests__/lock.test.ts` (+): `acquireKvLock` com duas chaves diferentes não colidem; segunda aquisição da mesma chave → false; `releaseKvLock(key)` libera; wrappers do sync inalterados.
- `lib/model-base/__tests__/compute-match-models.pglite.test.ts` (Postgres real; mocks em `getSportsDataProvider`/`__setSportsDataProviderForTesting`, `@/lib/providers/absences`, `@/lib/ai/judgments/provider`, `@/lib/ai/providers/typesafe/client`): fit + ratings semeados → `dixon_coles` e **sem** `getStandings`; sem fit → `heuristic` + `fallbackReason: "no_fit"`; jogo a +72h → JEV não chamado; flag OFF (+24h) → não chamado, `not_attempted`; flag ON (+24h) → judgments gravados e row em `ai_calls` com `user_id` null; 2º run igual → nenhuma row nova, `checked_at` avança, JEV reusado do snapshot (provider chamado 1×); predição semeada com o mesmo hash → JEV não chamado; **sem chave** (`hasTypeSafeKey` → false) → nenhuma busca de forma/escalação/desfalque, `not_attempted`, nenhum `ai_calls`, `console.warn` com `jev_skipped_missing_key` exatamente 1× com 2 jogos na janela; jogo `live`/`finished`/passado ignorado; **prazo estourado** (`Date.now` spy, como no refit) → jogo da fila sem snapshot ou com row `not_attempted` ganha base nova (λ do refit), jogo com última row `applied`/`failed` fica intocado; **lock ocupado** → summary `skipped: "locked"`, provider não chamado; liga que lança não derruba as outras; **paridade cron → predict**: roda `computeMatchModels` (+24h, flag ON), depois `predict` em `code_jev` pro mesmo jogo com os MESMOS mocks de provider/desfalques → o judge (TypeSafe) foi chamado **1×** no total e `prediction.judgments.reusedFromModelSnapshotId` = id do snapshot.
- `app/api/cron/compute-match-models/__tests__/route.test.ts`: 401 sem secret; 200 com summary; 200 `ok: true` com `skipped: "locked"`; 500 com `errors > 0`; 500 quando lança.
- `lib/view/__tests__/match-model.test.ts`: favorito (inclusive empate de pp); `goals25` mostra Over quando over > under, **Under** quando under > over ("Under 2.5 55%"), Over no empate; reading: odd justa, edge só com odd fresca e completa (stale → sem edge), dupla chance com alvo 2 bate com `computeMarketScenarios`, rótulos de fonte por motivo, JEV aplicado/falhou, "atualizado há".
- `lib/view/__tests__/match.test.tsx` (+): com snapshot e analisável → `model`; não analisável ou sem snapshot → `undefined`; **`toMatchHeroView` com `modelSnapshot` → `"model" in hero === false`**.
- `components/__tests__/match-model-reading.test.tsx`: probabilidades, placares, rodapé, estado vazio.
- `components/__tests__/upcoming-matches.test.tsx` (+): linha "Modelo" aparece só com `model`; sem "edge"/"valor"/"odd" no texto. Goldens e `palpite-hero.test.tsx` passam sem mudança.

## 10. Riscos / landmines
1. **Throttle da API-Football** (8/min): o cron cobre ~4–6 jogos com JEV por run. Fila priorizada (sem JEV / velho primeiro, depois kickoff) e prazo de 200 s; o resto entra no próximo run. Subir o throttle (o plano é Pro) é outra issue.
2. **Paridade do `stateHash`** cron × predict: as duas pontas passam por `resolveMatchJudgments` com o mesmo `FORM_LAST` e a mesma degradação de desfalques; o teste de paridade (§9) trava isso. Escalação/desfalques que mudam entre o cron e a análise mudam o hash: o predict paga JEV de novo (custo, não erro).
3. **Odds API**: o loader da leitura não pode chamar `ensureOddsSnapshotsFresh` nem provider de odds. `reading.test.ts` com spy garante.
4. **Join com `users`**: qualquer query futura que fizer `innerJoin(users)` em `ai_calls` perde as rows de sistema. Docstring e teste do `getCostByUser` deixam isso explícito; o CHECK limita as rows sem usuário ao JEV de sistema.
5. **Preview DB compartilhado**: `IF NOT EXISTS` + DO block na FK e no CHECK; `DROP NOT NULL` idempotente.
6. **`checked_at` mutável** (decidido): a tabela é append-only no conteúdo, e o heartbeat `GREATEST` é o único UPDATE (documentado no ADR).
7. **Firewall ADR 0030**: `MatchHeroView = Omit<MatchRowView, "model">` e `toMatchHeroView` remove o campo; teste trava. Linguagem de valor só no bloco "Leitura do modelo", nunca no hero nem no /jogos.
8. **Jsonb inválido**: Zod na leitura, row omitida e log; a página nunca cai.
9. **Runs sobrepostos** (cron + invocação manual/retry): lock KV `SET NX EX 300`; o perdedor sai com `skipped: "locked"`. Sem KV (dev/test) o lock é in-memory por processo (fail-open, como o sync). Se ainda assim duas rows iguais entrarem, é inofensivo (sem unique por causa de A→B→A).
10. **Mock de `@/lib/db/queries/judgments`**: só `lib/ai/__tests__/predict.code-jev.test.ts` mocka; o fake precisa do ramo snapshot (§9). A assinatura de `findReusableJudgments` é mantida e o campo novo é opcional.
11. **Copa do Mundo**: o DC exclui a Copa, então a base sai no heurístico (esperado).
12. **Cupom com λ pós-JEV** (quando a fase do cupom ligar o seam): `confirmBet` passa a precificar o CAMINHO B com a base (pós-JEV quando aplicada). É a coerência desejada com a "Leitura do modelo"; base ausente/velha (>24h) ou jogo começado → cálculo ao vivo de hoje.

## 11. Decisões (fechadas pelo lead)
- Agenda `30 1,7,13,19 * * *`, em rota de cron própria (ADR 0052 item 8).
- `checked_at` mutável (heartbeat `GREATEST`) + janela de 12h sobre `checked_at` pro reuso com origem snapshot (as predições continuam com 6h sobre `created_at`).
- "Nenhuma chamada LLM nova" = nenhuma chamada nova a **Claude**; o JEV (TypeSafe) do cron fica atrás do flag `enableMatchModelJev`.
- Sem chave TypeSafe, o cron não busca dados nem tenta o JEV; um `warn` por run.
- Leitura do modelo só em jogo analisável; ao vivo e encerrado ficam fora.

## 12. Fora de escopo
Cupom de apostas além do seam + troca do `model()` em `confirmBet` (Fase 2: UI/fluxo do cupom); análise do palpite do usuário / contexto extra (Fase 3); de-vig de Shin e mistura com mercado; o predict usar o λ/probabilidades da base (ele só reusa as respostas JEV); retenção/limpeza de snapshots; tela de admin dos snapshots e botão "recalcular agora"; backtest/calibração da base; leitura em jogo ao vivo/encerrado; subir o throttle da API-Football; copy de glossário/como-funciona; qualquer chamada nova à The Odds API.
