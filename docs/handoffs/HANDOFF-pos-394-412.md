# HANDOFF — Pós #394 + #412: cauda do downstream quase vazia (só #386 opcional)

> Snapshot 2026-06-21. Sessão ultracode que levou **#394 (liquidação web-grounded de cartões)** e
> **#412 (Analise minha aposta)** a MERGED+LIVE. **NÃO é spec viva** — é o ponto de partida da
> próxima sessão. Aterrado no código real em `main`.

## Estado base (já em `main`)

- **#394 → MERGED** (PR #424, `240756fb`): badge acertou/errou pro tipo `cards` (total de amarelos
  `>= line ∈ {4,6}`) via extração **web-grounded** (seam #377 `getProviderForModel().runAnalysis`,
  NÃO predict, NÃO SDK). **Inerte por COBERTURA** (`CARDS_COVERED_LEAGUES` vazio em
  `lib/settlement/cards-coverage.ts` ⇒ zero gasto/badge). `deriveSettleable` é league-blind → rows
  NOVAS de `cards` são settleable=true e ENTRAM no pending; a inércia é 100% da cobertura. NO
  BACKFILL nas rows #419 antigas. A≡B sobre pools disjuntos (BR×INTL) + ≥2 origens
  (`origin-collapse.ts`) + attempt-cap (`palpite_settlement_attempts`, **migration 0040**). Override
  admin (`overridePalpiteOutcome`). ADR 0033 ganhou addendum (§10 = caveat pause_turn a validar
  ANTES de ligar uma liga). **Ligar uma liga exige prova empírica de fonte ao vivo** — até lá, inerte.
- **#412 → MERGED** (PR #425, `17de6d8b`): "Analise minha aposta" — leitor de valor **selection-pinned**
  (avalia a aposta FIXADA pelo user: mercado+seleção+linha+odd-da-casa → edge/EV/lucro/stake) no
  registro **Análise** (números de valor legítimos, NÃO manchete). ZERO matemática nova (compõe
  `scenario`/`money`/`staking`/`implied-probability`, forma de `best-bet.ts`); NÃO toca `predict.ts`
  nem o firewall (0 novos callers de `containsValueLanguage`). **Dual-channel** (odd do user
  price-only, NUNCA no Σ1/odd; edge no NOSSO board; EV@userOdd primário; guarda de coerência §4c).
  **Aba** `[ Análise | Minha aposta ]` na match page, gateada em `analyzable`, pré-preenchida da
  recomendação. Cache-first (HIT zero-LLM sem rate-limit; MISS atrás de `checkAnalysisRateLimit`).
  Disclaimer §3 net-new. SEM migration. Plano: `docs/plans/PLAN-412.md`.

**Go-live do #412 = JÁ COMPLETO.** Verificado no prod Neon: `match_result` já é
`is_active=true, is_graduated=true` → **1X2 já é público pro usuário comum** (a premissa "admin-only"
do ADR/explore estava stale vs prod). A aba avalia over_under + 1X2 pro usuário comum HOJE. Nada a
flipar. btts/dupla-chance seguem world_cup-only (cobertura por liga); cards/corners/scorer sem modelo
de odds → "não avalio ainda".

**Migração mais alta em main = `0040`** (→ próximo livre `0041`).

## O que falta (só 1 item, OPCIONAL)

