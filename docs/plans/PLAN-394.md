# PLAN-394 — Liquidação web-grounded de cartões (settlement)

> Plano de build cacheado (design-workflow 2026-06-20, reshape-then-proceed). Liquida o tipo `cards` que o **#419 já emite** (fun-only). Aterrado no worktree fresco (pós-#419 merge). Bloqueado por NADA agora (#419 mergeado). Próxima sessão: build direto deste plano.

## Sanity-check

**Verdict:** reshape

The skeleton is correct and the seam reuse is genuinely sound (runAnalysis, no SDK, no new provider, Haiku, hasKey-gated, ai_calls-logged, double-inert), but four cross-review BLOCKERS make the DRAFT unbuildable as written and must reshape it before code:

(B1, raised by ALL FOUR reviewers) The card COUNT cannot come through the #377 firewall the draft claims to copy. `runServerToolAnalysis` hard-sets `toolInput: undefined` (anthropic/index.ts:205, confirmed) and `tool_choice:auto` (request-builder.ts:76) — there is NO structured submit channel. `extractSources` (anthropic-web-search.ts:65-93, the firewall) walks ONLY `web_search_tool_result` blocks and captures ONLY `{title,url}` — a number is structurally absent. So the count can ONLY come from the model's free PROSE text block in `contentBlocks`. That is acceptable here (a settlement card count is a FACT, not an EV/odd value-claim, so the ADR 0030/0032 value-language firewall does not apply) — but it must be EXPLICITLY sanctioned in the addendum, NOT hidden inside 'copy lines 95-220', and the parse must be defensive (Zod a single integer; any ambiguity → null → PENDING). Consequently the per-source `{origin,count}` requirement is mechanically UNDERIVABLE (URLs have no count; the one prose number has no per-URL link), so the '≥2 origins carrying the SAME number' guardrail MUST be downgraded to what is buildable: A.count===B.count across DISJOINT BR/INTL pools AND each pool returned ≥1 real source AND the union of distinct collapsed origins ≥2. A≡B on cards is OUTLET-decorrelated, not SOURCE-decorrelated (one official match-sheet upstream) → it is agreement, not independent corroboration; the real protection is skip-on-disagreement + manual override + attempt-cap, and the addendum must say so plainly rather than oversell A≡B.

(B2, gate-inert review) `ai_calls.userId` AND `ai_calls.matchId` are notNull + onDelete:restrict (schema.ts:257-262, confirmed) and the seam REQUIRES `audit.{userId,matchId}` (anthropic-web-search.ts:95-98,131-148,185-202). The cron is unattended — no requesting user. The draft's 'log each read ai_calls' would hit a NOT-NULL violation. RESOLVED WITHOUT a migration: the pending query joins `palpiteSets` (userId is already used in its notExists) but does not SELECT it — add `userId: palpiteSets.userId` to the select so each extraction logs to ai_calls under the palpite OWNER's id (matchId already on the row). No nullable-column migration, no sentinel user.

(GATE-INERT, the central question) Adding 'cards' to SETTLEABLE_PALPITE_TYPES does NOT flip existing #419 fun-only rows settleable, because every existing cards row PERSISTED `settleable=false` (deriveSettleable('cards') was false at write time, settleable-rows.ts:70) and the pending query is a DOUBLE gate `inArray(type,…) AND settleable=true` (palpites.ts:286-287) — existing rows fail the second predicate. SAFE, but ONLY if the plan ships NO backfill of `settleable` on old rows (made an explicit guardrail). NEW rows written post-deploy get settleable=true and pass BOTH SQL gates; their inertness rests ENTIRELY on `isCardsCovered(p.league)` (empty set) — which MUST gate the WEB FAN-OUT loop BEFORE any paid call, not just the per-row settle loop, or an empty set could leak spend in the wrong order. deriveSettleable stays league-BLIND (it only sees type); coverage is the orthogonal league-axis gate at deriveSettleable's downstream, i.e. in the orchestrator.

(B3, attempt-cap) The cron is all-or-nothing + Vercel-retried with no transaction. A sidecar `palpite_settlement_attempts` table (migration 0040, next free; KV rejected — TTL silently resets the cap and re-spends) is correct, but the increment must fire FIRST — before the paid call, unconditionally, even on A≠B/null — and the fan-out must be gated on `attempts < CAP`, or the cap is leaky/dead. This is the ONE migration; the draft's 'No migration' headline is self-contradictory and must own it.

Everything else (pure rule purity, idempotency via onConflictDoNothing, type-forcing-function via the Record exhaustiveness, no enum/result_data migration) is verified sound. Proceeding after these reshapes; the value is real (closes the Copa cards fun-only gap) and inert-at-first by construction.

