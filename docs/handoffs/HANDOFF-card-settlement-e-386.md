# HANDOFF — Cauda do downstream: #394 (settlement) + #386 (discovery opcional)

> Snapshot 2026-06-20. O que sobra depois de uma sessão que levou **7 issues a MERGED**
> (#352, #383, #384, #385, #407, #408, #419) + reshape do #394. Auto-suficiente; aterrado no
> código real. **NÃO é spec viva** — é o ponto de partida da próxima sessão.

## Estado base (já em `main`)

A fila downstream pós-arco value-aware (HANDOFF anterior) foi quase toda concluída:

- **#352** → ADR **0034** (`docs/decisions/0034-...md`) "Analise minha aposta" leitor de valor
  selection-pinned. Build downstream criado: **#412** (ainda aberto, não construído).
- **#383** → ADR **0035** (compartilhamento público) + termo "Palpite compartilhado" no CONTEXT.md.
- **#384** → **LIVE**: rota pública `/p/[id]` read-only manchete-only + imagem OG (`app/p/[id]/`),
  query `getSharedPalpiteSet` gateada em `shared_at` (migration **0038**), projeção narrow no loader,
  citedMarkets normalizado, sources hardened, OG firewall mecanizado, middleware allowlist, noindex.
  Verificado em prod (matcher libera `/p/`, headers OK). Follow-up **#416** (soft-404 do dead-link +
  verificar Cache-Control imutável num palpite real compartilhado).
- **#385** → **LIVE**: jogos in-progress destacados no dashboard (view-layer `IN_PROGRESS_WINDOW_MS=3h`,
  `windowedQueryFrom`, `LiveBadge` "AO VIVO") + **GATE-HARDEN do #399 em 4 fronteiras**
  (`scheduled && kickoff > now` em match page + predictions.ts×3 via `notAnalyzableMessage` +
  predict.ts) — fechou um leak de spend em jogo ao vivo. Follow-up **#418** (`getUpcomingMatches` tem
  o mesmo bug latente de visibilidade; teto 3h heurístico).
- **#407** → discovery `docs/discovery/team-history-identity.md` (identidade-de-time-por-STRING resolvida).
- **#408** → **LIVE**: tela `/time/[team]` (histórico) + nomes clicáveis (hero + classificação),
  `getMatchesByTeam` 2-fatias, `resolveBackHref` multi-base + hardening anti-traversal.
- **#419** → **LIVE** (front-half de cartões): a síntese emite uma dimensão de cartão **fun-only**
  (`cardsTemperature: "pegado"|"muito_pegado"` → linha FIXA do projeto `CARDS_LINE {4,6}` →
  `"4+/6+ cartões amarelos"`, params `{line, scope:"total"}`), tipo `cards` no enum (migration
  **0039**), **FORA de `SETTLEABLE_PALPITE_TYPES`** (settleable=false), prompt **palpites_v8** com
  cláusula de firewall (PROIBIDO citar cartões/árbitro em verdict/narrative). Bump v7→v8.

**Migração mais alta em main = `0039`** (→ próximo livre `0040`).

## O que falta (ordem)