1. **#386 — discovery palpites mid-game.** **OPCIONAL, precisa do OK do dono** ("ainda não sabemos se
   será feita"). É **discovery, NÃO build** — termina num doc em `docs/discovery/`. A pergunta dura:
   palpites/análise DURANTE o jogo são viáveis? **Bloqueador conhecido:** exige um **vendor de
   live-odds** (o feed atual é pré-jogo; The Odds API featured/alternate são pré-jogo; api-football
   tem live mas não odds-live confiável pra os mercados do MVP). Sem vendor de live-odds, mid-game vira
   só "destaque visual de jogo in-progress" — o que o **#385 já entregou** (badge "AO VIVO" no
   dashboard, `IN_PROGRESS_WINDOW_MS`). Então o escopo REAL do #386 é decidir se vale caçar/pagar um
   vendor de live-odds, ou se o destaque do #385 já basta. **Não construir nada sem o dono confirmar.**

   Outros follow-ups menores já FILADOS (não nesta cauda, sem urgência): #416 (share soft-404), #418
   (`getUpcomingMatches` visibilidade latente, mesmo bug do #385).

## Princípios inegociáveis (carregam de todo o arco)

- **Firewall da manchete INTACTO.** `containsValueLanguage` fica ligado a exatamente 4 campos da
  manchete (`lib/ai/palpites/index.ts:316-320`); a superfície Análise (best-bet, grade-my-bet)
  renderiza edge/EV/stake ABERTAMENTE e NUNCA roteia pelo firewall (erro de categoria). Qualquer
  superfície nova: ZERO novos callers de `containsValueLanguage`.
- **`predict.ts` é a única porta LLM de VALOR; o seam web-search (`getProviderForModel().runAnalysis`)
  é a porta de notícias/extração** (padrão #377, `hasKey()`-gated, logado em `ai_calls`). SEM SDK direto.
- **skip-not-fabricate / prefer-skip-over-silent-wrong-settle:** dado ausente/ambíguo → PENDENTE ou
  "não avalio", NUNCA um número plausível-mas-errado.
- **Owner: ship ON, sem gates manuais** (flags pré-existentes ficam como kill-switch; o dono não vira nada).

## Landmines de AMBIENTE (importante)

- **O checkout principal `/home/ferna/projects/palpiteiro-claude` tem mudanças NÃO-COMMITADAS que NÃO
  são da sessão** (`M CONTEXT.md` + untracked `docs/decisions/0035-...md`) — um draft de OUTRA origem,
  redundante com o 0035 já mergeado (PR #414). **NÃO mexer** (pode ser trabalho ativo do dono).
  Consequência: o checkout principal está **stale + sujo** → **sempre trabalhar em worktrees off
  `origin/main`** (`git fetch` + reconferir antes), nunca confiar no working tree do principal.
- `pnpm build` local falha sem `DATABASE_URL` (roda `drizzle-kit migrate` antes do `next build`). Pra
  validar o build: `DATABASE_URL="postgresql://u:p@localhost:5432/d" SKIP_ENV_VALIDATION=1 pnpm exec
  next build`. **A triade vitest NÃO pega erros de `next build`** (memória
  `use-server-export-must-be-async`) — rode `next build` ao tocar `app/actions/*` ou rotas novas.
- pglite flaka no full `pnpm test` em 8-core → `--no-file-parallelism`; worktree install com
  `--ignore-workspace`.
- `.env.local` no checkout principal tem a `DATABASE_URL` de **PROD** (Neon sa-east-1/neondb) em
  plaintext — usável pra one-offs de prod (ex.: flip de flag) COM autorização do dono. NÃO imprimir o
  valor no transcript.

## Fluxo provado nesta sessão (2 issues a MERGED, ultracode)

Por issue: **design** (quando não há plano cacheado: design-workflow explore→plan→**review adversarial
multi-lente**→finalize → `PLAN-<n>.md`; quando há plano, build direto) → **impl em worktree próprio**
(`../palpiteiro-<n>`, `pnpm install --ignore-workspace`; pode delegar a 1 agent com o plano) →
**review-workflow multi-lente + verify adversarial por achado** → **comentário no PR** → **fix das
ressalvas de valor** → **merge via API** (squash, sem `--delete-branch` em worktree) com
CI+Vercel+`next build` local verde → confirmar landed → fechar (Closes #N EN auto-fecha) → cleanup
(`git worktree remove` + `git branch -D` + `git push origin --delete`).

**Insight do #412:** o design-workflow front-loadou a review adversarial (13 achados folded ANTES de
codar) → o review-workflow PÓS-build achou **0**. Endurecer no plano paga.
