# PLAN — #244 reanálise no rodapé de cada seção (dropdown de modelo inline + refresh)

> Plano pré-código. Aterrado no código pós #243 (MERGED, PR #297). Constrói EM CIMA da
> estrutura de seções por mercado. Ler junto: issue #244, HANDOFF-243, PLAN-243.

## O que muda (resumo)
Hoje o disparo de reanálise + dropdown de modelo vivem no TOPO do `AnalysisPanel` (um
único `useActionState` por jogo). #244 **move a afordância pro RODAPÉ de CADA seção**:
cada seção vira **auto-dispatching** (form + `useActionState` próprios), com footer =
"análise feita com modelo X" + `ModelOverrideSelect` inline + botão refresh (`RefreshCcw`).
Reanalisar uma seção atualiza só ela; o modelo escolhido persiste; sem botão de
reanálise duplicado no topo.

## Contratos confirmados (pós-exploração)
- `analyzeMatch(formData)` lê `matchId`, `marketKey`, `modelOverride` do FormData
  (`app/actions/predictions.ts:77,138,167`). `ModelOverrideSelect` = `<select
  name="modelOverride">`; `MarketSelect` = `<select name="marketKey">` (submetem nativo).
- `prediction.modelVersion` É um `AIModelId` (`lib/ai/models.ts:11`); `view.model` =
  `formatModelName(modelVersion)` (display). Pra semear o dropdown da seção do modelo
  que rodou, preciso do `modelVersion` CRU por seção.
