# HANDOFF — Fase 1: perf/UI funcional (#371–#374 + #343)

> Snapshot 2026-06-19. A **primeira fase** (lote paralelo) do backlog cross-arc decidido nos grills
> de hoje. Auto-suficiente; aterrado no código real. **Não é spec viva** — é o ponto de partida.

## Escopo

5 issues, o primeiro lote a rodar **em paralelo** (em 3 lanes):

- **#371** `infra`/`ops` — odds-prewarm cron (tira a Odds-API do request path do match page)
- **#372** `refactor`/`database` — paralelizar as 2 queries sequenciais do match-load + alargar freshness 30→45-60min
- **#373** `feature`/`ui` — landing estática pública (a ÚNICA superfície pública nova; escudo fica intacto)
- **#374** `ai` — enxugar registry → Sonnet 4.5 (default) + Haiku 4.5 (dropar Opus/Sonnet-4.6/GPT-5-mini)
- **#343** `ui`/`design`/`polish` — coerência cross-surface pós-épico #320 (admin↔perfil + migrar análise → `ModelSelect`)

## Ler primeiro

- Os 5 corpos de issue (`gh issue view <n>`).
- `docs/discovery/perf-cost-scaling.md` §0 (medido) + §1/§6 (decisões) — contexto de #371–#374.
- Memórias: `perf-cost-scaling-discovery`, `visual-deslop-epic` (pra #343), `repo-label-conventions`.

## Estrutura paralela (a resposta pro "dá em paralelo?")

**3 lanes em paralelo; sequencial DENTRO da lane onde há acoplamento.** Sem migrations nesta fase
→ imune ao storm de renumeração de migration.

| Lane | Issues | Por quê sequenciar dentro |
|---|---|---|
| **A — match-load perf** | #371 → #372 | ambas editam `app/match/[id]/page.tsx` (#371 tira o bloco bloqueante de odds; #372 paraleliza o bloco de queries) |
| **B — landing** | #373 | independente — `app/page.tsx` (raiz) + `middleware.ts` |
| **C — model surface** | #374 → #343 | #343 migra o override pra `ModelSelect`, que renderiza o registry que #374 enxuga → #374 primeiro |

**Disjunção cross-lane (sem colisão):** `app/page.tsx` só na Lane B · `app/match/[id]/page.tsx` só na
Lane A · `lib/ai/models.ts`/`ModelSelect` só na Lane C · `middleware.ts` só na Lane B (nesta fase).

## Princípios inegociáveis (saídos dos grills)

- **Custo NÃO é o gargalo** (medido: ~$4.7/mês, $20 = meses). Não re-otimizar custo. #374 é higiene
  de picker + repro, **não** economia.
- **Escudo de auth fica INTACTO.** #373 (landing estática) é a **única** superfície pública nova.
  NÃO expor `/match`, dashboard, perfil. (Share público = #384, fase posterior, atrás de ADR #383.)
- **Default de modelo SEGUE Sonnet 4.5** (#374) — **não** Haiku-default (defaultar pro fraco trocaria
  qualidade de análise por economia irrelevante).
- **#371 respeita ADR 0012** (frozen-odds): o prewarm só captura snapshots no schedule; congelamento-
  na-recomendação inalterado. Reusar o tracking de quota existente (`getLastOddsApiQuota`).
- **#374 segue o padrão de remoção graciosa do #241** (Fable): predições antigas com modelos
  removidos continuam exibíveis. Preservar o seam `AIProvider` (ADR 0027) — só remover entradas do registry.
- **#343 é presentation-only** (zero mudança de comportamento); usar tokens `@theme` (#320/#321);
  `ModelSelect` tem que renderizar o registry pós-#374.

## Landmines

- **#371↔#372 mesmo arquivo** (`page.tsx`) → sequenciar na Lane A, não rodar simultâneo.
- **#374↔#343 superfície de modelo** → #374 antes de #343.
- **Sessão concorrente é dona do arco #376–#380** (value-aware/notícias; criou + mergeou #375/#381).
  NÃO mexer em `lib/ai` synth/models concorrente com ela. Esse arco provavelmente carrega migrations.
- **Checkout compartilhado:** já existem worktrees (`palpiteiro-114` em `feat/114`). Rodar cada lane
  em **worktree próprio** (`pnpm install --ignore-workspace` — `pnpm-worktree-ignore-workspace`);
  mergear via API; confirmar que landou via `git fetch` + ancestor check.
- **pglite high-core flake:** se `pnpm test` flakar timeouts de pglite, verificar com
  `--no-file-parallelism`. ESLint: garantir que `.next/` está ignorado pós-build.

## Critério de saída (por issue)

- ACs da issue batidos; PR **verde** (build/lint/typecheck/test + checks de CI); fechar a issue.
- **#384 NÃO entra nesta fase** (bloqueada por #383 — ADR de share, fase posterior).

## Ordem downstream (depois da Fase 1)

`#350` (discovery) → `#376`→`#377`→`#378`→`#379`→`#380` (arco value-aware — **estritamente sequencial**,
migrations sequenciais, **coordenar com a sessão concorrente**) → `#352` (discovery) →
`#383`→`#384` (share, **ADR primeiro**) → `#385` (live highlight) → `#386` (discovery mid-game, opcional —
"ainda não sabemos se será feita").
