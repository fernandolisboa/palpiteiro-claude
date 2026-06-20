# HANDOFF — Downstream pós-arco value-aware (#352 · #383/#384 · #385 · #394 · #407/#408 · #386)

> Snapshot 2026-06-20. O que sobra na fila depois de: **Fase 1** (perf/UI), **#350/ADR 0033**
> (discovery cartões liquidáveis), e o **arco palpite embasado #376→#380** — TODOS MERGED+LIVE nesta
> data. Ordem **fixada pelo dono** (esta sessão). Auto-suficiente; aterrado no código real.
> **NÃO é spec viva** — é o ponto de partida da próxima sessão.

## Estado base (já em prod, `main`)

- **`palpites_v7`**: síntese **value-aware** (#376, cai o dogma do óbvio, pode cravar o azarão) +
  **provider de notícias** via `web_search` nativo da Claude (#377, LIVE em prod, `lib/providers/news/`,
  seam ADR 0027, fontes `{title,url}` reais persistidas em `palpite_sets.headline.sources`) + **fontes
  citadas** no HERO (#378) + **fatos estruturados** no input da síntese (#379, H2H/placares pré-contados)
  + **validação de fidelidade** rules-only atrás de flag `enableFidelityValidation` **default ON**
  (#380, migration **0037**, + status `ai_calls.fidelity_divergence`; MAX=1 = degrada-não-regenera =
  custo extra de LLM ZERO).
- **Fase 1**: cron `prewarm-odds` 6h (#371) · freshness por tempo-até-kickoff CLV-safe (#372) · landing
  estática `/` + home authed movida pra **`/jogos`** (#373) · registry = Sonnet 4.5 (default) + Haiku 4.5
  (#374) · coerência admin↔perfil + análise→`ModelSelect`/`Select` (#343).
- **ADR 0033** (Accepted): cartões liquidáveis Tier 3 via **extração web-grounded** (reusa o seam do
  #377). Doc `docs/discovery/event-based-settlement-cards-corners.md` + ADR na main.
- **Migração mais alta = `0037`** (→ próximo livre `0038`).

## Ordem FIXADA pelo dono (2026-06-20)

Tudo antes da #386; **#386 por último (opcional)**. #407/#408 **depois das outras**, antes da #386.

1. **#352** — discovery/ADR **"Analise minha aposta"** (grade-my-bet): avaliador **selection-pinned**
   da aposta proposta pelo usuário (feature de VALOR, reusa o motor). → **ADR PRIMEIRO** (feature de
   valor exige ADR; ver `dont-anchor-on-adrs-as-immutable` mas isto é seam novo de produto).
2. **#383 → #384** — **compartilhar palpite**: `#383` ADR (snapshot público read-only **manchete-only**
   + OG, emenda o escudo de auth) → `#384` build (`/p/[id]` público + imagem OG). → **ADR PRIMEIRO**;
   `#384` depende de `#383`.
3. **#385** — **destacar jogos in-progress** no dashboard, mantendo-os acessíveis. Build, **sem ADR**
   ("None — can start immediately"). RECONCILIAR com `analyzable-scheduled-only` (a sessão de bugfix
   barrou live/postponed de "analisável" em #399) — destacar/acessar ≠ reabrir a análise paga.
4. **#394** — **cartões liquidáveis** via extração web-grounded (**ADR 0033 já decidido**). **BUILD
   DIRETO** — destravado agora que #377 mergeou; **REUSA o seam do #377** (não duplica). Cards-only
   (escanteios diferidos). Guardrail: dupla leitura **A≡B + ≥2 fontes independentes + skip-não-fabrica
   + override manual**. Provável migration (result_data de cartão) → checar nº no generate-time.
5. **#407 → #408** — **histórico do time**: `#407` discovery (resolve **identidade-de-time-por-STRING**
   classificação↔fixtures + chave da rota; **SEM ADR**, doc curto) → `#408` build (`getMatchesByTeam`
   sobre `matches` + rota `/time/[…]` + nomes clicáveis; **read-only, sem ADR**). `#408` depende de `#407`.
6. **#386** — discovery **palpites mid-game** (live-odds + estado ao vivo + emenda ADR 0012). **POR
   ÚLTIMO, OPCIONAL** ("ainda não sabemos se será feita"); precisa de **vendor de live-odds**.

## Forma das issues (o que vem primeiro dentro de cada)

- **ADR-first**: #352, #383.
- **Discovery-first** (doc, sem ADR): #407 (→ destrava #408).
- **Build direto**: #385, #394 (ADR 0033 pronto), #408 (após #407).
- **Discovery opcional, por último**: #386.
- **Paralelismo possível** (superfícies disjuntas): #352 (ADR doc), #383 (ADR doc) e #385 (dashboard)
  são independentes → dá pra tocar algumas em paralelo. #394 (settlement/news) é disjunto de #385.
  CUIDADO: a camada de síntese (`lib/ai/palpites/`, `cartridge.ts`) e o HERO (`palpite-hero.tsx`) são
  **superfícies compartilhadas** — se 2 issues mexerem nelas, **sequenciar** (lição do arco: #376‖#377
  colidiram em `cartridge.ts`).

## Princípios inegociáveis (carregam do arco)

- **Firewall de linguagem-de-valor na manchete FICA** (3 camadas: `.strict()` + `containsValueLanguage`
  sobre verdict/narrative/citedMarkets/settleable-text + HERO UI). Qualquer superfície nova que
  **renderize/compartilhe** o palpite — esp. **#384 (share público)** — NÃO pode vazar
  edge/EV/odd/stake/%/R$ na manchete. ADR 0030/0031. O share herda o mesmo firewall + disclaimer.
- **Settlement: prefer skip over silent wrong** — nunca cravar resultado plausível-mas-errado; deixar
  pendente + override manual (vale pra **#394** cartões e pro guardrail A≡B).
- **`predict.ts` é a única porta de LLM** (logado em `ai_calls`); `web_search` via o seam do #377
  (#394 **reusa**, não cria provider novo).
- **Escudo de auth INTACTO** exceto onde o ADR sanciona: **#384 abre uma superfície pública nova**
  (`/p/[id]`) — só atrás do **ADR #383** que fixa conteúdo manchete-only + postura regulatória. Todo o
  resto (`/match`, `/jogos`, dashboard, perfil, admin) segue gated.
- **Owner: ship ON, sem gates manuais** — flags default ON (kill-switch dormente); não fazer o dono
  habilitar nada (`owner-no-manual-feature-gates`).
- **Tier 3 = 1 ADR por mercado** (cartões já tem o 0033; escanteios/outros exigem ADR novo).

## Landmines

- **Sessão de bugfix concorrente ATIVA** (mesmo dono, outra sessão) — já mergeou em `main`: #396/#397
  (refs `/jogos` pós-#373), #399/#401 (live não-analisável), #405/#406 (back-param state), #409/#410
  (timezone por cookie). Memórias novas a ler: `landing-split-jogos-refs`, `analyzable-scheduled-only`,
  `back-param-state-preservation`, `user-timezone-dates`. **SEMPRE `git fetch` + reconferir `main`
  antes de criar worktree**; coordenar numbering de migration.
- **Migration numbering**: próximo livre = **0038**. #384 (snapshot de share?) e #394 (result_data de
  cartão) podem carregar migration → verificar no `db:generate`-time; `concurrent-storm-migration-renumber`
  se colidir com a outra sessão.
- **Identidade de time = STRING** (#407): a Classificação usa `displayTeamName` (tradução display-only,
  #340) que **NÃO** passa pelo `teamToTeam` dos fixtures (`matches.homeTeam/awayTeam` = nomes do
  provider). #407 resolve o mapa classificação↔fixtures + a chave de rota ANTES do #408 (senão link
  quebrado por mismatch). Entrada mais barata: linkar o **hero do jogo** (já canônico) é trivial; a
  classificação depende do mapa.
- **#385 vs analyzable-gate**: destacar/acessar um jogo in-progress ≠ reabrir a análise paga (que o
  #399 barra fora de `scheduled`). Manter o jogo VISÍVEL sem reativar o botão de IA.
- **Ambiente**: pglite flaka no full `pnpm test` em 8-core → `--no-file-parallelism`; `pnpm build`
  local falha sem `DATABASE_URL` (env, não código — Vercel preview é o gate; **migration PR pode redar
  no Neon-branch migrate — prod deploy é o gate real**); worktree install com `--ignore-workspace`.

## Critério de saída (por issue)

ACs batidos; PR **verde** (typecheck/lint/test CI + Vercel preview); ADR/discovery-first onde marcado;
comentário de review adversarial postado no PR; merge via API (squash); confirmar landed (ancestor
check); fechar a issue manualmente se o corpo do PR usar "Fecha #N" PT-BR (`github-fecha-not-autoclose`);
cleanup do worktree/branch. **#386 só entra se o dono confirmar.**

## Fluxo (provado nesta sessão — 11 issues a MERGED)

Por issue: **design-workflow** (explore→plano→**review adversarial**→finalize, structured plan) →
**impl em worktree próprio** (`../palpiteiro-<n>`, `pnpm install --ignore-workspace`) →
**review-workflow multi-lente** (lentes: correctness/spec/firewall/seam/migration/graceful-degrade) +
**verify adversarial por achado** → **comentário no PR** (`gh pr comment`) → **merge via API** (squash,
sem `--delete-branch` quando o branch tá em worktree) com CI+Vercel verde → confirmar landed → fechar →
cleanup. **Lanes paralelas** só quando superfícies disjuntas; senão **sequenciar** (a camada de síntese
é compartilhada).