- `initialModelOverride(modelId, selectableModels)` (#239) já faz: se `modelId` é
  selecionável → semeia ele; senão → "default". **Reuso direto** passando o
  `modelVersion` da análise (em vez da preferência) = AC "semear do modelo que rodou".
- `AnalyzeCTA` (pending steps / "Analisar com IA"), `AnalysisErrorCard`, `MatchCollapsible`
  inalterados.

## Decisão de arquitetura
Dois dispatchers, separados por PROPÓSITO (sem afordância duplicada):
1. **Rodapé por seção** (reanálise de mercado JÁ analisado): cada seção = form +
   `useActionState` próprios. Footer: label + `ModelOverrideSelect` + refresh. Overlay
   de pending na própria seção. Isolado.
2. **Topo "nova análise"** (mercado AINDA NÃO analisado / 1ª análise): só renderiza
   quando há `unanalyzedMarkets = selectableMarkets − mercados-com-seção` não-vazio.
   `MarketSelect`(unanalyzed, se >1) + `ModelOverrideSelect`(se houver) + `AnalyzeCTA`.
   Preserva analisar um mercado novo sem reintroduzir o botão de reanálise no topo.
   Produção (over/under único): sem análise → só `AnalyzeCTA`; com a seção → some.

### Persistência do modelo por seção SEM resync (chave)
Reanálise bem-sucedida → nova `predictions.id` → a **key=id da seção muda** → React
**remonta** a seção → ela re-semeia de `initialModelOverride(novaAnálise.modelVersion,…)`.
Como a reanálise rodou com o modelo escolhido, `novaAnálise.modelVersion` = o escolhido →
o dropdown reabre nele. **Persistência automática via remount+seed**, sem
`resyncModelOverride` (que o #239 precisou porque o painel NÃO remontava). No caminho de
ERRO (sem nova predição, sem remount) o `useState` local preserva a escolha naturalmente.

## Mudanças por arquivo

### `lib/view/analysis.ts` + `lib/view/types.ts`
- `MarketAnalysisSectionItem` ganha **`modelId: string`** (= `row.prediction.modelVersion`,
  cru) pra semear o dropdown da seção. (NÃO mexer em `AnalysisView`.)
- `toMarketAnalysisSections` popula `modelId: row.prediction.modelVersion`.

### `components/market-analysis-section.tsx`
- A seção vira **client** (`useActionState` no footer quando analisável). Props novas:
  `analyzable`, `matchId`, `marketKey`, `modelId`, `selectableModels`, `defaultModelLabel`.
- Conteúdo (usado bare em ≤1 e dentro do collapsible em ≥2):
  `analyzable` → `<form action={formAction}>`(hidden matchId + hidden marketKey +
  `<AnalysisResult again={false}>` com overlay de pending + footer-rodapé) ;
  senão (encerrado) → `<AnalysisResult again={false}>` read-only (sem form).
- Footer-rodapé (analisável): label "análise feita com modelo {view.model}" +
  `ModelOverrideSelect`(se `selectableModels.length`) inline + `Button submit`
  (`RefreshCcw`, "Analisar de novo"). Estado: `useState(initialModelOverride(modelId,
  selectableModels))`.
- `MarketAnalysisSections({ sections, analyzable, matchId, selectableModels,
  defaultModelLabel })`: ≤1 → conteúdo bare; ≥2 → `MatchCollapsible` por seção
  (key=s.id, defaultOpen={i===0}). Passa os props de dispatch quando `analyzable`.

### `components/analysis-panel.tsx`
- Vira ORQUESTRADOR: NÃO tem mais `useActionState` próprio pra reanálise. Renderiza:
  (1) **NewAnalysisForm** no topo só se `unanalyzedMarkets.length > 0` (novo
  sub-componente OU form inline com `useActionState`): `MarketSelect`(unanalyzed) +
  `ModelOverrideSelect` + `AnalyzeCTA`/erro/NoOddsHint; (2) `MarketAnalysisSections`
  analisável; (3) `PreviousAnalyses` (sem o hide-durante-pending global — pending agora
  é por seção). 
- Remove a lógica de `again={!hasControls}`, `view && hasControls`, overlay inline single
  (migra pro footer da seção).

### `app/match/[id]/page.tsx`
- Caminho encerrado: `<MarketAnalysisSections sections analyzable={false} …/>` (read-only,
  sem footer). Caminho analisável: `<AnalysisPanel …/>` ganha os props p/ dispatch
  (selectableModels/defaultModelLabel/matchId já passam).

### `components/analysis-result.tsx` (DECISÃO ABERTA — ver abaixo)
- Após #244 nenhum caller passa `again={true}` (o botão migrou pro footer da seção).
  Opção A: deixar `again` como está (morto, defensivo). Opção B: remover o branch
  `again` + a prop (limpa dead code, toca best-bet/previous/testes). **Plan-review decide.**

## Decisões abertas p/ o plan-review
1. **Top "nova análise" filtrado a unanalyzedMarkets** (preserva analisar mercado novo)
   vs **remover topo inteiro** (regride admin multi-mercado). Lean recomendado: filtrar.
2. **Persistência via remount+seed** (sem resync) — confirmar que o remount SEMPRE ocorre
   no sucesso (nova predições.id) e que o seed-from-analysis-model satisfaz o AC.
3. **`again` em AnalysisResult**: remover (limpa) vs manter (defensivo). Blast radius?
4. **MarketAnalysisSection client + read-only no caminho encerrado** (envia código de
   dispatch ao client mesmo em jogo encerrado) vs split read-only isomórfico. Custo real?
5. Footer label "análise feita com modelo X" coexiste com a linha `promptVersion · model`
   do AnalysisResult (redundância de modelo) — aceitável p/ #244 (polish = #246)?
6. **NewAnalysisForm**: componente novo vs form inline no painel. Onde mora o
   `useActionState` do "nova análise"?

## Testes
- `lib/view/analysis.test.ts`: `toMarketAnalysisSections` popula `modelId` (= modelVersion).
- `components/__tests__/market-analysis-section.test.tsx`: footer analisável renderiza
  label "análise feita com modelo X" + dropdown (admin) / sem dropdown (regular) + refresh;
  seed do dropdown = modelId da análise; read-only (analyzable=false) NÃO renderiza footer.
- `components/__tests__/analysis-panel.test.tsx`: top "nova análise" só aparece com
  unanalyzedMarkets; sem botão de reanálise no topo quando há seção; B3 segue (sem
  state.view duplicado — agora por seção).
- Persistência: testar `initialModelOverride(modelVersion, …)` semeia o modelo que rodou.

## Critério de saída (5 ACs do #244)
Footer por seção (label + dropdown + refresh) alinhado; trocar modelo + reanalisar usa
aquele modelo e atualiza só aquela seção; modelo persiste pós-reanálise; sem botão de
reanálise duplicado no topo; typecheck/lint/test verdes.

## Resolução pós plan-review (4 lentes + síntese) — SUPERSEDE as decisões abertas

**Fato que desempata:** `again={!hasControls}` (`analysis-panel.tsx:204,218`) é o gatilho
de reanálise VIVO do usuário regular em produção (≤1 mercado, `selectableModels=[]` →
`hasControls=false` → `again=true` → botão no rodapé do `AnalysisResult`). #244 **migra**
esse gatilho pro footer da seção; remover `again` é o passo final (mesmo PR), só depois
do footer novo dominar a reanálise em ≤1 E ≥2 (senão há duas afordâncias).

**Persistência (refino sobre a síntese):** **key da seção = `marketKey`, NÃO
`predictions.id`.** #244 reanalisa de DENTRO da seção (já aberta), então o "remontar p/
reabrir" do #243 fica obsoleto. Com key=`marketKey` a seção **não remonta** na reanálise
→ o `useState` do dropdown do footer **persiste a escolha do usuário** (inclusive o
sentinel `"default"`, resolvendo B3) sem depender de remount. Seed inicial (fresh load) =
`initialModelOverride(modelId, selectableModels)` = o modelo que rodou (AC "semear do
modelo que rodou"). Espelhar o padrão do painel (`seededOverride` ref + `resyncModelOverride`)
por seção — provado no #239, barato, defende o success+error path. Novos mercados (key
nova) montam fresh + abrem (`defaultOpen={i===0}`).

**Blockers resolvidos:**
- **B4/B5:** `MarketAnalysisSectionItem` ganha `marketKey: string` (hidden input do form +
  React key) e `modelId: string` (= `prediction.modelVersion`, seed). Atualizar 2 fixtures
  (`analysis-panel.test.tsx` OU/MR, `market-analysis-section.test.tsx` factory `item()`) +
  +1 assertion no `analysis.test.ts` (mkRow já dá `modelVersion`).
- **Decisão 4:** **split** — `SectionFooterDispatch` (client, `useActionState`) montado SÓ
  quando `analyzable`; o caminho read-only (jogo encerrado, render de Server Component)
  monta zero hooks. `MarketAnalysisSection` continua isomórfico, escolhe dispatch vs
  read-only.
- **Decisão 6:** **`NewAnalysisForm`** (client) próprio: `useActionState` + `MarketSelect`
  (unanalyzedMarkets, single-select) + `ModelOverrideSelect` + `AnalyzeCTA`. Renderiza só
  se `unanalyzedMarkets.length>0`. Produção: 0 análises → CTA solo; 1 análise → some.
- **Decisão 1:** topo filtrado a `unanalyzedMarkets = selectableMarkets − mercados-com-seção`
  (preserva analisar mercado novo; some sozinho).
- **Decisão 3:** **remover `again` end-to-end** no mesmo PR (após footer dominar reanálise):
  `analysis-result.tsx` (prop+FooterProps+bloco+import RefreshCcw), `market-analysis-section`,
  `analysis-panel`, `previous-analyses.tsx:29`, `best-bet-results.tsx:144`, `page.tsx`.
- **Decisão 5:** label "análise feita com modelo X" (de `view.model`, display) coexiste com
  `promptVersion·model` — redundância aceita p/ #244; de-slop é #246. Pinar a grafia no teste.
- **B3 por seção:** o `SectionFooterDispatch` renderiza `state.ok ? state.view : view`
  (como o single-mode antigo) — UMA seção renderiza UM resultado, sem duplicação (o B3 do
  painel era sobre painel+seções renderizando o mesmo mercado; por-seção não há). Pinar
  "racional aparece 1×".

**Três grafias do modelo (não confundir nos testes):** label do footer = `view.model`
(`formatModelName` → "claude-sonnet-4.5"); seed do `<select>` = id cru
("claude-sonnet-4-5-20250929"); `selectableModels[].label` = `MODEL_REGISTRY.label`
("Sonnet 4.5").

## Fora de escopo
Seções colapsáveis em si (#243, feito); seleção/disparo multi-mercado simultâneo (#245);
polish visual amplo / de-slop (#246).