## Plano file-by-file

### 1. `lib/ai/palpites/settleable.ts`
**Change:** Append "cards" to SETTLEABLE_PALPITE_TYPES (after first_to_score, line 15-21). This single edit is the forcing function: it (a) makes deriveSettleable('cards')=true for NEW rows, (b) widens the SQL pending predicate via inArray(palpites.type, SETTLEABLE_PALPITE_TYPES) (palpites.ts:286), and (c) widens SettleablePalpiteType (line 25), which breaks Record<SettleablePalpiteType, PalpiteRuleFn> compile until the cards rule is registered. Leave red_card/corners OUT (comment at 6-7 stays).

**Why:** Single source of truth driving both gates + the exhaustiveness compile-guard. Existing #419 rows are NOT flipped: they persisted settleable=false and the double SQL gate (inArray AND settleable=true, palpites.ts:286-287) excludes them. Coverage (empty set) holds the NEW rows inert.

### 2. `lib/settlement/rules/cards_palpite.ts`
**Change:** NEW pure rule mirroring first_to_score_palpite.ts. Zod params = z.object({ line: z.union([z.literal(4), z.literal(6)]), scope: z.literal("total") }) — pin line to the actual CARDS_LINE rungs {4,6} (settleable-rows.ts:47), not min(1), so a corrupt params can't liquidate against a nonsense line. Signature (params: unknown, resultData: PalpiteResultData) => 'won'|'lost'. safeParse fail → throw SettlementError. If resultData.yellowCardsTotal === undefined → throw SettlementError('cards settlement needs yellowCardsTotal → leave pending'). Else return yellowCardsTotal >= line ? 'won' : 'lost'. PURE: no I/O, no A/B logic.

**Why:** skip-not-fabricate at the rule boundary: undefined count → throw → caught at settle-palpites.ts (errors++), no outcome row, re-enters pending next tick. NEVER fabricates. The A≡B/origins/decorrelation lives in orchestration, never the rule (same boundary as first_to_score).

### 3. `db/schema.ts`
**Change:** Add optional `yellowCardsTotal?: number;` to the PalpiteResultData type (after firstToScore/eventsAvailable, ~line 521). PIN THIS EXACT NAME `yellowCardsTotal` everywhere (schema type, builder/orchestrator setter, rule reader, tests) — the draft's `yellowCards` and the various explore names (`yellowCards`/`cardsTotal`/`totalYellowCards`) are a 4-way drift that would silently read undefined → eternal PENDING masquerading as 'inert'. jsonb $type only — NO migration. params union for cards ({line, scope:'total'}) already shipped at schema.ts:490.

