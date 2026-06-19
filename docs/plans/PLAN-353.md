# PLAN-353 — Passo de síntese: análises multi-mercado → palpite-manchete

> Plano de implementação pré-issue (snapshot histórico, v2 pós plan-gate de 3 lentes).
> Aterrado no código real (exploração + verificação 2026-06-19). Fonte viva: ADR 0030
> (#349) + issue #353.

## Objetivo (escopo de #353 — o "spine" do palpite-first)

Adicionar **o último passo** do palpite-first: depois que o fan-out já roda
(`runFanOut` → `FanOutOutcome[]`, `lib/ai/best-bet.ts:64-88`), uma **síntese** sobre as
N análises produz o **palpite-manchete** — veredito "quem ganha" + placar provável +
confiança qualitativa + narrativa + mercados citados. Validado por Zod, roteado pelo
seam de IA (loga `ai_calls`), persistido em `palpite_sets`/`palpites` (badge liquidável
preservado), e **retornado** por `analyzeBestBet` p/ o #351 renderizar o HERO. **Edge/EV/
stake/Yield consumidos no DADO, NUNCA na manchete.**

**NÃO é #353:** o HERO impecável + recolhível + reorder dos dois branches (= #351).
**NÃO reconstruir o fan-out** — já existe e roda.
**#353 é BACKEND-ONLY** (decisão do gate): em prod a flag `enableBestBetFanOut` é **OFF**
por default (`ai-config.ts:78`) e `analyzeBestBet` retorna "Recurso indisponível" antes de
qualquer spend (`predictions.ts:356-359`) — a síntese ships **dark**. O único efeito
prod-visível é dropar o auto-run (`PalpitesPanel` fica vazio até #351). Não construir UI
nova que o #351 vai jogar fora.

## Decisão central

A síntese **requer** predictions → só existe **depois** do fan-out. Logo o auto-run
pré-análise (#315) e o regen pré-análise (market-free) são incompatíveis com a síntese e
**caem** (ADR 0030 §5). A síntese roda **dentro** do `analyzeBestBet` (mesmo run, mesmo
slot de rate-limit 20/dia, `predictions.ts:394-414`), sobre o `FanOutOutcome[]` **em
memória** — sem re-query de DB (não há run-id; re-fetch por janela de `createdAt` é frágil).

## Forks resolvidos (pós-gate)

- **A — Projeção de entrada.** Helper puro `summarizeAnalysesForSynthesis(outcomes: FanOutOutcome[]): MarketAnalysisSummary[]` em `lib/ai/palpites/synthesis-input.ts` (camada `lib/ai`; **não** puxar `toBestBetView` de `lib/view` — inverteria a dependência). Filtra `ok`, **lê os campos PERSISTIDOS** `prediction.edgePct/confidencePct/oddAtRecommendation` com `Number()` (drizzle→string; NÃO re-derivar com `computeMarketScenarios` — evita divergência), trata `pass` (edge/odd null, `isPass`). Cada item: `{marketKey, marketLabel, recommendation (selectionKey|'pass'), recommendedLabel?, isPass, modelProbPct, edgePct, confidencePct, oddAtRecommendation, rationale, predictionId, selections:[{key,label?,modelProbPct}]}`. `predictionId` viaja junto (proveniência, Fork D).
- **B — Cartucho.** Re-significar o `palpitesCartridge` (bump `palpites_v1` → **`palpites_v2`**, commit `prompt:`, ADR 0017). NÃO um segundo cartucho. `getPalpiteCartridge()` segue retornando um. **Blast radius do bump** (mexer em lockstep): `registry.ts:14-19` (generic concreto `PalpitesOutput` → novo tipo), `index.ts:235` (binding `output:`), `cartridge.ts:20` (versão), `cartridge.test.ts` (pin de versão+schema).
- **C — Output/taxonomia.**
  ```
  PalpiteSynthesisOutput = {            // .strict() — exclui chaves de valor estruturalmente
    verdict: string,                    // "Vai dar Palmeiras" (veredito/opinião)
    probableScore: { home: int 0..20, away: int 0..20 },  // → linha exact_score (settleable, o badge)
    confidence: 'baixa' | 'media' | 'alta',  // QUALITATIVO (não %)
    narrative: string,                  // prosa SEM linguagem de valor (truncado, não rejeitado)
    citedMarkets: string[],             // rótulos citados ("Resultado", "Mais de 2.5")
  }
  ```
  Sem novo tipo settleable → gate Tier 3 de pé (CLAUDE.md "O que NÃO fazer"; ADRs 0015/0016/0025/0028). `exact_score` segue o ÚNICO settleable. As linhas fun `red_card`/`corners` **deixam de ser geradas**; os valores do enum **permanecem** (sem migration de remoção; #350/#354 podem usar). O `SYSTEM_PROMPT`, o tool `SUBMIT_*` e o `buildUserMessage` são **reescritos p/ headline-only** (não basta trocar o output schema — o prompt v1 exige "1 exact_score + 1-3 fun", contradição se não purgado). **Caso all-pass:** o prompt instrui explicitamente "mesmo sem valor em nenhum mercado, dê seu palpite honesto de quem ganha + placar provável a partir de forma/tabela".
- **D — Persistência da manchete.** Coluna **aditiva nullable** `headline jsonb` em `palpite_sets` via `.$type<{verdict; confidence; narrative; citedMarkets; sourcePredictionIds: string[]}>()` (precedente: `schema.ts:293/371/441/477/505`; aditiva-nullable = "preserva integralmente" ADR §4; auto-flui p/ `$inferSelect`/`PalpiteGenerationResult.palpiteSet`). `sourcePredictionIds` vem de graça (`FanOutOutcome[].result.prediction.id`). Migration via `pnpm db:generate` (NUNCA hand-number; conferir `.sql`). **`sourcePredictionIds` é trim-if-friction** (não está no critério de saída do #353).
- **E — Contrato de retorno (NULLABLE).** `AnalyzeBestBetResult` sucesso vira `{ok:true; view: BestBetView; palpite: PalpiteHeadlineView | null}`. **Nullable é load-bearing**: a síntese (Haiku) roda DEPOIS de até 6 `predict()` pagos; se ela falhar, o fan-out pago **não** pode ser descartado. `PalpiteHeadlineView` (novo em `lib/view`) = `{verdict, probableScore, confidence, narrative, citedMarkets, badge?: 'won'|'lost'|null}` — **zero número de valor**. Mapper `toPalpiteHeadlineView` espelha o descarte de `palpites.ts:79`. Consumidor único hoje: `best-bet-panel.tsx` (aditivo).
- **F — UI: ZERO UI nova (decisão do gate, lente 3).** #353 não constrói HERO nem "render mínimo" (flag OFF em prod ⇒ síntese nem roda; #351 reescreve tudo ⇒ churn). #353 só faz o **teardown** do pré-análise: dropar `generatePalpitesAction`+`PalpiteAutoRun` e `regeneratePalpitesAction`+`RegenButton`; `PalpitesPanel` fica (sem RegenButton) lendo `getPalpiteSetsForMatch` → empty-state-capable nos dois branches. #351 reescreve o panel em HERO + wira o `palpite` retornado.

## Blockers do gate — resoluções (todos endereçados)

1. **Idempotência (#353 "idempotente por matchId/userId/geração").** Leitura adotada: **"geração" = cada run iniciado pelo usuário** (cada clique em "Analisar" = nova geração ⇒ novo `palpite_set`, semântica de regen, sets imutáveis newest-first). "Idempotente" = dentro de UM run (sem double-write em StrictMode/double-submit) — o `analyzeBestBet` já é 1-slot-por-run server-side. **Documentar essa leitura** e alinhar o critério de aceite. (Sem `unique(matchId,userId)`; não adicionar.)
2. **Settlement multi-set (always-write expõe N badges/jogo).** O guard SELECT-then-skip caía junto com o auto-run, então cada run grava um `palpite_set` com uma linha `exact_score`; `getPendingPalpiteSettlements` (`palpites.ts:128-155`) hoje settla TODAS sem dedup → N badges/jogo. **Fix:** restringir a settlement à **última geração por (matchId,userId)** — `NOT EXISTS (palpite_set mais novo p/ o mesmo match,user)` na query pendente. **Teste:** 2+ sets/jogo → só o mais novo settla. (Mantém paridade com o display, que já mostra `sets[0]`.)
3. **`regeneratePalpitesAction` quebra typecheck** quando `analyses` vira required. **Fix:** dropar `regeneratePalpitesAction` + `RegenButton` + uso em `PalpitesPanel` (regen pré-análise market-free contradiz ADR §5). `analyses` é **required** em `GeneratePalpiteArgs`.
4. **Síntese throw escapa do `analyzeBestBet` e descarta o fan-out pago.** `analyzeBestBet` não tem try/catch externo; `generatePalpites` THROWA em todo path de erro (`index.ts:158/179/207/229/302`). **Fix:** `try/catch` em volta da síntese DENTRO do `analyzeBestBet` → on failure: `log` + retorna `{ok:true, view, palpite:null}`. Espelha a assimetria já existente (ai_call pode falhar sem afundar o set, `index.ts:262-274`). **Teste:** síntese throwa → view ainda retorna.
5. **Firewall de texto-livre (`.strict()` só barra chaves extras, não conteúdo de string).** O LLM é ALIMENTADO com edge → pode ecoar "valor esperado/odd 1.85" em `verdict`/`narrative`. **Fix:** guard de conteúdo `containsValueLanguage(text)` (`lib/ai/palpites/value-language-guard.ts`) — regex word-boundary p/ os termos do ADR §3: `edge`, `EV`/`valor esperado`/`expected value`, `stake`/`unidades`, `yield`, `lucro`/`profit`, `odd`/`odds`/`cotação`, `R$`. Rodado no generator pós-Zod sobre `verdict`+`narrative`; on hit → trata como `invalid_output` (path auditado existente) → throw → cai no try/catch do #4 → `palpite:null`. (Rejeitar > vazar; degradação graciosa.) **Testes:** alimentar value-language e provar que é barrado; + guard estrutural no `headline jsonb` e no `PalpiteHeadlineView` (sem chave de valor), espelhando `palpites.ts:79`.

## Concerns do gate — decisões

- **`previousSets` dropado** do path de síntese (exclusion-context só fazia sentido p/ regen; headline DERIVA das análises). `GeneratePalpiteArgs` = `{matchId, userId, analyses, modelOverride?}`. Resolve também "previousSets não está em escopo no analyzeBestBet".
- **Manter o fetch do `SportsDataProvider`** (form/h2h/standings) como cor narrativa — crucial no caso all-pass (verdict apoia em forma/tabela). Cache agressivo (fan-out já aqueceu) ⇒ latência marginal.
- **Vercel maxDuration**: verificar na implementação se fan-out(6 serial)+síntese(1 Haiku) cabe; o try/catch+nullable já degrada sob pressão de timeout. Não-blocker.
- **Casualidades de teste (enumeradas, esperar CI vermelho até reescrever):** `cartridge.test.ts` (schema+`palpites_v1`), `generate-palpites.test.ts` (mix 2-4 linhas + `palpites_v1`), `generate-palpites.pglite.test.ts` (3 linhas), `palpites.pglite.test.ts` (blocos de auto-run/regen/idempotência/concorrência — deletados com as actions).

## Passos de implementação

1. `lib/ai/palpites/synthesis-input.ts` + teste: `summarizeAnalysesForSynthesis` + tipo `MarketAnalysisSummary` (Fork A; lê campos persistidos `Number()`'d; trata pass).
2. `cartridge.ts` → **v2**: `PalpitesInputSchema` ganha `analyses` (+ mantém form/h2h/standings); `PalpitesOutputSchema` = `PalpiteSynthesisOutput` `.strict()`; `SYSTEM_PROMPT`+tool+`buildUserMessage` reescritos headline-only (incl. all-pass); `BuildPalpitesInputArgs` ganha `analyses`; `buildPredictionInput` mapeia; `PALPITES_VERSION='palpites_v2'`. Dropar `excludedScores`/`buildExclusions`.
3. `value-language-guard.ts` + teste (Fork/blocker #5).
4. `index.ts`: `GeneratePalpiteArgs` = `{matchId,userId,analyses,modelOverride?}` (drop previousSets); thread `analyses` p/ `buildPredictionInput`; guard de value-language pós-Zod; **persist reescrito** — 12b: `palpite_set` com `headline` jsonb; 12c: UMA linha `palpites` `type='exact_score'`, `params=probableScore` (validar via `ExactScoreParamsSchema`), `settleable=deriveSettleable('exact_score')`, `text` = label derivado de `verdict`+placar (sem `output.palpites[]`; trocar o loop). Atualizar `registry.ts` generic + `index.ts:235` binding.
4b. Migration: `pnpm db:generate` → `headline jsonb` em `palpite_sets`. Conferir `.sql` (aditiva).
5. `predictions.ts` `analyzeBestBet`: após `runFanOut` + guard de ≥1 sucesso (`entries.length===0` já retorna `ok:false`), `summarizeAnalysesForSynthesis(outcomes)` → **try/catch** `generatePalpites({matchId,userId,analyses,modelOverride})` → `toPalpiteHeadlineView` → return `{ok:true,view,palpite}` (ou `palpite:null` on throw). Haiku.
6. `lib/view/`: `PalpiteHeadlineView` + `toPalpiteHeadlineView` (sem número de valor) + teste-guard.
7. **Teardown**: deletar `generatePalpitesAction`,`regeneratePalpitesAction` (`palpites.ts`), `palpite-auto-run.tsx`, `regen-button.tsx`; remover `PalpiteAutoRun` mount+import (`page.tsx:15,187`); remover `RegenButton` de `palpites-panel.tsx`. Manter `getPalpiteSetsForMatch` (panel + #351).
8. **Settlement latest-only** (`palpites.ts` query) + teste 2-sets (blocker #2).
9. **Testes** (novos + reescritos): synthesis-input; cartridge v2 (aceita headline; `.strict()` rejeita chave de valor; enum de confiança; not red_card/corners; all-pass); value-language guard; generator (mock seam+db: input tem analyses, ai_calls logado, set com headline + 1 linha exact_score settleable, output sem value-language); analyzeBestBet wiring (síntese chamada; throw→view sobrevive+palpite null); view guard; settlement latest-only. `pnpm test --no-file-parallelism`.
10. **Doc nit (opcional, no mesmo PR):** corrigir a citação "ADR 0025" → cluster Tier-3 onde fizer sentido (0025 É válido — título é "settlement Tier 3"; precisão, não blocker).

## Critério de saída (#353)

Síntese tipada/validada por Zod produz a manchete a partir do `FanOutOutcome[]`; passa pelo
seam (loga `ai_calls`); persiste set+linha settleable+headline; `analyzeBestBet` retorna
`palpite` (nullable, degrada em falha sem afundar o fan-out); firewall testado (estrutural
+ guard de conteúdo; zero número de valor na manchete); settlement só na última geração;
migration aditiva conferida; `pnpm typecheck && pnpm lint && pnpm test` verdes.

## Landmines

Drizzle numeric→string (`Number()` no boundary); `FanOutOutcome[]` inclui falhas+pass;
firewall = APRESENTAÇÃO (edge no dado OK, na manchete NUNCA); seam é a única porta da LLM,
sem SDK direto; neon-http sem `db.transaction` (inserts sequenciais); migration via
`db:generate`; bump de versão de cartucho (commit `prompt:`); Tier 3 de pé.

## Apêndice do implementador (shapes concretos — confirmar bytes ao codar)

```ts
// lib/ai/palpites/synthesis-input.ts
export type MarketAnalysisSummary = {
  marketKey: string;
  marketLabel: string;             // do market descriptor (não de lib/view)
  recommendation: string;          // selectionKey OU 'pass'
  recommendedLabel: string | null; // rótulo legível da seleção recomendada
  isPass: boolean;
  modelProbPct: number | null;     // da seleção recomendada (Number()'d)
  edgePct: number | null;          // prediction.edgePct PERSISTIDO, Number()'d (null em pass) — DADO, não vai p/ manchete
  confidencePct: number | null;    // prediction.confidencePct, Number()'d
  oddAtRecommendation: number | null;
  rationale: string;               // prediction.rationale (sinal p/ a narrativa)
  predictionId: string;            // proveniência → headline.sourcePredictionIds
  selections: { key: string; label?: string; modelProbPct: number }[];
};
export function summarizeAnalysesForSynthesis(outcomes: FanOutOutcome[]): MarketAnalysisSummary[];
// filtra ok; ordena por edge desc (contexto); pass mantém recommendation='pass', edge/odd null.

// lib/ai/palpites/value-language-guard.ts
export function containsValueLanguage(text: string): boolean;
// regex i, word-boundary: edge | EV | valor esperado | expected value | stake | unidade(s)
//   | yield | lucro | profit | odd(s) | cotação | R\$  (NÃO banir % — confiança é qualitativa)

// db/schema.ts — palpiteSets ganha:
//   headline: jsonb("headline").$type<PalpiteHeadline>()   // nullable, aditiva
export type PalpiteHeadline = {
  verdict: string;
  confidence: "baixa" | "media" | "alta";
  narrative: string;
  citedMarkets: string[];
  sourcePredictionIds: string[];   // trim-if-friction
};

// lib/view/palpites-headline.ts (ou estender lib/view/palpites.ts)
export type PalpiteHeadlineView = {
  verdict: string;
  probableScore: { home: number; away: number };
  confidence: "baixa" | "media" | "alta";
  narrative: string;
  citedMarkets: string[];
  badge: "won" | "lost" | null;    // settlement do exact_score; SEM número de valor
};
// toPalpiteHeadlineView(set: DbPalpiteSet, exactScoreLine, outcome?) — só os campos acima.

// app/actions/predictions.ts
type AnalyzeBestBetResult =
  | { ok: true; view: BestBetView; palpite: PalpiteHeadlineView | null }
  | { ok: false; error: string };
```

**Persist (index.ts 12c) — substituir o loop `for (const line of output.palpites)`:**
- `output` agora é `PalpiteSynthesisOutput` (objeto único, não array).
- 1 insert em `palpites`: `type: "exact_score"`, `params: ExactScoreParamsSchema.parse(output.probableScore)`,
  `settleable: deriveSettleable("exact_score")` (=true), `text:` label derivado
  (ex.: `${output.verdict} — provável ${home}×${away}`; **rodar `containsValueLanguage` no text também**).
- `palpite_set` insert ganha `headline: { verdict, confidence, narrative, citedMarkets, sourcePredictionIds }`.
- `registry.ts` generic + `index.ts:235` binding: `PalpitesOutput` → `PalpiteSynthesisOutput`.

**Settlement latest-only (`getPendingPalpiteSettlements`):** adicionar à WHERE:
`AND NOT EXISTS (SELECT 1 FROM palpite_sets ps2 WHERE ps2.match_id = palpite_sets.match_id
AND ps2.user_id = palpite_sets.user_id AND ps2.created_at > palpite_sets.created_at)`
(Drizzle: `notExists(...)` com alias de `palpiteSets`). Teste: 2 sets/jogo → só o mais novo settla.
