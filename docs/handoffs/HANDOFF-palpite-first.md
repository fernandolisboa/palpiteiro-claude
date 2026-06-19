# HANDOFF — Arco palpite-first (pós ADR 0030)

> Snapshot de um ponto no tempo (2026-06-19). Auto-suficiente, aterrado no CÓDIGO
> real. Não é spec viva — a fonte da verdade é a ADR 0030 + as issues.

## Onde estamos

**ADR 0030 (#349) MERGED** — o pivot **palpite-first** está cravado: o palpite vira
a **manchete sintetizada** da análise multi-mercado (HERO no topo), as análises por
mercado viram **detalhe recolhível**. Emenda o ADR 0028 (firewall de geração cai da
camada de DADO pra a de APRESENTAÇÃO).

**#353 (passo de síntese) MERGED 2026-06-19 (PR #358, squash 07e94b1f)** — o spine de
DADO/IA do palpite-first está pronto **e ships dark** (flag `enableBestBetFanOut` OFF em
prod). Em `main` agora:
- `summarizeAnalysesForSynthesis(FanOutOutcome[]) → MarketAnalysisSummary[]`
  (`lib/ai/palpites/synthesis-input.ts`) — lê os campos PERSISTIDOS da prediction; edge entra como **DADO**.
- Cartucho **`palpites_v2`**: output vira a manchete `PalpiteSynthesisOutput {verdict,
  probableScore, confidence (qual: baixa/media/alta), narrative, citedMarkets}` `.strict()`.
  Fun `red_card`/`corners` **deixam de ser geradas** (enum preservado → Tier 3 de pé).
- **Firewall 3 camadas** (§3): `.strict()` + `containsValueLanguage` guard pós-Zod sobre
  verdict/narrative/text/**citedMarkets** (`value-language-guard.ts`, hit=`invalid_output`)
  + `PalpiteHeadlineView` sem nº de valor.
- `analyzeBestBet` roda a síntese (Haiku) **em try/catch** → `{ok, view, palpite:
  PalpiteHeadlineView | null}` (falha degrada sem descartar o fan-out pago).
- Coluna aditiva **`headline jsonb`** em `palpite_sets` (migration **0035**); settlement
  **latest-only** (só a última geração por matchId/userId; tiebreak createdAt+id).
- **Teardown:** auto-run #315 (`generatePalpitesAction`/`PalpiteAutoRun`) + regen
  (`regeneratePalpitesAction`/`RegenButton`) **removidos**. `GeneratePalpiteArgs =
  {matchId, userId, analyses, modelOverride?}`.

**#351 (HERO palpite-first) MERGED 2026-06-19 (PR #360, squash 255de30b)** — o spine de
**APRESENTAÇÃO** está pronto. Em `main`:
- `<PalpiteHero/>` (`components/palpites/palpite-hero.tsx`, client) — server-fed por
  `toPalpiteHeadlineViewFromSet(sets[0])` (`lib/view/palpites-headline.ts`); 8 estados
  (empty/CTA · kill-switch · encerrado · pending-skeleton · populated · settled won/lost ·
  erro). Botão único "Analisar com IA" → `analyzeBestBet` → `revalidatePath` (server re-feed).
  Dial **D-leaning** (escolha do dono): placar TECIDO no veredito ("Vai dar Palmeiras /
  provável 2–1"); kicker "O PALPITE"; confiança = palavra-chip (NUNCA meter/%/pip).
- **Firewall de UI** (`palpite-hero.test.tsx`) reusa `containsValueLanguage` + regra "sem %"
  — zero nº de valor no HERO. Costura cromática: HERO quente (`palpite-*`) → detalhe NEUTRO.
- `app/match/[id]/page.tsx` reordenado nos DOIS branches (HERO topo → zona neutra {odds +
  `MatchCollapsible` read-only com `MarketAnalysisSections`} → seções). DELETADOS:
  `palpites-panel`/`palpite-row`/`previous-palpites`/`best-bet-panel`/`analysis-panel`/
  `new-analysis-form` (+ testes). `palpite-badges` (SettleableBadge) FICA — o HERO reusa.
- **✅ GO-LIVE FEITO 2026-06-19:** a flag `enable_best_bet_fan_out` foi flipada **ON** no DB
  (neondb sa-east-1) — palpite-first **ATIVO**. O dono não quer gate manual; a flag FICA no
  código como **kill-switch DORMENTE** de spend (útil quando entrarem mais usuários — rate-limit
  20/dia NÃO rederivado pro multiplicador do fan-out, `predictions.ts:404`). Reversível
  (`SET = false`). Custo por run: até 6 predict() pagos + créditos de odds + 1 síntese Haiku, 1 slot.

**Arco antigo #313→#316 = 100% MERGED**; o `<PalpitesPanel/>` interim foi **substituído pelo
HERO** (deletado no #351). **O spine palpite-first (DADO #353 + UI #351) está COMPLETO** e a
**Faixa A de enriquecimento (#354) também** — o que resta (#350/#352) é **discovery/ADR**.

**#354 (tipos liquidáveis goal-derived) MERGED 2026-06-19 (PR #364, squash `42e38d05`).** Em `main`:
- **4 tipos** liquidáveis novos, espelhando `exact_score`, **sem provider novo**: `margin`
  (floor **≥2** "ganha por 2+" → ortogonal a 1X2), `clean_sheet`, `first_half_score` (placar
  do intervalo), `first_to_score` (home/away). Enum +4 valores (migration **0036**, só `ALTER
  TYPE ADD VALUE`).
- **Gate único** `SETTLEABLE_PALPITE_TYPES` (`lib/ai/palpites/settleable.ts`) dirige
  `deriveSettleable` **e** o predicado SQL `inArray` (`lib/db/queries/palpites.ts`) — sem drift.
  `red_card`/`corners` ficam de fora (Tier-3 de pé).
- **Dispatch por tipo** `PALPITE_SETTLEMENT_RULES` (`lib/settlement/rules/palpite-dispatch.ts`,
  **NÃO** o `registry.ts` de valor — separação ADR 0028) + 4 regras puras +
  `lib/settlement/palpite-result-data.ts` (deriva `firstToScore`; **own-goal-como-1º /
  minute-null / empate-de-minuto / feed-incompleto → undefined → PENDING**; o wire `ev.team`
  de own goal da api-football **não** é confiado — prefer-skip).
- **Adapter** passa `halftimeScore` adiante (`api-football/adapter.ts`; football-data.org=`null`
  → `first_half_score`/`first_to_score` ficam PENDING nesses fixtures, nunca LOST). Cron de
  palpite ganha fetch de eventos **só** p/ matches com row `first_to_score` pendente (quota guard
  testado).
- **Síntese `palpites_v2`→`palpites_v3`** (+`firstHalfScore` +`firstToScore` no schema `.strict()`
  + tool + prompt). Geração **multi-row** com **gate de EMISSÃO por coerência** (margin≥2;
  `first_half` ≤ `probableScore`; `first_to_score` só home/away coerente com o vencedor previsto;
  `"none"` nunca vira row) — **não** `.refine()` rejeitante (degradaria o palpite a null).
- **Firewall ADR 0030 mantido**: labels do scorecard vêm de **templates FIXOS pinados** + guard
  `containsValueLanguage` roda na geração sobre cada `text`. UI: scorecard "ficha" **quieto** no
  HERO (`palpite-hero.tsx`), abaixo do veredito, escondido a 0 dimensões.
- Idempotência por-row preservada (UNIQUE `palpiteId`). Code-review 3 lentes: **0 blocker, 0
  firewall leak, 0 silent-wrong-settle** — só hardening de teste aplicado. Plano:
  `docs/plans/PLAN-354.md`.

## Ler primeiro (nesta ordem)

1. `docs/decisions/0030-palpite-first-sintese-da-analise.md` — a decisão, aterrada em file:line.
2. Memória `palpites-engajamento-arc` (banner do topo = o pivot; corpo = o arco antigo concluído).
3. `gh issue view 350` → `352` (a cadeia restante; #353/#351/#354 = MERGED).
4. `CLAUDE.md` (fluxo: sanity-check → issues → subagent por passo; "O que NÃO fazer").

## Sequência + dependências

- **#353** `feat(ai)` — **passo de SÍNTESE** (multi-mercado → palpite-manchete). ✅ **MERGED (PR #358).**
- **#351** `feat(match-ui)` — HERO da manchete + detalhe recolhível. ✅ **MERGED (PR #360).** Spine palpite-first COMPLETO + **AO VIVO** (flag `enable_best_bet_fan_out` ON — ver "Onde estamos").
- **#354** `feat` — tipos de palpite liquidáveis **goal-derived**. ✅ **MERGED (PR #364, squash `42e38d05`).** Faixa A completa (ver "Onde estamos").
- **#350** `discovery` — cartão/escanteio liquidável → exige stats provider + **ADR Tier 3** (normalizer hoje é goal-only, `adapter.ts:541`).
- **#352** `discovery/ADR` — "Analise minha aposta" (avaliador selection-pinned da aposta do usuário; feature de VALOR, reusa o motor, exige ADR).

## Princípios inegociáveis (do ADR 0030)

1. **Edge consumido no DADO, NUNCA na manchete.** A síntese PODE ler `predictions`/edge; o componente HERO **nunca** renderiza EV/stake/Yield/"lucro esperado". A firewall virou **disciplina de UI** — exige um **guard/teste de apresentação espelhando `lib/view/palpites.ts:79`** (que descarta `aiCall`). Postura regulatória (Lei 14.790/2023, `docs/ops/05-legal-compliance.md §1/§6`) é mantida na UI.
2. **`predict.ts` é a única porta da LLM** (ADR 0027). A síntese é **UM `predict()` adicional por run**, logado em `ai_calls`. Sem chamar o SDK Anthropic direto.
3. **Custo atrás do botão.** Sem auto-run caro novo. `analyzeBestBet` já queima **1 slot por run inteiro** do rate-limit 20/dia (`app/actions/predictions.ts:394-414`), não 1 por mercado. O auto-run fire-and-forget do #315 (`generatePalpitesAction`) é **DROPADO**.
4. **Manchete = veredito/opinião** ("Vai dar Palmeiras, provável 2×1"). Números de valor só no detalhe.
5. **Gate Tier 3 de pé** — a síntese consome só mercados já suportados (Tier 1/2); tipo liquidável novo exige ADR (#350).

## Landmines (aterradas no código)

- **A machinery de fan-out JÁ EXISTE e JÁ RODA** — não reconstruir. `analyzeBestBet` (`app/actions/predictions.ts:326-485`) → `runFanOut(base, markets, mapError): FanOutOutcome[]` (`lib/ai/best-bet.ts:64-88`, serial `predict()` por mercado, `MAX_FANOUT_MARKETS=6`, `capCandidates` preserva Tier-1). As N análises voltam ranqueadas por edge/EV em `toBestBetView` (`lib/view/best-bet.ts:29-80`) — **mas SEM manchete única**. O #353 adiciona **só o último passo** (síntese), não o fan-out.
- **Caminho de dado a CONSTRUIR (#353):** `GeneratePalpiteArgs` (`lib/ai/palpites/types.ts:31-40`) e `BuildPalpitesInputArgs` (`lib/ai/palpites/cartridges/cartridge.ts:208-216`) **NÃO** aceitam `predictions` hoje — precisa adicionar o campo + o cartucho de síntese ler as análises. O `generatePalpites()` (`lib/ai/palpites/index.ts:47`) é market-free hoje (lê só `SportsDataProvider`); vira a síntese.
- **Reorder de UI nos DOIS branches (#351):** a hierarquia peer atual (`MatchHero → OddsCard → PalpitesPanel → AnalysisPanel`) existe em mobile `lg:hidden` (`app/match/[id]/page.tsx:301-314`) **E** desktop `hidden lg:block` (`~:388-408`). Mexer em ambos. O `<PalpitesPanel/>` interim do #316 é retrabalhado/dobrado no HERO.
- **O detalhe recolhível (#351)** reusa `components/analysis-result.tsx` (mostra stake/odd/EV `:120-162` — conteúdo do detalhe, nunca da manchete) + o padrão de `MatchCollapsible`.
- **#354 goal-derived:** BTTS/over/1X2/DC TAMBÉM liquidam por placar 90', mas DUPLICAM os mercados de valor → **evitar**; ficar em margem/clean-sheet/quem-marca-1º/placar-1ºT (badge de graça, sem provider novo).

## Critério de saída (por issue)

- **#353:** síntese tipada/validada por Zod produz a manchete a partir das `predictions`/`FanOutOutcome[]`; passa por `predict.ts` (loga `ai_calls`); testes; gates verdes. Sem EV/stake no output destinado à manchete.
- **#351:** HERO da manchete + detalhe recolhível, ambos os branches; guard de UI (zero número de valor no herói, testado); `/impeccable` no plano E na revisão + verificado no app real; gates verdes.

## Gotchas de ambiente

- **Worktree isolado** (sessão paralela ativa compartilha o checkout — worktree `palpiteiro-114` visto). `git worktree add -b <branch> ../palpiteiro-<n> origin/main`; `pnpm install --ignore-workspace` (stub `pnpm-workspace.yaml` torna o install normal um no-op vs `node_modules` stale); `cp .env.local` pro worktree (gitignored).
- **Merge do worktree:** mergear do checkout principal (não de dentro do worktree — gotcha "main already used by worktree"); depois `git worktree remove --force` + deletar branches local/remota.
- **`pnpm build` roda `drizzle-kit migrate && next build`** → aplica migration no Neon **dev compartilhado** (aditiva/idempotente). Migration nova: `pnpm db:generate` (NUNCA hand-number; conferir o `.sql`).
- **Testes pglite:** `pnpm test --no-file-parallelism` (flake de beforeAll em 8-core; CI 2-core verde).
- **`gh pr merge --squash`**; "Closes #N" (inglês) auto-fecha; "Fecha #N" (PT-BR) NÃO.

## Fluxo usado neste repo (replicar)

exploração (workflow read-only) → plano (`docs/plans/PLAN-<n>.md`) → **plan-gate adversarial 3 lentes** (pegou o defeito de escopo do #315) → implementação (subagent em worktree) → **code-review 3 lentes** → CI verde → merge → fechar. Para #351 (UI): `/impeccable shape` no design + audit/critique na revisão; `PRODUCT.md`/`DESIGN.md` na raiz já dão o contexto de design.
