# HANDOFF — #243 seções colapsáveis por mercado (match page)

> Continuidade entre sessões (vive em `docs/handoffs/`, versionado — ver o README).
> 3ª da fila pós-pivot (ordem: [[work-order-post-pivot]]). Issue de **FUNDAÇÃO
> estrutural** do match page multi-mercado — **#244/#245 constroem em cima**.
> Depende de #242 (MERGED). Snapshot de 2026-06-16, aterrado no CÓDIGO real.

## O que é
Hoje a match page mostra UMA análise (a mais recente GLOBAL do jogo). Com 2+ mercados,
reanalisar um mercado "sobrescreve" a tela com aquele e esconde os outros. **#243:**
uma **seção colapsável por mercado**, cada uma com a **última análise DAQUELE mercado**;
reanalisar um mercado atualiza **só a seção dele**.

## ⚠️ O corpo do #243 está parcialmente DESATUALIZADO
O issue cita `getLatestPredictionForMatch(...)` (`limit(1)`) como a query atual da
página. **#204 já trocou isso:** a página usa `getPredictionHistoryForMatch` e
`getLatestPredictionForMatch` ficou **PARKADA** (sem caller). Construir contra o estado
REAL abaixo, não contra o corpo do issue.

## Ler primeiro / estado atual do código (pós #204 + #242)
- `gh issue view 243 -R fernandolisboa/palpiteiro-claude` (escopo + 5 ACs).
- `app/match/[id]/page.tsx`: busca `getPredictionHistoryForMatch(matchId, userId)` →
  `latestPred = history[0]`, `previousAnalyses = toPreviousAnalysisItems(history)`.
  Mapeia via `toAnalysisViewFromPrediction` (`lib/view/analysis.ts`). Renderiza
  `AnalysisPanel` (analisável) ou `AnalysisResult` + `PreviousAnalyses` (encerrado),
  em Mobile + Desktop.
- `lib/db/queries/predictions.ts`:
  - **`getPredictionHistoryForMatch`** (#204) → `PredictionWithAiCall[]` (marketKey via
    leftJoin + `selections` batcheadas), `orderBy desc(createdAt), desc(id)`, scoped por
    userId. **#243 pode AGRUPAR isto por `marketId`**: o 1º de cada `marketId` na lista
    já-ordenada = a última daquele mercado. Caminho mais barato (zero query nova). OU
    criar `getLatestPredictionByMarketForMatch` dedicado (window function `DISTINCT ON
    (marketId) ... ORDER BY marketId, createdAt DESC` + índice) se o agrupamento-em-JS
    incomodar. Avaliar; o agrupamento-em-JS é o default lean.
  - `getLatestPredictionForMatch` **PARKADA** (doc-comment marca pro cluster). **Se #243
    consumir o histórico/by-market, DELETAR `getLatestPredictionForMatch` + seu teste
    pglite (`get-latest-prediction.pglite.test.ts`)** — fecha o park.
  - `mapSelectionRow` (helper compartilhado, #242 review) — reusar se criar query nova.
- `components/match-collapsible.tsx`: `MatchCollapsible` (Radix Collapsible, `"use
  client"`, `title`+`meta`+`children`) — **reusar** pra cada seção de mercado.
- `components/analysis-result.tsx` + `analysis-scenarios.tsx`: o `AnalysisResult` é o
  CONTEÚDO de cada seção. **#242 (MERGED):** dentro dele os cenários alternativos já
  ficam num `<details>` nativo **fechado**. ⚠️ **Não deixar a seção-de-mercado E o
  `<details>` ambos fechados por padrão** (a recomendada ficaria a 1 clique, o alt a 2):
  **expandir por padrão** a seção relevante (a mais recente / a reanalisada).
- `components/previous-analyses.tsx` (#204): "análises anteriores" colapsável. Coexiste
  com as seções por-mercado — decidir o encaixe (provável: histórico segue como está,
  abaixo das seções; ou histórico passa a ser POR mercado dentro de cada seção — o
  issue não exige, manter lean).

## Escopo (do #243)
- Query/agrupamento "última por mercado" (preferir reusar `getPredictionHistoryForMatch`).
- Componente `MarketAnalysisSection` reusando `MatchCollapsible`: trigger = `marketLabel`
  + metadados (recomendação/edge/odd); content = `AnalysisResult` daquele mercado.
- Refatorar `app/match/[id]/page.tsx` pra mapear sobre análises POR mercado (em vez de
  `existing` singular no `AnalysisPanel`).
- View: incluir `marketId`/`marketLabel` pra titular seções (`getMarketPresentation(
  marketKey).marketLabel` já existe em `lib/view/markets/presentation.ts`).
- Revalidation: full-page `revalidatePath('/match/[id]')` (já é) — cada seção lê dados
  independentes da query by-market → só a reanalisada muda. Tags por-mercado: opcional.
- Aberto/fechado: expandir a mais recente/reanalisada; estado client `expandedMarkets`
  que NÃO fecha as outras ao reanalisar.

## Como o AnalysisPanel encaixa (landmine)
Hoje `AnalysisPanel` recebe UMA `existing` + faz a reanálise (form + `useActionState` +
`previous`). Com seções por mercado, repensar: o painel de **disparo** (seletor de
mercado/modelo + CTA) vs as **seções de resultado**. Provável: disparo no topo + seções
por-mercado abaixo. **#244** move a reanálise pro rodapé de CADA seção — então #243 deve
deixar cada seção AUTO-CONTIDA o suficiente pra #244 plugar o rodapé, **sem
sobre-construir o #244 aqui**.

## Invioláveis / landmines
- Query escopada por userId (sem cross-user leak). Pinada por teste pglite — manter.
- `marketId`/`selectionId` NULL (predições antigas pré-backfill): tratar graciosamente —
  coalesce `marketKey ?? "over_under"` (como `toAnalysisView`/`toPreviousAnalysisItems`
  já fazem). Decidir o bucket dessas rows e **testar** (AC explícito).
- over/under (produção) idêntico ao atual quando é o ÚNICO mercado.
- Market-agnostic: labels via registry, NUNCA "2.5"/setas O-U hardcoded.
- SEM migration de schema. Se criar índice pra a query by-market, é migration de ÍNDICE
  (justificar no PR) — mas o agrupamento-em-JS sobre `getPredictionHistoryForMatch`
  dispensa índice novo. Preferir o caminho sem migration.
- Lógica em `lib/` (query + agrupamento + view), não no componente.
- CI = GH Actions (typecheck+lint+test). **pglite flaka local em máquina multi-core** —
  validar com `pnpm test -- --no-file-parallelism` ou `--poolOptions.forks.maxForks=2`
  (CI 2-core é verde) — ver [[pglite-suite-high-core-flake]].
- Agentes de review = **read-only no git** (não `git checkout`) — ver
  [[workflow-agents-mutate-checkout]]; re-checar a branch depois.

## Critério de saída (5 ACs do #243)
2+ mercados → seção colapsável por mercado com a última daquele mercado; reanalisar um
mercado atualiza SÓ a seção dele; over/under idêntico quando único; `marketId`/
`selectionId` nulos graciosos; `typecheck`/`lint`/`test` verdes.

## Cluster
#243 → **#244** (rodapé por seção + dropdown de modelo inline + refresh) → **#245**
(seleção multi-mercado de uma vez). Construir modular. Depois: #288 ([[work-order-post-pivot]]).
Visual polish amplo de-slop = **#246, POR ÚLTIMO** (com a skill impeccable).
