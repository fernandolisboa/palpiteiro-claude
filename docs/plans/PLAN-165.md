# PLAN — #165 Cartucho de mercado: predict() despachando por marketKey

> Fase 2, passo 3 (o mais arriscado). **v2 — REWORK pós plan-review (2 blockers + majors; 14 emendas
> + 5 decisões).** predict.ts = ÚNICA porta pro LLM (ai_calls sempre, Zod sempre). Base do worktree:
> `origin/main` (#163+#164). Critério-mestre: **over/under ponta-a-ponta IDÊNTICO via cartucho**
> (input payload byte-idêntico, fluxo de erro idêntico, colunas legadas byte-idênticas) + preenche as
> colunas novas. **Zero `if (market === X)` no predict.** Bump `over_under_v1.3 → over_under_v2.0`
> (MAJOR pela reestruturação; **payload byte-idêntico** → o eval pago é no-op pra ESTE bump). Commit `prompt:`.

## DECISÕES (das 5 perguntas abertas — todas cravadas)
1. **Odds path = CONSERVADOR, por branch.** REUSE: `getLatestFreshOddsSnapshot` (tabela velha;
   `capturedAt = freshSnapshot.capturedAt.toISOString()`). FALLBACK: `pickBestTotalsBookmaker`
   (`capturedAt = bundle.lastUpdate`, string do provider). Candidate set `[over,under]` derivado do
   bundle nos DOIS branches. **NÃO** trocar pro read genérico (`getLatestFreshSelectionOddsSnapshots`):
   ele (a) não tem `lastUpdate` (só `capturedAt:Date`) → mudaria os bytes de `captured_at` no prompt;
   (b) é vazio no fallback standalone; (c) THROWS em captura incompleta/incoerente (nova classe de erro
   pré-LLM). Migra num follow-up quando existir cartucho não-over/under.
2. **Field names (`over_2_5_decimal`…) = MANTER** dentro do cartucho (rename arrisca rendering byte-idêntico; ganho cosmético).
3. **Persistência = SEQUENCIAL, sem db.batch** (atomicidade prediction+PSO é estruturalmente impossível
   no neon-http — PSO.predictionId é FK NOT NULL pra `predictions.id` server-gen `defaultRandom`, só
   existe após `.returning()`; db.batch pipeline statements independentes; client-UUID NÃO autorizado
   p/ #165). Ordem: `ai_call (.returning) → prediction (.returning) → PSO (sequencial)`.
4. **`buildPredictionInput`/`build-input.ts` = MOVE pro cartucho** (100% over/under-específico).
5. **Estrutura = `lib/ai/markets/over_under/`** (dir com `index.ts` montando o cartucho de módulos
   co-localizados); `types.ts` (MarketCartridge) + `registry.ts` (getCartridge). SYSTEM_PROMPT
   byte-idêntico ao v1.3 (SEM camada-base especulativa — fatorar quando o 2º cartucho chegar).

## Mudança 1 — Registry de cartucho (`lib/ai/markets/`)
```ts
// types.ts
export type MarketCartridge = {
  marketKey: string;                 // "over_under"
  version: string;                   // "over_under_v2.0"
  systemPrompt: string;              // byte-idêntico ao v1.3
  tool: Anthropic.Tool; toolName: string;
  inputSchema: ZodSchema; buildUserMessage: (input, ctx) => string;
  outputSchema: ZodSchema;           // preserva byte-a-byte o superRefine (minimum_odd obrigatório sse
                                     // recommendation!="pass") + convenção confidence_pct pass="P(over)"
                                     // + tolerância #45 (rationale 2000 / key_factors)
  selections: string[];              // ["over","under"]
  descriptor: MarketDescriptor;      // #164 OVER_UNDER
};
// registry.ts
export function getCartridge(marketKey: string): MarketCartridge; // throw em key desconhecida
```
- `lib/ai/markets/over_under/`: `prompt.ts` (SYSTEM_PROMPT+tool), `schemas.ts` (input+output),
  `build-input.ts`, `user-message.ts`, `index.ts` (monta o cartucho). **DELETAR** `lib/ai/prompts/over_under_v1.ts`
  e `lib/ai/schemas/{input,output}.ts` (sem shims).
- **NÃO** generalizar o enum: over/under grava `market="over_under_2_5"` + par legado via o mapeamento
  de colunas-legadas do PRÓPRIO cartucho (a costura legada é do cartucho, não um campo de enum genérico).

## Mudança 2 — `predict({ marketKey = "over_under", ... })`
Ganha `marketKey?: string` (default `"over_under"`). **Caller único `app/actions/predictions.ts:98` inalterado.**
`const cartridge = getCartridge(marketKey)`. **getCartridge + resolução de catálogo rodam ANTES de
`client.messages.create()`** (reads puros; mantém todo throw FORA da janela pós-chamada-paga).
- **odds (conservador, decisão 1):** REUSE old-table / FALLBACK pickBestTotalsBookmaker; candidate set
  do bundle. provider markets = `[cartridge.descriptor.providerMarketKey]` (=`["totals"]`, request
  byte-idêntico); **remover o literal `"totals"` do predict**. regions `["eu"]`.
- **input:** `cartridge.buildPredictionInput(...)` → `cartridge.inputSchema`. `buildUserMessage` renderiza
  markdown **byte-idêntico**.
- **request:** `buildAnthropicRequest(model, cartridge.systemPrompt, msg, [cartridge.tool], cartridge.toolName, ...)` — inalterado.
- **validação:** `cartridge.outputSchema.safeParse(toolUse.input)`.
- **edge (N=2 bit-exato — contrato chave→índice):** candidate-odds array na ordem
  `descriptor.selectionKeys` (`['over','under']`) mapeada SOBRE as odds do bundle (NUNCA por ordem de
  linhas de read). `implied = computeMarketImpliedProbabilities([overOdd, underOdd])`; indexar por KEY:
  `impliedPct = recommendation==='over' ? probs[0]*100 : probs[1]*100` (mesma ordem de operações de
  predict.ts:367-372). `edge = computeSelectionEdgePp(confidence_pct, impliedPct)`. Bit-exato com hoje.

## Mudança 3 — Persistência (SEQUENCIAL; expand legado + novo)
- `ai_call` insert (.returning id) — inalterado, market-agnostic. `promptVersion = cartridge.version`.
- `prediction` insert (.returning id): colunas legadas byte-idênticas (`market="over_under_2_5"`,
  `overOddAtPrediction`/`underOddAtPrediction` = `bundle.overOdd/underOdd.toFixed(3)`, `oddAtRecommendation`,
  `impliedProbPct`/`edgePct` do lado recomendado `.toFixed(2)`, `bookmaker`, etc.) **+** novas:
  `marketId` (do catálogo), `selectionId` (`pass ? null : idByKey[recommendation]`), `marketParams`
  (`descriptor.params` verbatim = `{line:2.5}` number).
- `prediction_selection_odds` insert (sequencial, após `prediction.id`): 1 row por seleção (over+under),
  **inclusive em pass**. **odds = EXATAMENTE o par legado** (`overOdd.toFixed(3)`/`underOdd.toFixed(3)`
  do MESMO bundle) → `PSO["over"]===overOddAtPrediction` byte-a-byte. UNIQUE(predictionId,selectionId).
- **falha parcial de PSO** (após prediction commitada): **log + degrade (NÃO throw)**, estilo
  `persistAiCallError` (predict.ts:202-212) — retorna a prediction; candidate set re-preenchível pelo
  backfill #162 (idempotente). Janela de parcialidade tolerada — documentar.
- **catalog resolver (consolidar, não triplicar):** hoje há 2 resolvers privados inversos
  (`resolveMarketCatalog` odds-snapshots.ts:193-216 id→key; `resolveCatalog` fetch-and-snapshot.ts:62-85
  key→id). Promover UM canônico em `lib/db/queries/` retornando `{ marketId, idByKey, keyById }` (cache
  por chamada); refatorar os 2 call sites pra consumi-lo (regra CLAUDE.md 2+ lugares). `selectionId` via
  `idByKey` com **hard-fail "seleção X não seedada"** ANTES do insert (não violação de FK opaca pós-paga).

## Mudança 4 — Importadores, testes, eval, MIN_EDGE_PP
- **Re-apontar TODOS os importadores** (break de typecheck, obrigatório, mesmo PR) — lista COMPLETA
  na seção EMENDAS RESIDUAIS (são 4 externos, não 3; inclui `predict.test.ts:128`).
- **`request-builder.test.ts:153`** pino `MIN_EDGE_PP ↔ systemPrompt` passa a asserir `cartridge.systemPrompt`
  (MIN_EDGE_PP continua em `lib/odds/scenario.ts`).
- **`predict.test.ts` rework:** mock de db assertando por **TABELA-alvo** (não índice posicional). Reafirmar
  invariantes de error-path: `tool_missing`/`invalid_output`/`provider_error` → EXATAMENTE 1 insert (ai_calls),
  ZERO prediction/PSO. Happy path → 3 inserts `[ai_calls, predictions, prediction_selection_odds]`, PSO
  cobrindo o candidate set completo **inclusive em pass**. Mock de `getLatestFreshOddsSnapshot` fica (path conservador).
  Teste de **paridade** (LLM output mockado fixo): row legada byte-idêntica + novas colunas corretas;
  caso **assimétrico** (over 2.10/under 1.74) E caso `recommendation="under"` (impliedProbPct/edgePct
  `.toFixed(2)` idênticos ao legado); `PSO["over"]===overOddAtPrediction`.
- **`scripts/replay-prompt-eval.ts`:** atualizar imports/estrutura (carregar do cartucho; agrupar por
  cartucho/versão). **Guarda sem-paga:** manter `requireEnv("ANTHROPIC_API_KEY")` + adicionar
  `if (process.env.CI) throw` no topo; pino de teste que assere que NENHUMA config Vitest / script
  `package.json` test referencia `replay-prompt-eval`. **Rodar o eval é manual do usuário** (pago); como
  o payload v2.0 é byte-idêntico, o eval é INFORMACIONAL pra este bump (documentar no PR p/ evitar
  reprovado espúrio por ruído).

## Critérios de saída
- [ ] over/under ponta-a-ponta idêntico via cartucho: input payload, fluxo de erro, colunas legadas byte-idênticas
- [ ] `systemPrompt` + `buildUserMessage` do cartucho byte-idênticos ao v1.3 p/ o mesmo input (teste string-equality, **não** o eval pago)
- [ ] predict preenche `market_id`/`selection_id`/`market_params` + `prediction_selection_odds` (candidate set, **incl. pass**)
- [ ] `PSO["over"]===overOddAtPrediction` e `PSO["under"]===underOddAtPrediction` byte-a-byte
- [ ] edge N=2 bit-exato (teste assimétrico + `recommendation="under"`); contrato chave→índice respeitado
- [ ] zero `if (market === X)` no predict; dispatch por `getCartridge`; provider markets do descriptor
- [ ] fronteira intocada: única porta, `ai_calls` (sucesso+erro), Zod sempre; nenhum outro módulo importa o Anthropic SDK
- [ ] persistência SEQUENCIAL (ai_call→prediction→PSO); falha parcial de PSO = log+degrade (não-throw)
- [ ] catalog resolver consolidado em `lib/db/queries/` (2 call sites refatorados)
- [ ] `stakeUnits` continua implícito (default "1"); #167 popula depois (assertado no teste de paridade)
- [ ] replay-prompt-eval estrutural por cartucho/versão + guarda sem-paga (`CI` throw + pino); 3 importadores re-apontados
- [ ] `typecheck`/`lint`/`test` verdes; commit `prompt:` pro bump `over_under_v2.0`

## Riscos p/ a implementação
- O rework do mock de `predict.test.ts` (posicional → por-tabela) é o ponto mais chato; não quebrar os
  invariantes de error-path (1 insert ai_calls / 0 prediction).
- Deletar os 3 módulos antigos quebra typecheck até os 3 importadores serem re-apontados — fazer junto.
- O catalog resolver consolidado mexe em código do #164 (odds-snapshots.ts + fetch-and-snapshot.ts) — manter os testes pglite do #164 verdes.

## EMENDAS RESIDUAIS (v2 re-verify — FINAL, cravadas; verdict SHIP_WITH_AMENDMENTS, zero blocker novo)

### Importadores a re-apontar (lista COMPLETA — 7 externos + 2 internos que MOVEM juntos)
Deletar `lib/ai/prompts/over_under_v1.ts` + `lib/ai/schemas/{input,output}.ts` + `lib/ai/build-input.ts`
(MOVEM pro cartucho), e re-apontar TODOS:
1. `lib/ai/predict.ts:29` — `{ BuildInputError, buildPredictionInput }` from `./build-input` → cartucho.
2. `lib/ai/predict.ts:42-43` — `{ PROMPT_VERSION, SUBMIT_PREDICTION_TOOL, SYSTEM_PROMPT, buildUserMessage }`
   from `./prompts/over_under_v1` + `{ OverUnderOutputSchema }` from `./schemas/output` → cartucho.
3. **`lib/ai/__tests__/predict.test.ts:128`** — `import * as buildInputModule from "@/lib/ai/build-input"`
   (+ 4 `vi.spyOn(buildInputModule, "buildPredictionInput")` em :294/313/337/411) → cartucho build-input.
   **O cartucho DEVE exportar `buildPredictionInput` E `BuildInputError` nomeados** (o spy mantém a impl
   real — asserts de absencesAvailable :300-301,319-324 — e o catch de `BuildInputError` em predict.ts:408).
4. `lib/ai/schemas/output.test.ts:3` — `{ OverUnderOutputSchema }` → cartucho (a suíte da tolerância #45).
5. `lib/ai/__tests__/request-builder.test.ts:6-9` — `{ SUBMIT_PREDICTION_TOOL, SYSTEM_PROMPT }`; o pino
   `:153` (`MIN_EDGE_PP ↔ SYSTEM_PROMPT`) passa a apontar `cartridge.systemPrompt`.
6-7. `scripts/replay-prompt-eval.ts:46-47` — prompt artifacts + `{ OverUnderOutputSchema, OverUnderOutput }`.
(Internos, MOVEM juntos, não são re-point externo: `build-input.ts:1-4` importa `OverUnderInputSchema`;
`over_under_v1.ts:1` importa `OverUnderInput`.)

### Test-wiring (predict.test.ts) — OBRIGATÓRIO
- **Stub do catalog resolver consolidado** (predict passa a chamá-lo ANTES da chamada paga). Sem stub, a
  suíte inteira (happy/paridade/model-resolution) estoura: o select stub de `@/lib/db` (predict.test.ts:46-53)
  só modela `select().from().where().limit()` — a query de `marketSelections` é SEM `.limit()`, então o
  `where()` (branch sem limit) devolve `{ limit: fn }` (não-awaitable) → `sels.map` undefined → TypeError.
  Fix: estender o `vi.mock` apropriado pra devolver `{ marketId:'mkt-ou',
  idByKey:new Map([['over','sel-over'],['under','sel-under']]), keyById:new Map([['sel-over','over'],['sel-under','under']]) }`.
  **NOMEAR o módulo final do resolver** (proposta: `lib/db/queries/market-catalog.ts`, com `vi.mock` dedicado).
- **Error-path invariant é o constraint vinculante** (não o rework posicional): `tool_missing`/`invalid_output`/
  `provider_error` → `expect(insertValues).toHaveBeenCalledTimes(1)` (predict.test.ts:728) p/ os 3 status;
  0 prediction / 0 PSO. Os reads posicionais `calls[1]?.[0]` (prediction) SOBREVIVEM ao 3º insert (PSO=calls[2]),
  então a migração posicional→por-tabela é melhoria de qualidade, não correção — pode ser incremental.

### Timing do catalog resolver (autoritativo — Mudança 2 manda)
`getCartridge` + resolução `{ marketId, idByKey, keyById }` rodam no **bloco de reads PRÉ-chamada-paga**
(junto com odds/genParams), keyed por **`cartridge.descriptor.dbMarketKey` (= `'over_under'`, NÃO o enum
legado `'over_under_2_5'`** — market-descriptor.ts:11-12 avisa da colisão de vocabulários). A persistência
(Mudança 3) apenas CONSOME os mapas já resolvidos: `selectionId = pass ? null : idByKey.get(recommendation)`
(hard-fail em memória, sem round-trip pós-pago). Assim um market sem-seed falha ANTES de queimar spend e
ANTES do insert de ai_call (preserva o audit row).

### Nits (opcionais)
- Guarda sem-paga do replay-eval é DEFENSIVA (hoje o único run-path é `pnpm tsx scripts/replay-prompt-eval.ts`;
  o glob default do vitest já exclui). Manter, só relabelar.
- Edge: `computeImpliedProbabilities(over,under)` é o wrapper que delega a `computeMarketImpliedProbabilities([over,under])`
  (implied-probability.ts:51-66), `probs[0]=overProb` bit-exato — qualquer um dos dois satisfaz o contrato.