1. **#394 — liquidação web-grounded de cartões (settlement).** DESIGNADO, plano em
   **`docs/plans/PLAN-394.md`** (auto-suficiente, file-by-file, com os 4 blockers já resolvidos).
   **Build direto deste plano.** É a 2ª metade do #419: dá o badge acertou/errou ao tipo `cards`.
   - **Leia PLAN-394.md PRIMEIRO** — tem todo o detalhe + os landmines abaixo.
   - Resumo: add `cards` a `SETTLEABLE_PALPITE_TYPES` (forcing function) + regra pura
     `cards_palpite.ts` (total amarelos `>= line`, throw em undefined → PENDENTE) + `result_data`
     `yellowCardsTotal` (jsonb, sem migration) + extração web-grounded `extract-cards-from-web.ts`
     (REUSA o seam #377 via `getProviderForModel().runAnalysis`, NÃO `predict()`, NÃO SDK) +
     `cards-coverage.ts` (`CARDS_COVERED_LEAGUES` VAZIO = inerte) + `origin-collapse.ts` +
     override surface (`upsertPalpiteOutcomeOverride` + admin action) + **migration 0040**
     (`palpite_settlement_attempts` sidecar, attempt-cap) + addendum no ADR 0033.
2. **#412 — build de "Analise minha aposta"** (ADR 0034). Aberto, não construído. Engine-reuse
   selection-pinned; dual-channel (odd do usuário price-only), cache-first, registro Análise. **Não
   estava na ordem fixada do dono** — confirmar prioridade.
3. **#386 — discovery palpites mid-game.** **POR ÚLTIMO, OPCIONAL** — o dono precisa CONFIRMAR se
   entra ("ainda não sabemos se será feita"; precisa vendor de live-odds). Não construir sem o ok.

## Princípios inegociáveis (carregam de todo o arco)

- **`predict.ts` NÃO é a porta da extração de cartões** — o seam é `getProviderForModel().runAnalysis`
  com `serverTool:{kind:'web_search', allowedDomains}` (padrão #377/`anthropic-web-search.ts`), logado
  em `ai_calls`, `hasKey()`-gated (zero gasto sem chave). SEM provider novo, SEM SDK direto.
- **Firewall de linguagem-de-valor INTACTO.** A contagem de cartão vem da PROSA do modelo (o modo
  server-tool não tem canal estruturado: `toolInput:undefined`, `extractSources` só dá `{title,url}`).
  Isso é OK pra liquidação porque **contagem = FATO, não afirmação de valor** (EV/odd/stake) — o
  firewall NÃO se aplica. Parse defensivo (Zod 1 inteiro; ambíguo → null → PENDENTE). **Mas**: a
  manchete-síntese (#419) continua PROIBIDA de citar cartões/árbitro em verdict/narrative.
- **skip-not-fabricate**: a regra pura faz `throw` em `yellowCardsTotal` undefined → PENDENTE; nunca
  craveja um número plausível. A≡B/origens/decorrelação são ORQUESTRAÇÃO, nunca a regra.
- **Inércia por construção**: `CARDS_COVERED_LEAGUES` VAZIO ⇒ o fan-out web NÃO dispara (gate ANTES da
  chamada paga) ⇒ zero gasto, zero badge. Ligar uma liga exige prova empírica de fonte ao vivo.
- **NO BACKFILL** de `palpites.settleable` nas rows #419 antigas (é o que as mantém inertes; o gate SQL
  é duplo: `inArray(type) AND settleable=true`).
- **A≡B é CONCORDÂNCIA de veículos, não corroboração independente** (cartões têm UMA súmula upstream).
  A proteção real é skip-on-disagreement + attempt-cap + override manual. O addendum diz isso —
  não vender A≡B como "verificado".
- **Owner: ship ON, sem gates manuais** (mas cartões ficam inertes por COBERTURA, não por flag que o
  dono precise virar — ligar uma liga é decisão de engenharia após provar a fonte).

## Landmines (específicos do #394)

- **Migration 0040 É a única do #394** (`palpite_settlement_attempts`). `cards` enum já veio no 0039;
  `yellowCardsTotal` é `$type` jsonb (zero DDL); params já modelado. Gere via `db:generate` (NÃO
  hand-numere — `concurrent-storm-migration-renumber`).
- **`yellowCardsTotal`** é o nome ÚNICO do campo (schema/setter/rule/test) — o draft tinha 4 nomes
  divergentes (`yellowCards`/`cardsTotal`/…) = PENDENTE eterno disfarçado de "inerte". Pinar.
- **ai_calls.userId/matchId notNull**: o cron não tem usuário → a pending query passa a `SELECT
  palpiteSets.userId` → loga sob o DONO do palpite. Sem migration de coluna.
- **Gate de cobertura ANTES da chamada paga** (no loop de fan-out), não só no settle por-row — senão
  set vazio poderia vazar gasto na ordem errada.
- **`WEB_GROUNDED_PALPITE_TYPES` DISJUNTO de `EVENT_BACKED`** (assert em import-time) — senão o cron
  dispara api-football + web pro mesmo tipo (crédito + taxa duplicados).
- **`origin-collapse.ts`**: NÃO usar `split('.').slice(-2)` (colapsa `espn.com.br`→`com.br`). Tabela
  curada de eTLD+1 + identidade editorial (espn.com+espn.com.br→1, `*.globo.com`→1).

## Landmine de AMBIENTE (importante)

- **O checkout principal `/home/ferna/projects/palpiteiro-claude` tem mudanças NÃO-COMMITADAS que NÃO
  são minhas** (`M CONTEXT.md` + untracked `docs/decisions/0035-...md`) — um draft DIFERENTE do ADR
  0035/CONTEXT que JÁ está mergeado (PR #414). Provavelmente da sessão de bugfix concorrente ou um
  draft abandonado. **NÃO commitei/descartei** (não é meu; pode ser trabalho ativo). O dono deve
  decidir descartar (já é redundante — o 0035 mergeado é canônico). Consequência: o checkout principal
  está **stale** (atrás de origin/main) e com working tree sujo → **sempre trabalhar em worktrees off
  `origin/main`**, nunca confiar no working tree do checkout principal.
- `pnpm build` local falha sem `DATABASE_URL` (roda `drizzle-kit migrate` antes do `next build`). Pra
  validar o build: `DATABASE_URL="postgresql://u:p@localhost:5432/d" SKIP_ENV_VALIDATION=1 pnpm exec
  next build` (pula o migrate). **A triade vitest NÃO pega erros de `next build`** (ver memória
  `use-server-export-must-be-async`) — rode `next build` ao tocar `app/actions/*` ou rotas novas.
- pglite flaka no full `pnpm test` em 8-core → `--no-file-parallelism`; worktree install com
  `--ignore-workspace`.

## Critério de saída (por issue)

ACs batidos; PR **verde** (typecheck/lint/test CI + Vercel preview **E `next build` local**);
comentário de review adversarial postado no PR; merge via API (squash, sem `--delete-branch` em
worktree); confirmar landed; fechar a issue manualmente se o corpo usar "Fecha #N" PT-BR
(`github-fecha-not-autoclose`; "Closes #N" EN auto-fecha); cleanup do worktree/branch.

## Fluxo (provado nesta sessão — 7 issues a MERGED)

Por issue: **design-workflow** (explore→plano→**review adversarial**→finalize, structured plan,
apontado ao **worktree fresco** quando depende de código recém-mergeado) → **impl em worktree próprio**
(`../palpiteiro-<n>`, `pnpm install --ignore-workspace`; delegada a 1 agent com o plano cacheado) →
**review-workflow multi-lente + verify adversarial por achado** → **comentário no PR** → **fix das
ressalvas de valor** → **merge via API** com CI+Vercel+`next build` verde → confirmar landed → fechar →
cleanup. **Lanes paralelas** só com superfícies disjuntas (ex.: #408 ‖ #419 rodaram em paralelo;
a camada de síntese/settlement é compartilhada → sequenciar #419 → #394).
