# HANDOFF — Aposta livre Fase 2 (#472, ADR 0036)

> Snapshot de um ponto no tempo (2026-07-05), não spec viva. Aterrado no CÓDIGO da
> Fase 1 (tracer #471, PR #474, MERGED em main `12b481a3`). O ADR 0036 e o
> `docs/plans/PLAN-471.md` são o contexto de fundo. **Leia o código do tracer antes
> de estender — a Fase 2 GENERALIZA os seams existentes, não os reconstrói.**

## O que a Fase 1 já entregou (em main, funcionando)

- **Migration 0041** (`db/schema.ts`): `bet_slips`/`bet_legs`/`bet_leg_outcomes` com os enums **completos** da Decisão 2 já criados (`betLegKindEnum` tem os 12 kinds; `gradeSourceEnum`; `gradeStatusEnum`). **Não precisa de migration nova pros kinds** — só se adicionar coluna. `BetLegParams` (TS `$type`) hoje é só `{home,away}` → **widen** na Fase 2.
- **`lib/quant/scoreline-model.ts`** (PURO): `estimateLambdas` (Maher + shrinkage k=5, escada de degradação, agnóstico ao mando), `scorelineMatrix` (double-Poisson + Dixon-Coles τ), `pScoreline`, `poolSplitRates`. **FALTAM os readers** (Fase 2): `pMarginAtLeast`, `pCleanSheet`, `pOverUnder`, `pBtts`, `p1X2`, `cs16`, time-share κ (`first_half_score`/`first_half_over_under`), `pHomeScoresFirst`, `jointProbability(matrix, predicates[])`.
- **`lib/ai/bet-parse/`** (`schema.ts`/`cartridge.ts`/`parse.ts`): união `BetLegSchema` com **só** `exact_score`; envelope `legs: z.array(z.unknown())` com validação POR-ITEM; cap 280; limiter próprio. **Estender a união** com os demais kinds (cada um reusando o schema de params da regra de settlement — guard anti-drift Decisão 2b). Bump `bet_parse_v1`→`v2` ao mudar o prompt.
- **`app/actions/bets.ts`**: `parseBet` (NL→chips) + `confirmBet` (Zod fail-closed → grade → persist). Hoje só grada CAMINHO B `exact_score` via `gradeExactScoreFromStandings`. **Adicionar o roteamento kind×gate + o CAMINHO A.**
- **`lib/bets/grade-exact-score.ts`**: adapter CAMINHO B (standings→λ→matriz→prob) com guard B1 (Σplayed=0→no_data). Modelo pra os adapters dos outros props B.
- **`lib/settlement/`**: `settle-user-bets.ts` (espelha `settle-palpites`, wired no cron) + `rules/user-bet-dispatch.ts` (`USER_BET_SETTLEMENT_RULES` = só `exact_score`, reusando a regra pura verbatim; `SETTLEABLE_USER_BET_KINDS` = `["exact_score"]`; `deriveBetLegSettleable`). **Adicionar as regras novas + expandir os dois sets juntos (mesma fonte, sem drift).**
- **`lib/view/free-bet.ts`** + **`components/free-bet.tsx`**: mapper puro (perna B, edge SEMPRE "—") + UI NL→chip→resultado. **O editor por-chip completo** (picker v1 vira editor) é Fase 2.
- **`lib/rate-limit.ts`**: `checkBetParseRateLimit` + `checkBetSlipsRateLimit` (fail-closed). O `checkAnalysisRateLimit` (20/dia) é o que o CAMINHO A cobra por perna cara no MISS.

## Escopo da Fase 2 (issue #472)

1. **Readers do `lib/quant`** (todos os listados acima) + testes (oráculos de forma fechada com τ=0; time-share κ≈0.45). Completa o #452.
2. **Demais kinds do CAMINHO B**: `margin`, `clean_sheet`, `first_half_score`, `first_half_over_under`, `first_to_score`, totais k+0.5 fora da escada. Cada um: schema de perna (params reusando a regra), adapter de grade (via os readers), rota B.
3. **Tabela de roteamento kind×gate** (Decisão 3):
   - `over_under`/`match_result`/`btts`/`double_chance` → **A** se passa o gate `marketsForAudience ∩ marketsForLeague` (+ linha na escada do cartucho pro over_under); **B** se falha o gate.
   - `exact_score`/`margin`/`clean_sheet`/`first_half_*`/`first_to_score` → sempre **B**.
   - `cards`/`corners` → **none** (aceita-não-gradeada, badge). `cards` settleable=true (web-grounded, inerte); `corners` settleable=false.
4. **CAMINHO A** (Decisão 3): **reusar o core cache-first do #412 verbatim** (`gradeMyBet`, `app/actions/predictions.ts:814-1062`): `getLatestPredictionForPin` (HIT=zero LLM) → MISS: `checkAnalysisRateLimit` **por perna cara** + `ensureOddsSnapshotsFresh` + `predict()` → re-lê → ainda MISS = "não avalio". `gradeSource='cartridge'`, `pinnedPredictionId` aponta a prediction. **Dentro do gate, A é o único caminho — NUNCA rebaixa pra B.** Exaustão mid-slip → `gradeStatus='rate_limited'` por perna, sem número, sem rollback.
5. **Regras novas de settlement** (`user-bet-dispatch.ts`): kinds de mercado (`over_under`/`match_result`/`btts`/`double_chance`) — predicados triviais sobre `regulationScore`; **`over_under` de slip é binário sem push** (linha garantida k+0.5 pelo boundary — diferente de `lib/settlement/rules/over_under.ts:30` que tem push). `first_half_over_under` — trivial sobre halftime k+0.5 (halftime ausente→PENDING). `first_half_score`/`first_to_score`/`margin`/`clean_sheet`/`cards` já têm regra pura em `PALPITE_SETTLEMENT_RULES` (reuse verbatim).
6. **Editor por-chip completo**: o picker v1 (`components/grade-my-bet.tsx`) vira editor por-chip (mesmo vocabulário de campos), integrado ao echo do parse.

## Princípios inegociáveis / landmines (carregam do ADR + tracer)

- **Roteamento não contorna o gate de graduação**: o gate governa números de CARTUCHO (A); o CAMINHO B entrega número de OUTRA fonte, rotulado "modelo simplificado", **sem edge**, e **nunca sombreia o cartucho dentro do gate** (Decisão 3, Alternativa 15). Dentro do gate: só A; falhou o gate: B.
- **Perna B: edge "—" SEMPRE, NUNCA pseudo-implícita de `1/userOdd`** (`lib/view/free-bet.ts` não importa `computeMarketImpliedProbabilities` — teste estático pinado). Perna A: dual-channel do 0034 §2/§3 intacto (odd do usuário NUNCA no Σ1/odd).
- **Combinada/joint-sum é FASE 3** — NÃO fazer na Fase 2. `comboUserOdd`/`jointProbPct` já existem no schema (nullable, inertes).
- **Zero novos callers de `containsValueLanguage`**; **campo `verdict` PROIBIDO**; disclaimer §3 verbatim em todo render novo; grades congelados no write.
- **prefer-skip**: standings/halftime/eventos ausentes → PENDING/"não avalio", NUNCA fabricar. Guard B1 (leagueAvg degenerado) já no adapter — replicar nos adapters novos.
- **`lib/quant` PURO**: zero imports de `@/lib/db`/`@/lib/ai`/`@/lib/providers`. Adapters nas fronteiras dos consumidores.
- **`deriveBetLegSettleable` e `SETTLEABLE_USER_BET_KINDS` crescem JUNTOS** (mesma fonte) — perna settleable=true sem regra = stuck-pending eterno.

## Ordem sugerida

1. Readers do `lib/quant` + testes (PURO, independente, de-risca tudo).
2. Regras novas de settlement + expandir dispatch/sets + pglite (independente da UI/parse).
3. Expandir a união do parse + adapters de grade B por kind.
4. Roteamento kind×gate na `confirmBet` (o gate audiência∩liga já existe em `gradeMyBet`).
5. CAMINHO A na `confirmBet` (reusar o core do #412; cuidado com o rate-limit por perna).
6. Editor por-chip.
7. Triad + **`next build` local** (migration só se adicionar coluna; "use server" em `bets.ts`).

## Critério de saída

Um slip com pernas mistas (ex.: "Palmeiras vence, mais de 2.5, Palmeiras marca primeiro") gradeia cada perna pela rota certa (A dentro do gate com número de cartucho+edge; B fora do gate/props com "modelo simplificado" sem edge; cards/corners aceitas-não-gradeadas), persiste congelado, e liquida cada uma pela regra certa após o jogo. `#452` fechado (módulo `lib/quant` inteiro + testes). Triad + `next build` verdes.

## Gotchas de ambiente

- Worktree: `git worktree add -b <branch> ../palpiteiro-<x> main` + `cp ../palpiteiro-claude/.env.local .env.local` + `pnpm install --ignore-workspace` (o `pnpm-workspace.yaml` stub torna install no-op sem a flag).
- `pnpm db:generate` exige `DATABASE_URL` (do `.env.local`). Migration só se adicionar coluna — os enums/tabelas já existem. Se pegar 0042 e outro PR também, renumerar (memória "concurrent storm migration renumber").
- Suíte cheia flaka pglite em 8-core: `pnpm test --no-file-parallelism`.
- `next build` roda `drizzle-kit migrate && next build` (aplica migrations no DB de dev). Roda `next build` local por causa do "use server" em `bets.ts` (async-only).
- `z.uuid()` (Zod v4) valida UUID RFC-estrito — fixtures de teste precisam de version/variant bits válidos (ex.: `...-4xxx-8xxx-...`).
