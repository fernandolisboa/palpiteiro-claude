# PLAN — #243 seções colapsáveis por mercado (match page)

> Plano de implementação (pré-código). Aterrado no código pós #204+#242.
> Ler junto: `docs/handoffs/HANDOFF-243.md`. Snapshot 2026-06-16.

## Decisão de arquitetura (o núcleo)

Hoje a página mostra **uma** análise (history[0], a mais recente GLOBAL). #243:
**uma seção por mercado**, cada uma com a **última análise daquele mercado**.

Caminho lean escolhido (zero query nova, zero migration): **agrupar
`getPredictionHistoryForMatch` (já desc(createdAt)) por `marketKey ?? "over_under"`
em JS** — o 1º de cada key = a última daquele mercado.

### Identidade de mercado por seção
`AnalysisView.recommendation` já tem `marketKey`/`marketLabel`, mas é `null` em
**pass**. Seções precisam de identidade mesmo em pass → **adicionar `marketKey` +
`marketLabel` no TOPO de `AnalysisView`** (populados de `presentation.*`, já
computado em `toAnalysisView`).

### "Expandir a reanalisada sem fechar as outras" SEM estado controlado
Cada seção = `MatchCollapsible` **não-controlado** (`defaultOpen`), com **React key
= `predictions.id`**:
- `defaultOpen={i === 0}` → a mais recente (1ª da lista) abre por padrão. Resolve o
  landmine #242 (recomendação fica visível, não a 2 cliques).
- Reanalisar mercado X → nova `predictions.id` → a key da seção X muda → React
  **remonta** só a seção X, que reaparece no índice 0 com `defaultOpen=true` (abre).
  As outras seções (key inalterada) **persistem** estado aberto/fechado.
- Dispensa `expandedMarkets` controlado. Mais simples, satisfaz os 2 requisitos.

### Por que NÃO regride produção (over/under único)
- `sections.length <= 1` → renderiza o **`AnalysisResult` cru** (sem chrome de
  collapsible), byte-idêntico ao atual. Chrome de seção só entra com ≥2 mercados.
- `toPreviousAnalysisItems` passa de `history.slice(1)` para "tudo MENOS o 1º de cada
  mercado" → com 1 mercado é exatamente `slice(1)` (idêntico); com N mercados, exclui
  os N latests (que viraram seções), sem duplicar.

## Mudanças por arquivo

### `lib/view/types.ts`
- `AnalysisView`: **+`marketKey: string`** e **+`marketLabel: string`** (topo).
- Novo tipo `MarketAnalysisSectionItem = { id: string; view: AnalysisView }`
  (`id` = predictions.id — key estável + remount-on-reanalyze).

### `lib/view/analysis.ts`
- `toAnalysisView`: incluir no return `marketKey: presentation.marketKey` +
  `marketLabel: presentation.marketLabel` (presentation já existe na fn).
- **Novo** `toMarketAnalysisSections(history, now?) => MarketAnalysisSectionItem[]`:
  agrupa por `marketKey ?? "over_under"`, 1º de cada = última, ordem = primeira-vista
  em desc(createdAt) (= mercado mais recentemente analisado primeiro).
- `toPreviousAnalysisItems`: de `slice(1)` → pula o 1º de cada mercado (os que viram
  seção); mantém os demais. Single-market continua = slice(1).
- Atualizar comentário linha ~393 (remover menção a `getLatestPredictionForMatch`).

### `lib/db/queries/predictions.ts`
- **DELETAR** `getLatestPredictionForMatch` (parkada, zero caller de produção;
  confirmado por grep). Manter `mapSelectionRow` (ainda usado por history). Ajustar o
  doc-comment de `mapSelectionRow` (remover menção a getLatest).
- **DELETAR** `lib/db/queries/__tests__/get-latest-prediction.pglite.test.ts` (único
  arquivo que referencia a fn). Fecha o park.
- ZERO query nova, ZERO migration.

### `components/market-analysis-section.tsx` (NOVO, isomórfico — sem "use client")
- `MarketAnalysisSection({ view, defaultOpen?, again? })`: `MatchCollapsible`
  (title=`view.marketLabel`, meta=resumo) → `AnalysisResult view again`.
  - meta market-agnostic: recomendação → `${outcomeRecomendado.label} · ${oddAtRec}`;
    pass → `"sem aposta"`. (label vem do registry, nunca "2.5" hardcoded.)
- `MarketAnalysisSections({ sections, again })`: ≤1 → `AnalysisResult` cru;
  ≥2 → `sections.map((s,i) => <MarketAnalysisSection key={s.id} defaultOpen={i===0} …/>)`.
  Usado no caminho ENCERRADO (page) e no caminho MULTI dentro do painel.

### `components/analysis-panel.tsx`
- Prop `existing: AnalysisView | null` → **`sections: MarketAnalysisSectionItem[]`**.
  Deriva `existing = sections[0]?.view ?? null` (useActionState seed + single-mode);
  `isMulti = sections.length >= 2`.
- Toda a lógica de controles/CTA/model-override/market-select/pending/error/previous:
  **inalterada**.
