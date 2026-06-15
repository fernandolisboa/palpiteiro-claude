# HANDOFF — #182 · Reformular /como-funciona para o app multi-mercado

> ## ✅ CONCLUÍDO 2026-06-15 — PR #286 MERGED (squash `53983a6a`), issue #182 CLOSED. Sem migration.
> **Entregue:** intro+metadata multi-mercado; seção de ajuda por mercado com âncora linkável (`mercado-over-under`/`-1x2`/
> `-btts`/`-dupla-chance`); exemplos numéricos dos 4 mercados (O/U preservado + 1X2 3-vias + BTTS + dupla chance par→PASS);
> nota de cobertura Copa do Mundo p/ BTTS+dupla chance; método ganhou "você escolhe o mercado" + stake 1–3u; §"como ler os
> números" cita yield por mercado; **fix** do hardcode `5pp`→`MIN_EDGE_PP`; glossário market-aware (markets.* p/ 1X2/BTTS/DC,
> aditivo ao over_under). 4 commits verde-a-cada-passo; teste de contrato em lockstep; **1189 testes** + typecheck + lint;
> review adversarial 4-lentes (0 achados confirmados) postado como PR comment; CI/Vercel verdes. Worktree removido.
>
> ## ▶ PRÓXIMA DA CAUDA (épico #183 fecha SÓ quando a cauda fechar — diretriz do dono)
> Só resta **backlog** (nenhum é "implementar já"):
> - **#180** — CLV como métrica-companheira do Yield. `feature`, M. **Backlog quota-gated**: depende de #171 e pressiona a quota
>   de 500 req/mês (snapshot pré-kickoff por evento, só predições não-pass). Promover quando a quota comportar.
> - **#181** — Avaliar api-football como provider de odds (cobertura BR, Tier 3). `discovery`, G. **Exige ADR antes** (regra-portão
>   do CLAUDE.md: provider novo = ADR). É o mais "pronto" (pesquisa→ADR, sem dependência de quota); destrava Tier 3.
>
> Kickoff colável da próxima no fim da resposta da sessão (#181 recomendado como próximo movimento; #180 segue backlog).
>
> ---
> **Status (histórico, quando #182 era a próxima):** issue da cauda do pivot (épico #183, que só fecha quando TODA a cauda fechar). O **núcleo
> arquitetural do pivot está COMPLETO + LIVE** (Fase 5 contract #179, migration 0028, ver `HANDOFF-fase-5.md`).
> #182 é **conteúdo/UI** (label `documentation`/`pivot`/`pivot-fase-5`/`ui`, esforço **M**). **Sem migration, sem DB,
> sem risco arquitetural** — não precisa do plan-gate pesado do contract; flow leve serve.
> Migration head em `origin/main` = **0028** (sobe com merges concorrentes — `git ls-tree -r origin/main --name-only | grep migrations`).

## Escopo (do corpo do #182 + verificado no código)
A página pública `/como-funciona` (tutorial + glossário, sem login) ainda descreve o app como **mercado-único**
("over/under 2.5 — e só isso"). Reformular pra o app **multi-mercado** (motor de seleção de edge), **REAPROVEITANDO** o
conteúdo didático do over/under (decisão do dono: reaproveita, não descarta). O tutorial atual de O/U vira a **seção de
ajuda do mercado over/under** + o **template** das seções dos demais mercados.

**Narrativa a passar:** o que o app faz (multi-mercado); como escolhe o mercado; o que a recomendação significa
(**mercado + seleção + linha + stake**); por que `pass` é frequente (1ª classe); staking **1–3u por confiança** (D7);
graduação **por mercado** (D9); **1 recomendação por análise** (D1).

## O que ler primeiro
1. **Corpo do #182** (`gh issue view 182 -R fernandolisboa/palpiteiro-claude`) — escopo + AC.
2. **`app/como-funciona/como-funciona-content.tsx`** — o corpo (SÍNCRONO, 100% estático). Mapa do que é O/U-específico:
   - **Abertura** (L16-23): "over/under 2.5 gols — e só isso" → reframe multi-mercado.
   - **Seção 2** (L25-51): "O que é over/under 2.5 (do zero)" → vira a **seção de ajuda over/under** (preservar o didático).
   - **Seção 3** (L53-132): "Como o app decide: edge/confiança/PASS" — texto quase agnóstico, MAS o **box do exemplo
     numérico** (L92-131: over 1.92/under 1.92, edge +8pp, +11%) é O/U-específico → preservar como exemplo O/U + **adicionar
     um exemplo 3-vias (1X2)** (AC).
   - **Seções 4** (ler os números, L134-212), **6** (jogo responsável, L223-273) — JÁ agnósticas, não mexer no conteúdo.
   - **Seção 5** (L214-221): glossário — JÁ market-aware (#172), só renderiza `<GlossarySection/>`.
3. **`app/como-funciona/page.tsx`** — `metadata` (L8-12) "Entenda over/under 2.5..." → multi-mercado. Página pública
   (NÃO chama `auth()`; liberada no middleware). Corpo separado em `ComoFuncionaContent` SÍNCRONO de propósito.
4. **`components/help/glossary.ts`** — a infra **JÁ É market-aware** (#172): `GlossaryEntry.markets?: Record<marketKey,
   string>` (O/U em `markets.over_under` verbatim; mercados novos só ADICIONAM chaves). `anchor` (kebab-case) é **CONTRATO**
   (vira `id` no DOM + alvo de deep-link das hints `?`; pinado por `glossary.test.ts` + `como-funciona-page.test.tsx`).
   `components/help/glossary-section.tsx` renderiza o detalhe por mercado sob o significado genérico.
5. **`lib/view/markets/presentation.ts`** — registry dos mercados ATIVOS (over_under, match_result, btts, double_chance):
   `marketLabel`/`selectionLabel`/`betSummary` por mercado. **PURO/bundle-safe** (NÃO importa `@/lib/ai`/`@/lib/db`/
   market-descriptor — pinado por `presentation.test.ts`); se o conteúdo importar daqui, manter essa pureza.
6. **ADRs:** 0012-cenários (linguagem leiga: "retorno esperado"/"prob. do modelo"/copy temporal — AC exige), 0015 (domínio
   multi-mercado), 0018 (edge N-vias — pro exemplo 3-vias), 0019 (staking 1–3u), 0020 (yield/contagem).

## Mercados ativos a cobrir (todos LIVE pra todos os usuários — ver [[pivot-multimercado-phase-state]])
over/under (1.5/2.5/3.5, `world_cup` p/ extras) · **1X2 (match_result, todas as ligas)** · BTTS + dupla chance (`world_cup`).
Cada mercado ativo → **seção de ajuda própria com âncora linkável** (AC). O 3-vias (1X2) é o exemplo numérico novo obrigatório.

## Princípios inegociáveis (carregam)
- **Reaproveitar, não descartar:** o conteúdo didático do over/under é preservado (vira a seção O/U + template). Não perder
  o "do zero".
- **Linguagem leiga (ADR 0012-cenários):** "retorno esperado" (não "EV"), "prob. do modelo"/"prob. do mercado", copy temporal
  ("congelada na análise"); `MIN_EDGE_PP` SEMPRE importado de `lib/odds/scenario` (nunca hardcode "5pp").
- **Conteúdo SÍNCRONO + estático:** `ComoFuncionaContent` não pode virar async (o teste de contrato usa
  `renderToStaticMarkup`, que não aguarda Server Component async). Sem fetch/sessão.
- **Âncoras são contrato:** todo `anchor` do `GLOSSARY` precisa existir como `id` no DOM (pinado). Novas seções de mercado →
  novas âncoras estáveis (kebab-case); deep-links das hints dependem delas.

## Landmines (aterradas no teste)
- **`components/__tests__/como-funciona-page.test.tsx` pina conteúdo EXATO** e quebra junto: H1 + headings das seções (L19-27,
  inclui "O que é over/under 2.5 (do zero)"), os **números EXATOS do exemplo** (L29-37: `over 1.92 / under 1.92`, `0.5208`,
  `1.0417`, `58%`, `+8pp`, `+0.1136 ≈ +11%`), bloco jogo-responsável (L39-47), e **TODO anchor do glossário como `id="..."`**
  (L49-54). Reescrever conteúdo → **atualizar essas asserções no MESMO commit** (e adicionar as do exemplo 3-vias + headings
  de mercado novos). Se mudar a narrativa O/U, decidir: manter os números O/U pinados OU atualizar test+conteúdo em lockstep.
- **Glossário já tem `markets.over_under` verbatim** — se adicionar termos/chaves de mercado, respeitar as convenções
  pinadas por `glossary.test.ts` (anchor único kebab-case; `meaning` genérico nunca vazio; `markets` aditivo).
- **Separar funcional de polish visual** ([[separate-functional-from-visual-polish]]): #182 é reestruturação de CONTEÚDO. O
  passe de design/de-slop (/impeccable + Claude Design) vem DEPOIS, separado — não misturar na mesma fatia.

## Flow (leve — é conteúdo/UI, baixo risco arquitetural)
Exploração (subagent fresco mapeia glossary-section.tsx + help-hint.tsx + a lista GLOSSARY completa + os labels do registry) →
plano curto → implementação **commit-por-preocupação, verde a cada passo** (typecheck+lint+test; teste de contrato em lockstep)
→ code-review find→verify postado como **PR comment** ([[post-review-comment-on-pr]]) → merge squash `--delete-branch`. **Sem
migration → sem deploy-gate destrutivo** (Vercel preview/prod normal). 1 PR. `HANDOFF-*.md`/`PLAN-*.md` ficam FORA do commit.
O plan-gate adversarial two-round do contract é **overkill** aqui; dimensione ao risco (conteúdo).

## Gotchas de ambiente (carregam)
- **Worktree isolado** off `origin/main`: `git worktree add -b <branch> .claude/worktrees/182 origin/main`. Toolchain:
  `bash -lc '. "$HOME/.nvm/nvm.sh"; nvm use 24; cd <wt>; corepack pnpm --config.verify-deps-before-run=false <install
  --ignore-workspace | run typecheck | run lint | exec vitest run [paths]>'`. `--ignore-workspace` SEMPRE. Copiar `.env.local`
  (mesmo sem DB, scripts/config esperam). **`.env.local` aponta pra PROD** — nesta issue NÃO há query/migration, então não é
  fator, mas nunca rodar nada destrutivo.
- **CI (#278):** typecheck+lint+test em PRs/push = a triade local. PRETTIER **não** roda em CI → não `prettier --write`.
  `pnpm-workspace.yaml` (untracked) aparece no `git status` da worktree — **NUNCA commitar**.
- Sem migration ⇒ **sem colisão de número**; mas se outra fatia mexer em arquivos compartilhados, `git merge main` antes do PR.

## Critério de saída do #182
AC do #182: página descreve o app multi-mercado **sem perder** o didático do over/under; **cada mercado ativo tem seção de
ajuda própria com âncora linkável**; **exemplo numérico 3-vias** adicionado (O/U preservado); testes de contrato atualizados;
linguagem leiga preservada. Verde (typecheck+lint+test) + preview Vercel ok.

## Cauda restante do pivot (épico #183 fecha só quando TUDO fechar — diretriz do dono)
- **#173** — 1X2: OPEN só pelo backtest AC#3/#4 (**PAGO**, ≥20 jogos finished c/ odds) — validação data/tempo-gated, não código.
- **#180 / #181** — backlog cravado (D8 CLV / D10 api-football provider; #181 exige ADR antes).
- **Flip do #178** (melhor-aposta, 1 DML) quando o dono quiser ativar — antes rederivar o teto de rate-limit; validar 1 análise flag-on.
- Follow-ups LOW do #175 (out-of-ladder queima 1 call; freshness dedup escada parcial; expandir `OVER_UNDER_ALT.coveredLeagues`).