**Why:** Type-only widening of the jsonb result shape (same pattern as firstToScore for #354). One canonical field name kills the silent-drift class.

### 4. `lib/providers/news/allowed-domains.ts`
**Change:** Add two NEW exported disjoint constants for the decorrelated A/B partition: CARD_DOMAINS_BR = the BR half (ge.globo.com, espn.com.br, lance.com.br, uol.com.br, cnnbrasil.com.br, gazetaesportiva.com) and CARD_DOMAINS_INTL = the international half (bbc.com, theguardian.com, reuters.com, espn.com, goal.com). Leave the flat ALLOWED_DOMAINS untouched (news still uses it). Partitions flow into web_search allowed_domains (request-builder.ts:67-69), confirmed genuinely disjoint search pools.

**Why:** Decorrelation on a REAL axis (distinct source pools), not byte-identical clones. A=BR, B=INTL physically search different sets.

### 5. `lib/settlement/cards-coverage.ts`
**Change:** NEW leaf module: export const CARDS_COVERED_LEAGUES = new Set<SupportedLeague>([]) (EMPTY = fully inert) and export function isCardsCovered(league: SupportedLeague): boolean { return CARDS_COVERED_LEAGUES.has(league); }. Precedent: COVERED_LEAGUES_BY_MARKET fail-closed (market-catalog.ts:166-195). Empty set ⇒ every cards row fails ⇒ zero fan-out, zero spend, zero badge. Kept OUT of the league-blind settleable.ts.

**Why:** The league-axis gate that holds NEW (settleable=true) cards rows inert until a web source is empirically proven per league. Orthogonal to deriveSettleable (which only sees type).

### 6. `lib/settlement/origin-collapse.ts`
**Change:** NEW pure module: hostToOrigin(url: string): string|null. Hardcoded eTLD+1 + editorial-identity alias table for the ~11 curated domains (NOT naive split('.').slice(-2), which collapses espn.com.br → 'com.br' public suffix). Map: ge.globo.com & any *.globo.com → 'globo'; espn.com & espn.com.br → 'espn'; cnnbrasil.com.br → 'cnnbrasil' (do NOT silently merge into uol even though UOL-syndicated — under-collapse is the safe direction for a settlement gate; document the known syndication caveat). uol.com.br → 'uol'; lance.com.br → 'lance'; gazetaesportiva.com → 'gazeta'; bbc.com → 'bbc'; theguardian.com → 'guardian'; reuters.com → 'reuters'; goal.com → 'goal'. Unknown host → null (excluded from origin count). Unit-tested: espn.com vs espn.com.br → 1 origin; ge.globo.com vs globoesporte.globo → 1; espn.com.br vs uol.com.br → 2.

**Why:** The ≥2-distinct-origin guardrail's CORRECTNESS CORE. The draft hand-waved 'collapse host to origin' into the extractor; it is its own pinned, tested unit. eTLD+1 trap + ESPN cross-cctld identity are real bugs if unspecified.

### 7. `lib/settlement/extract-cards-from-web.ts`
**Change:** NEW settlement-time extractor copying the SKELETON of anthropic-web-search.ts (NOT predict(), NO @anthropic-ai/sdk import). One read = getProviderForModel(MODEL_REGISTRY['claude-haiku-4-5']); hasKey() gate FIRST (no key → return null, log provider_error via persistAiCallError, ZERO spend); build AnalysisRequest with serverTool:{kind:'web_search', allowedDomains, maxUses:1}; await provider.runAnalysis(req); log each read to ai_calls under audit={userId, matchId} (passed in from the pending row — see settle-palpites change). promptVersion 'cards_extract_v1'. COUNT CHANNEL (B1, explicit): runServerToolAnalysis returns toolInput:undefined + tool_choice:auto (no forced submit) → the count is parsed from the model's final TEXT block in result.contentBlocks (model PROSE, grounded by server-side search but NOT firewall-protected — sanctioned because a card count is a settlement FACT, not an EV/value claim). Parse DEFENSIVELY: Zod a single non-negative integer; multiple/zero/ambiguous → null. Origins come from extractSources {title,url} → hostToOrigin → distinct set. Export extractCardCount(ref, {userId, matchId}): runs TWICE — readA with CARD_DOMAINS_BR, readB with CARD_DOMAINS_INTL — and RECONCILES: return the count ONLY if readA.count!=null AND readB.count!=null AND readA.count===readB.count AND each read returned ≥1 real source AND union of distinct collapsed origins across both reads ≥2; otherwise return null (→ PENDING). Each read logs its own ai_calls row.

**Why:** Reuses the #377 seam exactly (no new provider/SDK, double-inert via hasKey+coverage). Owns the count-channel reality (prose, defensive parse) and the BUILDABLE reconciliation (A===B over disjoint pools + ≥2 origins) instead of the unbuildable per-source {origin,count}.

### 8. `lib/settlement/rules/palpite-dispatch.ts`
**Change:** Add `cards: settleCardsPalpite` to PALPITE_SETTLEMENT_RULES (+ import). Add NEW export const WEB_GROUNDED_PALPITE_TYPES = new Set<SettleablePalpiteType>(['cards']) next to EVENT_BACKED_PALPITE_TYPES (line 33). Add an import-time invariant assertion that EVENT_BACKED ∩ WEB_GROUNDED === ∅ (throw on overlap) so a future type added to both can't silently double-fetch (api-football credit + web-search fee). cards must NOT join EVENT_BACKED (it has no /fixtures/events path).

**Why:** Registry entry satisfies the Record exhaustiveness compile-guard. WEB_GROUNDED routes the new web fan-out, disjoint from the event-backed one — enforced at IMPORT, not just a test a contributor might skip.

### 9. `lib/db/queries/palpites.ts`
**Change:** In getPendingPalpiteSettlements: add `userId: palpiteSets.userId` to the select (palpiteSets is already joined and its userId is already used in the notExists subquery) and add `userId: string` to the PendingPalpiteSettlement type. NO league predicate change (league already selected at :275). NO settleable backfill anywhere.

**Why:** RESOLVES gate-inert BLOCKER 2: ai_calls.userId/matchId are notNull+restrict and the cron has no requesting user — the extraction logs under the palpite OWNER's id (matchId already on the row). No nullable migration, no sentinel user. The 'NO backfill' is the guardrail that keeps existing #419 rows inert.

### 10. `lib/settlement/settle-palpites.ts`
**Change:** Add a SECOND per-match fan-out loop (sibling of the EVENT_BACKED loop at 103-122) that builds `cardsByMatch = new Map<string, number|null>()`. GATE THE FETCH (spend control) at the TOP of this loop, BEFORE building any request: `if (!WEB_GROUNDED_PALPITE_TYPES.has(p.type)) continue; if (!isCardsCovered(p.league)) continue; if (await attemptsExceedCap(p.palpiteId)) continue; if (cardsByMatch.has(p.matchId)) continue;` then INCREMENT THE ATTEMPT FIRST (before the paid call, unconditionally) and call extractCardCount(ref, {userId: p.userId, matchId: p.matchId}); store the reconciled number-or-null. Three-state Map discipline (undefined=not tried, null=A≠B/failed, number=reconciled). In the per-row settle loop: keep the existing finished/regulationScore skip FIRST (a final card count also requires a finished match). For cards rows, build resultData from the score then set yellowCardsTotal in the ORCHESTRATOR only on the reconciled-non-null path (do NOT thread cardsTotal through palpiteResultDataFrom — keep that builder goal-derived-only). null/undefined → the pure rule throws → PENDING. Defense-in-depth: also re-check isCardsCovered in the settle loop (skip if uncovered).

**Why:** Orchestration. Coverage gates the FETCH (zero spend with empty set, regardless of hasKey); attempt-cap increment-first bounds re-extraction even under the all-or-nothing retrying cron; resultData provenance stays clean (web count set in orchestrator, not the goal-derived builder).

### 11. `lib/settlement/palpite-result-data.ts`
**Change:** NO new opt threaded through palpiteResultDataFrom (REVERSED from draft). Keep this builder strictly goal-derived (score/halftime/events). The web-grounded yellowCardsTotal is set by the orchestrator (settle-palpites.ts) on the reconciled path, NOT here.

**Why:** M1/M5: card count is web-grounded, not goal-derived — coupling it into the goal builder muddies the skip-not-fabricate boundary (cardsTotal:undefined would look identical to 'not a cards row'). Keep provenances separate.

### 12. `lib/db/queries/palpite-outcomes.ts`
**Change:** Add NEW upsertPalpiteOutcomeOverride mirroring upsertOutcomeOverride (prediction-outcomes.ts:49-71) MINUS profitUnits (palpites have no stake): insert {palpiteId, resultData, result, overrideByUserId} with onConflictDoUpdate on palpiteOutcomes.palpiteId, and the set MUST include resultData, result, overrideByUserId AND settledAt: new Date() (the prediction precedent bumps settledAt; omitting it leaves a stale timestamp on a corrected row). insertPalpiteOutcomeIfAbsent (onConflictDoNothing) CANNOT override — this handles both stuck-PENDING and settled-wrong.

**Why:** palpiteOutcomes.overrideByUserId exists (schema.ts:537) but has NO writer. This is the escape hatch for cap-exhausted/A≠B-stuck rows and the only fix for an already-wrong settle.

### 13. `app/actions/settlement.ts`
**Change:** Add admin-gated overridePalpiteOutcome mirroring overridePredictionOutcome (33-122) but for the palpite domain: reject non-admin; require palpiteId; result restricted to won/lost (reject void/push — no stake); reject empty BEFORE conversion (homeRaw/awayRaw discipline → here a hand-entered yellowCardsTotal integer, validated, OR explicitly write resultData:null and document operator-trust). overrideByUserId = session.user.id. Call upsertPalpiteOutcomeOverride. revalidatePath: there is no admin palpites route yet — revalidate the public detail path that shows the badge (or omit deliberately and note it). Document that overridden rows are trust-the-admin, NOT rule-validated against line.

**Why:** The override SURFACE. Shaped for the cards domain (count, not scoreline). Reject-empty-first prevents a no-body POST fabricating an outcome.

### 14. `db/migrations/0040_*.sql + db/schema.ts (table def)`
**Change:** NEW sidecar table palpite_settlement_attempts: palpiteId uuid PK + notNull + references palpites.id onDelete cascade; attempts integer notNull default 0; lastAttemptAt timestamptz. Add the Drizzle table def to schema.ts then `pnpm db:generate` to land the NEXT FREE number (current max 0039 → 0040; do NOT hand-number — per the concurrent-storm-renumber memory). Add incrementAttempt(palpiteId) (insert ... onConflictDoUpdate attempts = attempts+1, lastAttemptAt=now) and attemptsExceedCap(palpiteId, CAP≈3) query. Increment fires FIRST in the fan-out (before the paid call), unconditionally.

**Why:** Cross-tick spend bound. KV rejected (TTL silently resets the cap → re-spend). This IS the one migration #394 ships — owns the otherwise-contradictory 'no migration' framing. Cap-exhausted rows stay PENDING; override is the escape.

### 15. `docs/decisions/0033-cartoes-liquidaveis-tier3-via-extracao-web.md`
**Change:** APPEND an addendum (NOT a new ADR — 0033 predates #419 and the reshape). Reconcile the stale original text point-by-point (see adrAddendum field). Explicitly RETRACT §1 'amarelo + vermelho' → YELLOW-only ('cards' type, total yellows >= line ∈ {4,6}); §2 'via lib/ai/predict.ts' → getProviderForModel().runAnalysis serverTool seam (predict.ts is NOT the entry); §3 'Dupla leitura cega' → decorrelated BR/INTL partitions (not blind clones); and DOWNGRADE the '≥2 fontes citando o mesmo número numa página lida' to the buildable guarantee (A.count===B.count over disjoint pools + ≥2 distinct collapsed origins + each pool ≥1 source), owning that the count is parsed from grounded model PROSE (settlement fact, firewall N/A) and that A≡B is OUTLET agreement not source-independent corroboration.

**Why:** Records the firewall-exception decision (the highest-risk call in #394) and stops the ADR text from contradicting the shipped code.

## Guardrail

PURE RULE vs ORCHESTRATION split (inviolable): the pure rule cards_palpite.ts is `(params, resultData) => 'won'|'lost'`, reads ONLY resultData.yellowCardsTotal, compares `>= line`, and THROWS SettlementError on undefined (skip-not-fabricate at the boundary — caught upstream → row stays PENDING, never a fabricated count). ALL of A≡B / decorrelation / origin-counting / attempt-cap lives in ORCHESTRATION (settle-palpites.ts + extract-cards-from-web.ts), never the rule.

LIQUIDATE A CARDS ROW ONLY IF (orchestration, ALL must hold): match finished with regulationScore; isCardsCovered(p.league); attempts < CAP; readA(BR pool) count != null; readB(INTL pool) count != null; readA.count === readB.count; each read returned ≥1 real source; union of DISTINCT collapsed editorial origins across both reads ≥ 2 (espn.com+espn.com.br→1, *.globo.com→1, via the pinned hostToOrigin table). ANY failure → leave yellowCardsTotal undefined → rule throws → PENDING. Never fabricate, never settle on one read, never settle on disagreement.

DECORRELATION HONESTY: A and B search DISJOINT domain pools (genuinely independent search, not byte-identical clones / cache hits) — but for cards both reads reason over the SAME upstream official match-sheet, so A≡B is OUTLET agreement, NOT independent corroboration. The real protection is skip-on-disagreement + attempt-cap + manual override, NOT 'two reads = verified'. The addendum states this; the plan does not oversell A≡B.

COUNT-CHANNEL FIREWALL EXCEPTION (sanctioned): the count is parsed from the model's PROSE text block (server-tool mode hard-sets toolInput:undefined + tool_choice:auto, and extractSources only yields {title,url}). This is acceptable because a card count is a SETTLEMENT FACT, not an EV/odd/value claim — the ADR 0030/0032 value-language firewall does not apply. Parse defensively (Zod a single non-negative integer; ambiguity → null → PENDING). Per-source {origin,count} is NOT claimed (mechanically underivable).

IDEMPOTENCY: insertPalpiteOutcomeIfAbsent onConflictDoNothing on UNIQUE palpiteId — re-run never double-settles; PENDING rows simply re-enter the pending query. attempt-cap increment fires FIRST (before the paid call, unconditionally, even on A≠B/null) so a permanently-flaky match stops after N regardless of crash/retry timing.

OVERRIDE bypasses the A≡B gate (manual = human-verified) via upsertPalpiteOutcomeOverride (onConflictDoUpdate, bumps settledAt), admin-gated, won/lost only, reject-empty-first; overridden rows are trust-the-admin, NOT rule-validated against line.

NO BACKFILL of palpites.settleable on existing #419 rows (this is what keeps them inert).

## Migration

ONE migration: 0040 (next free after 0039_tearful_beast.sql) — the cross-tick attempt-cap sidecar table `palpite_settlement_attempts` (palpiteId uuid PK + FK palpites onDelete cascade; attempts int notNull default 0; lastAttemptAt timestamptz). GENERATE it via `pnpm db:generate` after adding the table def to schema.ts — do NOT hand-number (concurrent-storm-renumber risk; if another PR grabs 0040, merge main, take theirs, db:generate to the next free, verify). KV was rejected (TTL silently resets the cap → re-spend). NO enum migration ('cards' shipped in 0039 ALTER TYPE ADD VALUE). NO result_data migration (PalpiteResultData.yellowCardsTotal is a TS $type widening on the jsonb column). NO params migration ({line, scope:'total'} already modeled at schema.ts:490). The draft's 'No migration' headline was self-contradictory — #394 ships exactly ONE table migration and must own it.

## Addendum do ADR 0033 (sem ADR novo)

## Addendum (2026-06-20, #394) — reconciliação pós-#419 e pós-reshape

Esta decisão (0033) precede o #419 (que JÁ emitiu a linha de cartão) e os guardrails reshaped. O addendum corrige o texto original ponto a ponto; onde conflita, o addendum vence.

**1. Tipo = 'cards' (amarelos), NÃO 'amarelo + vermelho'.** §1 dizia 'Cartões (amarelo + vermelho)'. O #419 embarcou UM tipo `cards` (enum migr 0039) com params `{line, scope:'total'}` = TOTAL DE AMARELOS >= line, line ∈ {4,6} (CARDS_LINE). O #394 liquida SÓ total de amarelos. Vermelhos ficam fora da chave de liquidação. red_card/corners seguem fun-only (fora de SETTLEABLE_PALPITE_TYPES).

**2. Seam = runAnalysis, NÃO predict().** §2 dizia 'pela fronteira lib/ai/predict.ts'. CORRIGE: a extração vai por `getProviderForModel(MODEL_REGISTRY['claude-haiku-4-5']).runAnalysis({...serverTool:{kind:'web_search', allowedDomains, maxUses}})` (o padrão #377/anthropic-web-search.ts), logada em ai_calls, hasKey()-gated (zero gasto sem chave), SEM provider novo, SEM SDK direto. predict.ts NÃO é a porta de entrada aqui.

**3. A≡B DECORRELACIONADO, não 'dupla leitura cega'.** §3 pedia duas extrações cegas independentes. SHARPEN: A e B rodam com partições allowedDomains DISJUNTAS (A = CARD_DOMAINS_BR, B = CARD_DOMAINS_INTL) — pools de busca fisicamente distintos, não clones byte-idênticos. Liquida só se ambos não-nulos E iguais; qualquer null ou A≠B → PENDENTE.

**4. Garantia de origens — DOWNGRADE honesto do que é construível.** §3 pedia '≥2 fontes citando o mesmo número numa página efetivamente lida'. REALIDADE DO SEAM: no modo server-tool runServerToolAnalysis devolve toolInput:undefined (tool_choice:auto, sem submit forçado) e extractSources (o firewall) só carrega {title,url} — NÃO há canal estruturado pra um número por-fonte. A CONTAGEM vem do bloco de TEXTO (prosa) do modelo, ancorada pela busca server-side mas NÃO protegida pelo firewall. Isso é ACEITÁVEL aqui: uma contagem de cartões é um FATO de liquidação, não uma afirmação de VALOR (EV/odd/stake) — o firewall de linguagem-de-valor (ADR 0030/0032) NÃO se aplica. Parse defensivo (Zod um único inteiro; ambíguo → null → PENDENTE). A garantia real construída: A.count===B.count sobre pools disjuntos E cada read com ≥1 fonte real E união de ORIGENS EDITORIAIS distintas (colapsadas: espn.com+espn.com.br→1, *.globo.com→1) ≥ 2. O `{origin,count}` por-fonte do texto original é mecanicamente inderivável e está RETRATADO. Além disso: cartões têm UMA fonte upstream (a súmula oficial), então A≡B é CONCORDÂNCIA de veículos, NÃO corroboração independente; a proteção real é skip-on-disagreement + attempt-cap + override.

**5. Override manual concreto.** §3 'override manual' agora é um writer real: upsertPalpiteOutcomeOverride (espelha upsertOutcomeOverride MENOS profitUnits) + overridePalpiteOutcome admin-gated. Rows overridden são trust-the-admin (não validadas pela regra contra line).

**6. Attempt-cap cross-tick (NOVO).** Rows stuck-PENDING (A≠B repetido) não são re-extraídas pra sempre: sidecar palpite_settlement_attempts (migr 0040), incremento ANTES da chamada paga, fan-out gated em attempts < CAP (~3). Esgotou → PENDENTE permanente até override.

**7. ai_calls do cron loga sob o DONO do palpite.** ai_calls.userId/matchId são notNull+restrict; o cron não tem usuário requisitante. A pending query passa a SELECT palpiteSets.userId → cada extração loga sob o id do dono do palpite (matchId já na row). Sem migration de coluna nullable, sem usuário sentinela.

**8. Inércia por cobertura.** CARDS_COVERED_LEAGUES vazio ⇒ o fan-out web NÃO dispara pra nenhuma liga (gate ANTES da chamada paga) ⇒ zero gasto, zero badge. Ligar uma liga exige prova empírica de fonte ao vivo. Rows #419 antigas seguem inertes pelo settleable=false PERSISTIDO + gate SQL duplo; #394 NÃO faz backfill.

**9. Custo.** Por liquidação de cartão: 2 web-searches (A+B) × ~$0,01 + 2 Haiku, RETENTADO por tick até o cap (≤ 2×CAP searches por row stuck). A taxa de web search NÃO entra em ai_calls.costUsd (metered out-of-band). Com CARDS_COVERED_LEAGUES vazio = literalmente zero até uma liga ser ligada.

## Test plan

- PURE RULE (cards_palpite.ts) unit: count >= line → 'won'; count < line → 'lost'; yellowCardsTotal undefined → throws SettlementError (PENDING); params {line:5} or {scope:'partial'} → throws (line pinned to literal 4|6, scope literal 'total')
- ORIGIN COLLAPSE (origin-collapse.ts) unit: espn.com & espn.com.br → 1 origin; ge.globo.com & globoesporte.globo → 1; espn.com.br & uol.com.br → 2; unknown host → null (excluded); espn.com.br does NOT collapse to 'com.br' (eTLD+1 trap guard)
- EXTRACT RECONCILE (extract-cards-from-web.ts, provider mocked): A.count===B.count AND ≥2 distinct origins AND each pool ≥1 source → returns the number; A.count !== B.count → null; A null or B null → null; A===B but union origins <2 → null; one pool returned 0 sources → null; count prose ambiguous/multiple-integers → null
- INERTNESS (zero spend): hasKey()=false → extractCardCount returns null, logs provider_error, ZERO runAnalysis; CARDS_COVERED_LEAGUES empty → fan-out loop builds ZERO web-search requests for every cards row (assert provider.runAnalysis NOT called) — proves the coverage-gates-the-FETCH ordering
- GATE-INERT (the central question): existing #419 row with persisted settleable=false → NOT in getPendingPalpiteSettlements result even after 'cards' added to the tuple (double SQL gate); NEW emitted cards row → settleable=true persisted; but with empty coverage set → no outcome row written, outcome stays null
- SETTLE INTEGRATION (pglite, node env, .batch shim): finished match + reconciled count >= line → palpite_outcome won; count < line → lost; A≠B → no outcome row (PENDING, re-enters next tick); not-finished/no-regulationScore → skipped FIRST before any web fetch
- IDEMPOTENCY: run settlePendingPalpites twice → second run alreadySettled++, no double outcome (onConflictDoNothing on UNIQUE palpiteId)
- ATTEMPT-CAP: row failing A≡B increments attempts FIRST each tick; once attempts >= CAP the fan-out skips it (no further runAnalysis); increment survives even if a later row in the batch throws (commit-before-extract ordering)
- OVERRIDE WRITER: upsertPalpiteOutcomeOverride on a stuck-PENDING row inserts with overrideByUserId set; on an already-settled-wrong row onConflictDoUpdate flips result + bumps settledAt + sets overrideByUserId; overridePalpiteOutcome rejects non-admin, rejects void/push, rejects empty body BEFORE conversion
- DISJOINTNESS: EVENT_BACKED_PALPITE_TYPES ∩ WEB_GROUNDED_PALPITE_TYPES === ∅ asserted (and the import-time invariant throws if violated)
- ai_calls LOGGING FROM CRON: extraction logs an ai_calls row with userId = palpite owner's id (from pending row) and matchId from the row — no NOT-NULL violation
- FIELD-NAME GUARD: a present yellowCardsTotal actually settles (not just throws) — pins the one canonical name across schema/builder/rule/test so the 4-way drift can't hide behind skip-not-fabricate
- TRIAD: pnpm typecheck (Record<SettleablePalpiteType> exhaustiveness forces the cards registry entry) + pnpm lint + pnpm test green; migration 0040 applies clean

## Landmines

- deriveSettleable is league-BLIND (only sees type) — coverage CANNOT live there. The league-axis gate (isCardsCovered) must sit in the ORCHESTRATOR, and specifically must gate the WEB FAN-OUT loop BEFORE building any request, not only the per-row settle loop. Wrong order = paid extraction fires for an uncovered league.
- The count comes from MODEL PROSE, not the firewall. The draft's 'copy lines 95-220' hides this: extractSources (the firewall) yields ONLY {title,url}; runServerToolAnalysis hard-sets toolInput:undefined + tool_choice:auto. Anyone 'reusing' the seam expecting a structured count will find none. Parse the integer from contentBlocks text, defensively, ambiguity→null→PENDING.
- Per-source {origin,count} is MECHANICALLY UNDERIVABLE (URLs have no count; one prose number has no per-URL link). Do NOT build the '≥2 origins carrying the SAME number' guarantee — build A===B over disjoint pools + ≥2 distinct collapsed origins + each pool ≥1 source, and say so in the addendum.
- Field-name drift: pin yellowCardsTotal in schema type, orchestrator setter, rule reader, and tests. jsonb $type has NO column to catch a typo — a mismatch reads undefined → eternal PENDING that LOOKS inert (a 100%-broken feature masquerading as 'not turned on').
- ai_calls.userId AND matchId are notNull+restrict — the cron has no requesting user. Must SELECT palpiteSets.userId into the pending row (already in the join) and log under the palpite owner. Skipping this throws a NOT-NULL on every extraction log.
- NO backfill of palpites.settleable on existing #419 rows — that persisted settleable=false IS the thing keeping old fun-only rows out of the cron. A 'helpful' UPDATE to settleable=true would flip every old row settleable and (in a covered league) settle them.
- Attempt-cap increment ordering: increment FIRST, before the paid call, unconditionally (even on A≠B/null). Increment-after-success makes the cap dead code; the all-or-nothing retrying cron + no-transaction means after-increment is leaky.
- Do NOT thread cardsTotal through palpiteResultDataFrom — that builder is goal-derived (score/halftime/events). Web count set in the orchestrator on the reconciled path; cardsTotal:undefined through the builder is indistinguishable from 'not a cards row'.
- Keep cards OUT of EVENT_BACKED_PALPITE_TYPES (it has no /fixtures/events path) and enforce EVENT_BACKED ∩ WEB_GROUNDED === ∅ at import — a future type in both double-spends (api-football credit + web fee).
- pnpm test flakes pglite beforeAll timeouts on this 8-core local box — verify the integration suite with --no-file-parallelism or maxForks=2; CI (2-core) is the real green.
- Migration: db:generate to the next free number (0040), don't hand-number — concurrent PRs can grab it (concurrent-storm-renumber). Inside the worktree, install with --ignore-workspace.
- origin-collapse must use an eTLD+1 / alias table, NOT split('.').slice(-2) (collapses espn.com.br → 'com.br'). Under-collapse (treating syndicated CNN Brasil/UOL as distinct) is the SAFE direction for a settlement gate; over-collapse hides a single origin behind two names.

## Open risks

- The inert→active flip per league needs EMPIRICAL proof before turning a league on in CARDS_COVERED_LEAGUES: web extraction was found settlement-grade for cards (play-by-play, fetch-clean) but only against the specific outlets — a new league/outlet set must be probed live (A≡B hit-rate, hallucination rate, ≥2-origin coverage) before the badge ships. Until then the feature is inert by design.
- Web-search COST is metered OUT-OF-BAND and invisible in ai_calls.costUsd (token-only). Per settled cards row = up to 2×CAP searches (~$0.01 each) for a stuck row before the cap bites. With CARDS_COVERED_LEAGUES empty it's literally zero, but the spend telemetry has a blind spot the moment a league is turned on — no in-app guardrail catches a runaway, only the attempt-cap.
- A≡B on cards is OUTLET agreement, not source-independent corroboration (one official match-sheet upstream) — two reads can agree while both inherit the same wrong wire number. The residual mis-settle risk is real but bounded by skip-on-disagreement + manual override; the project's 'prefer over-pending to wrong-settle' principle is the backstop.
- Cap-exhausted rows die SILENTLY PENDING with no distinct 'exhausted' signal surfaced to an admin (no admin palpites route exists). The only escape is the override action; consider a queryable flag/log so stuck-exhausted rows are discoverable, else they're invisible.
- The revalidatePath target for overridePalpiteOutcome is uncertain — no admin palpites route exists yet; revalidating the public detail path is a guess. A stale badge after override is a cheap-to-miss UI bug; confirm the right path or omit deliberately.
- Override-typed yellowCardsTotal is operator-entered and NOT validated against line by the pure rule (the action writes result directly). Acceptable for an admin escape hatch but means an overridden row's stored count is trust-the-admin, not rule-consistent.