- Bloco de resultado: `isMulti` →
  `{pending && <indicador>}` + `{errorMsg && <AnalysisErrorCard/>}` +
  `<MarketAnalysisSections sections again={false}/>` (dispatch fica nos controles do
  topo; seções read-only — #244 pluga rodapé por seção depois).
  Caso contrário (≤1): caminho de HOJE intacto (overlay pending + `AnalysisResult
  again={!hasControls}`).
- Em multi, durante pending o botão "Analisar de novo" já fica disabled+"Reanalisando…";
  seções permanecem visíveis (stale) e atualizam via revalidatePath. (Overlay por
  seção é #244.)

### `app/match/[id]/page.tsx`
- `sections = toMarketAnalysisSections(history)`; `previousAnalyses =
  toPreviousAnalysisItems(history)` (agora exclui os latests por mercado).
- `Common.analysisExisting: AnalysisView | null` → `sections:
  MarketAnalysisSectionItem[]`. `latestPred` segue p/ hero (`hasPrediction`).
- Analisável: `<AnalysisPanel sections={sections} previous={previousAnalyses} …/>`.
- Encerrado/cancelado: `sections.length > 0 ? (<div><MarketAnalysisSections
  sections again={false}/><PreviousAnalyses items={previousAnalyses}/></div>) :
  <FinishedNotice/>`.

## Revalidation
Full-page `revalidatePath('/match/[id]')` (já é). Cada render relê o histórico →
agrupa por mercado → só o mercado reanalisado mudou de conteúdo. Sem tags por mercado
(opcional/#244). Confiável: Next re-renderiza server + reconcilia props no client sem
remontar o painel; só a seção com `id` novo remonta.

## Testes
- `lib/view/analysis.test.ts` (+): `toMarketAnalysisSections` (agrupa por mercado,
  latest-por-mercado, ordem mais-recente-1º, **null marketId → bucket over_under**,
  single-market → 1 seção); `toPreviousAnalysisItems` (exclui latests por mercado;
  single-market = slice(1)); `marketKey`/`marketLabel` no topo (incl. pass).
- `components/__tests__/market-analysis-section.test.tsx` (NOVO): título=marketLabel,
  meta (rec vs "sem aposta"), market-agnostic, AnalysisResult dentro. Plural: ≤1 cru,
  ≥2 colapsável + defaultOpen no 1º.
- Atualizar fixtures de `AnalysisView` (novos campos obrigatórios): grep
  `AnalysisView` em testes (`analysis-result.test.tsx`, `best-bet-results.*`,
  `predictions.test.ts` se aplicável).
- DELETAR `get-latest-prediction.pglite.test.ts`.
- Gate flake pglite local multi-core: `pnpm test -- --no-file-parallelism`.

## Critério de saída (5 ACs)
1. ≥2 mercados → seção colapsável por mercado com a última daquele mercado. ✓ sections.
2. Reanalisar 1 mercado atualiza SÓ a seção dele. ✓ agrupamento + revalidate + key=id.
3. over/under único = idêntico ao atual. ✓ branch ≤1 = AnalysisResult cru + slice(1).
4. marketId/selectionId nulos graciosos. ✓ coalesce over_under + pass meta + teste.
5. typecheck/lint/test verdes.

## Ajustes pós plan-review (4 lentes + síntese)

- **B1 — NÃO mexer em `AnalysisView`.** Espelhar o padrão sibling já no repo
  (`PreviousAnalysisItem`, `BestBetEntry`): `MarketAnalysisSectionItem = { id;
  marketLabel; view }`. Elimina TODA a churn de fixtures (os 4 `toEqual` de shape em
  `analysis.test.ts:45/136/224/296` ficam verdes). marketLabel vem de
  `getMarketPresentation(marketKey ?? "over_under").marketLabel` (igual ao :438).
- **B3 — multi-mode NÃO renderiza `state.view`.** As seções vêm SÓ de props
  (refrescadas por revalidatePath). `useActionState` fica só p/ pending/error + seed
  single-mode. Comentar o invariante p/ #244 não reintroduzir leitura de `state.view`.
- **B4 — agrupar pela key COALESCED** `row.marketKey ?? "over_under"` (nunca a nullable
  crua). Teste AC4 = **count de seções === 1** p/ mix `[null-market, over_under]`
  (latest vence dentro do bucket).
- **C1/C2 — testar o mecanismo no nível de view** (mercado reanalisado → índice 0 + id
  novo); a remontagem/abre-a-reanalisada é consequência de React + `key=id` (semântica
  documentada, não testada interativamente). Reabrir uma seção que o user colapsou ao
  reanalisá-la é INTENCIONAL (HANDOFF:44-45).
- **C4 — corrigir os 4 comentários** com menção stale a `getLatestPredictionForMatch`:
  `predictions.ts:52`, `predictions.ts:125`, `app/match/[id]/page.tsx:94`,
  `analysis.ts:393`.
- **C5 — meta da seção** = `view.recommendation?.selectionLabel` (+ `line` quando ≠
  null) + ` · ${view.oddAtRec}`; pass → `"sem aposta"`. NÃO varrer `view.outcomes`
  (vazio no caminho AC4-degradado).
- **Rewrite** do teste `analysis.test.ts:1192-1205` (`toPreviousAnalysisItems`
  market-agnostic): sob a nova exclusão-do-1º-por-mercado o resultado muda de 3→2
  itens — reescrever a expectativa (era comportamental, não fixture).

## Fora de escopo (NÃO sobre-construir)
- Rodapé de reanálise por seção / dropdown de modelo inline → **#244**.
- Seleção multi-mercado de uma vez → **#245**.
- Overlay de pending por seção, tags de cache por mercado → #244.
- Polish visual amplo → #246 (impeccable, por último).
