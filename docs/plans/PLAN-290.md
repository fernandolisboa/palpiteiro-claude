# PLAN — #290 Ligar correct score + artilheiro/assistência end-to-end (ADR 0025)

> Plano de implementação (histórico — ver README de `docs/plans/`). Snapshot de um
> ponto no tempo, **não** spec viva. Fluxo: explore → **plano** → plan-review →
> implementação → code review → merge verde. Aterrado no código real pós #289 (PR #303).

## Escopo confirmado pelo dono

`#290` liga **dois** mercados end-to-end pro Brasileirão, atrás de flag **admin-only**,
graduando depois por **D9 viva** (sem backtest):

1. **Correct score** — o adapter de odds + descriptor `CORRECT_SCORE` (grid 16 células
   `cs_H_A`, sem OTHER) **já existem** (#289), mas `CORRECT_SCORE` está **fora** de
   `ALL_DESCRIPTORS`. Falta: migration (seed `markets`/`market_selections`), adicionar a
   `ALL_DESCRIPTORS`, cartucho, settlement sobre o placar de 90' **já coletado**.
2. **Artilheiro/assistência** (absorvido do #289, o mercado estruturalmente difícil) —
   adapter de odds api-football `bet=92`/`212` + descriptor + cartucho + settlement via
   `/fixtures/events` (que **esta** issue coleta). **Decisão do dono (AskUserQuestion,
   2026-06-17): os DOIS entram em #290** e a perna scorer exige **emenda à ADR 0025**.

**Corte de escopo (ratificado na emenda):** entram `bet=92` (anytime scorer) +
`bet=212` (assist). **`bet=93` (first scorer) fica de fora** — é mercado de vencedor único
mutuamente-exclusivo (não um binário independente), settlement diferente; shoehorná-lo
mis-settla. Defer com nota explícita na emenda.

## Entrega: DOIS PRs, ambos referenciando #290 (o 2º fecha a issue)

Mesmo com "os dois em #290", entregamos em **duas PRs sequenciais** — protege a paridade
byte-idêntica do #288 landando primeiro a perna limpa e verde antes da arriscada tocar
`predict.ts`:

- **PR1 — Correct score (limpo, baixo risco).** Slice vertical totalmente aditivo. Mergeia
  e começa o tracking D9 imediatamente. Nenhuma mudança em adapter/UI/tracking (a pipeline
  já é data-driven).
- **PR2 — Artilheiro/assistência (a perna difícil).** Emenda ADR 0025 + `/fixtures/events`
  + `result_data` estendido + identidade de seleção dinâmica + a metodologia de edge
  yes-only + settlement. Só entra depois que PR1 está verde em prod.

`Closes #290` vai **só no corpo do PR2**. (Lembrete [[github-fecha-not-autoclose]]: usar
"Closes #290" em inglês, não "Fecha".)

---

## Invariantes inegociáveis (paridade #288)

A perna The Odds API e os mercados Tier 1/2 (`over_under`/`match_result`/`btts`/
`double_chance`) **+ correct_score** ficam **byte-idênticos**. Garantias estruturais:

- **`marketKind` ausente ⇒ `"partition"`** em TODO descriptor existente e em `CORRECT_SCORE`.
  Todo fork lê `descriptor.marketKind ?? "partition"`. Mercados partition **nunca entram**
  no caminho scorer.
- **`lib/odds/implied-probability.ts` recebe ZERO diff** e nunca é chamado pro scorer.
- **`pickBestBookmaker` (`select-bookmaker.ts:74-105`) nunca é alcançado pro scorer** — um
  sibling novo (`collectIndependentBinaries`) cuida do conjunto de jogadores ilimitado de um
  book só, sem complete-market gate, sem overround, sem o footgun `overround < best.overround`
  contra `NaN`.
- **`resolveMarketCatalog` (`market-catalog.ts:48-50`, hard-fail de zero-seleção) não é
  editado** — o scorer resolve via um query markets-row-only + `ensureScorerSelections`
  separado, nunca o reader que assere completude.
- **Nenhum `if (market === ...)`** fora de registries. Os forks chaveiam em
  `descriptor.marketKind`/`descriptor.dynamicSelections`, nunca no `marketKey`.
- **Teste de byte-parity dedicado**: os bytes de output do `predict` pra `over_under` E
  `correct_score` idênticos antes/depois dos campos novos do descriptor existirem (present-
  but-undefined). Mais o invariante: o caminho scorer **não importa nem chama**
  `computeMarketImpliedProbabilities`.

---

## PR1 — CORRECT SCORE end-to-end

Cartucho-template: **`match_result`** (cartucho N>2 OPTION-B que emite a distribuição cheia;
o grid de 16 é a mesma forma escalada de 3 → 16). Recipe (tudo num PR coeso):

1. **Cartucho** `lib/ai/markets/correct_score/` espelhando `match_result/`
   (`index.ts`/`prompt.ts`/`schemas.ts`/`build-input.ts`/`user-message.ts` + `__tests__/`):
   - **schemas.ts**: sub-schemas de suporte byte-idênticos (duplicação por convenção).
     Substituir o `OddsSchema` 3-way por um **record de 16 células** (`cs_0_0..cs_3_3`),
     refinado a conter exatamente as 16 chaves. Output (OPTION B): `recommendation` ∈
     {16 cs + `pass`}; `confidence_pct`; `cell_probs` (record das 16 probs, Σ≈100 sobre a
     grid limitada); `rationale`/`key_factors` tolerantes (truncar, não rejeitar);
     `minimum_odd` opcional com o mesmo `superRefine`. **Não rejeitar** se as 16 não somam
     100 — só clamp [0,100] (normalização defensiva é downstream).
   - **prompt.ts**: analista de placar exato. Tarefa em 2 partes (estimar a distribuição
     sobre as 16 células **condicional a um placar 0..3, normalizada sobre a grid** — coerente
     com o implied que normaliza sobre as MESMAS 16; depois escolher 1 célula ou pass).
     Regras invioláveis: edge ≥ `${MIN_EDGE_PP}` pp por célula vs o implied normalizado
     (importar `MIN_EDGE_PP` de `@/lib/odds/scenario`, interpolar o literal — pinado por teste),
     pass como default first-class, cautela de calibração (correct score é MUITO difícil —
     resistir a overconfidence), só dados, racional lay-reader (~450 chars).
   - **build-input.ts**: copiar de `match_result`; em vez de 3 `find()` nomeados, loopar as
     16 chaves; faltando qualquer célula → `BuildInputError` (book incompleto = bug;
     prefer-skip).
   - **user-message.ts**: renderizar grid 4×4 (home 0..3 × away 0..3) de "odd → implied % normalizada".
   - **index.ts**: `CORRECT_SCORE_VERSION = "correct_score_v1"`. Re-exports nomeados
     (LOAD-BEARING pro `vi.spyOn`). `selectionProbs` retorna o record de 16 direto (OPTION B).
     **Sem `resolveParams`** (grid estática). `descriptor: CORRECT_SCORE`.
2. **registry.ts** (`lib/ai/markets/`): importar + registrar `correctScoreCartridge`.
3. **`market-descriptor.ts`**: adicionar `CORRECT_SCORE` a `ALL_DESCRIPTORS` (235-240). O
   corpo (210-231) já está correto — **não** re-autorar.
4. **Migration** (DML idempotente, espelhando `0016_seed_btts.sql`): gerar via
   `pnpm db:generate --custom --name=seed_correct_score` (NÃO hand-pick o número — próximo
   livre é 0030, mas se PR concorrente pegar, dança de renumber [[concurrent-storm-migration-renumber]]).
   `INSERT markets ('correct_score','Placar exato','correct_score',is_active=true,is_graduated=false)
   ON CONFLICT(key) DO NOTHING` + 16 `market_selections` via `CROSS JOIN VALUES`
   (`cs_0_0`→`'0-0'` … `cs_3_3`→`'3-3'`, sort 0..15 row-major) `ON CONFLICT(market_id,key) DO NOTHING`.
   **Sem ALTER TYPE** (chaves são `text` livre desde o contrato #179). **Sem flip de graduação.**
5. **Settlement** `lib/settlement/rules/correct_score.ts` espelhando `match_result.ts`: ler
   `resultData.{homeScore,awayScore}`; null → `SettlementError` (prefer-skip / deixa pending);
   **placar real fora da grid (4-0, score > 3) → `lost`** (a célula in-grid prevista
   objetivamente não ocorreu — **NÃO throw**, senão um 4-0 legítimo fica pending pra sempre);
   senão `won` sse `cs_H_A === actual`. Registrar `correct_score` em
   `lib/settlement/registry.ts`. **Sem mudança em `result_data`/provider.**
6. **Presentation** `lib/view/markets/presentation.ts`: entrada `correct_score` (marketLabel
   `'Placar exato'`, 16 selectionLabels `'H-A'` byte-idênticos ao seed, `settlementMetricValue`
   = `${homeScore}-${awayScore}`, `classifyH2H` null). Estender
   `presentation-seed-parity.pglite.test.ts` com um `describe('correct_score')`.
7. **Flips de teste obrigatórios** (vão RED no instante do passo 3):
   - `market-descriptor.test.ts:~118`: `getDescriptor('correct_score')` de `toBeUndefined()` →
     `toBe(CORRECT_SCORE)` (e nome do teste sem "FORA de ALL_DESCRIPTORS").
   - `market-catalog.test.ts:~128-137`: incluir `correct_score` na lista esperada de `brasileirao_a`.
   - `marketkey-parity.test.ts`: adicionar `correct_score` ao loop + asserts.

**Adapter/roteamento/UI/tracking: ZERO mudança.** `predict.ts` pede `markets:[providerMarketKey]`
= `['bet_10']`, `oddsSource='featured'` → batch `getOddsForSport`; o complete-market gate é
satisfazível por um book (Bet365) sobre a grid de 16. UI é data-driven (`AnalysisScenarios`
trunca a Top-5 com "+11 outras seleções não exibidas"); dashboard segmenta por `marketKey`;
D9 ruler (`computeGraduation`, display-only) acende sozinho. **NÃO** adicionar a `PAGE_LIVE_MARKETS`.

---

## PR2 — ARTILHEIRO / ASSISTÊNCIA (perna independent_binary)

> ⚠️ **As "Correções do plan-review (2026-06-17)" no fim deste doc têm PRECEDÊNCIA sobre o
> corpo do PR2.** O plan-review (5 lentes, achados re-verificados contra o código)
> encontrou 3 BLOCKERs + 8 MAJORs aqui — em especial: (a) o adapter de odds api-football
> **NÃO** roteia/busca `bet_92/212` (a premissa "o roteador #289 já manda" é FALSA), e
> (b) o nome do jogador **nunca chega à view** (crash em `getMarketPresentation`). Ler as
> correções antes de implementar.

### Taxonomia `marketKind` (1 discriminante aditivo)

Em `MarketDescriptor` (`market-descriptor.ts:22-60`): `marketKind?: "partition" | "independent_binary"`
(ausente ⇒ partition), `dynamicSelections?: boolean` (não exigir `selectionKeys` estático), e
`minEdgePp?: number` (piso de edge; default **5** partition, **8** scorer). DOIS descriptors
novos, ambos `marketKind:"independent_binary"`, `dynamicSelections:true`, `oddsSource:"featured"`,
`coveredLeagues:["brasileirao_a"]`, `selectionKeys: []`:
- `ANYTIME_SCORER`: `providerMarketKey "bet_92"`, `dbMarketKey "anytime_scorer"`.
- `ASSIST`: `providerMarketKey "bet_212"`, `dbMarketKey "assist"`.

Ambos **entram em `ALL_DESCRIPTORS`** (diferente de correct_score, que já estava lá ao fim do
PR1) — senão `marketsForLeague` (fail-closed em `:126`) nunca os oferece ao seletor admin.
`getDescriptor` resolve, e a guard de seed-completude do predict é **forkada off
`dynamicSelections` antes** de rodar.

### Metodologia de edge yes-only (o núcleo da emenda)

Cada jogador é um **binário independente** cotado só no lado `yes` (Bet365). NÃO há partição —
`Σ 1/odd_yes` é a contagem esperada de artilheiros × margem (~1.3–1.8), **não** um overround;
normalização é **inaplicável** (matematicamente indefinida aqui, não "pulada"); sintetizar a
odd `no` é **proibido** e não fazemos. Por jogador:

```
impliedCeilingPct_p = (1 / odd_yes(p)) * 100      // TETO margin-inclusivo, NUNCA prob de-vigada
edge_p              = modelProb_p - impliedCeilingPct_p   // PISO do edge real (conservador)
```

A gotcha do CLAUDE.md proíbe `1/odd` cru porque, numa **partição**, normalizar por `Σraw`
deflaciona o denominador e **infla** o edge (margem se passando por valor). Aqui fazemos o
**oposto**: mantemos o `1/odd` inflado como a barra que o modelo tem que bater. Como a margem
faz `1/odd_yes` **exceder** o `P(yes)` verdadeiro, `impliedCeilingPct` é um **teto** e `edge_p`
é um **piso** — só dá pra **subestimar** edge, nunca superestimar. **Precedente no código**:
`scenario.ts:33-38` já usa `100/odd` cru como barra de break-even, abençoado pela ADR 0012
decisão 6. EV/break-even (ADR 0018 D3) passam **inalterados** na odd crua. `impliedSumTarget`
= **N/A** pro `independent_binary`. Compensa-se a margem não-removível elevando `minEdgePp` (8).
`impliedProbPct` persistido carrega semântica de **teto** e a `presentation.ts` o rotula como
teto. **Edge scorer NÃO é comparável a edge partition** — segmentar Yield por mercado, nunca cruzar.

### Identidade de seleção (jogadores ilimitados)

Seed **só a linha `markets`** (`anytime_scorer`, `assist`; `is_active=true`, `is_graduated=false`)
com **ZERO** `market_selections` fixas. Seleções de jogador materializadas **lazy**, chave
`scorer_p<playerId>` (preferida, se o fio `bet_92` trouxer id numérico — **NÃO verificado**) ou
`scorer_<canonicalName>` fallback. Escrita via **`ensureScorerSelections(marketId, keys[])` novo
em `market-catalog.ts`, SEPARADO de `resolveMarketCatalog`** (nunca o hard-fail de zero-seleção):
upsert idempotente (`onConflictDoNothing` no `UNIQUE(market_id,key)` existente), roda **pré-paid-call**
no predict (falha de DB nunca queima spend). Race fechado por UNIQUE + onConflictDoNothing +
re-read do `idByKey`. Resultado: linhas `market_selections` reais por jogador →
`predictions.selectionId` aponta pro jogador escolhido, `prediction_selection_odds` tem 1 linha
por jogador cotado, Yield-by-player agrega em SQL puro. (Rejeitado: P1 `marketParams` jsonb
colapsa KPI por jogador.)

### Threading em `predict.ts` (1 fork, data-driven)

`const isIndependentBinary = (cartridge.descriptor.marketKind ?? "partition") === "independent_binary";`
logo após `getCartridge` (~250). Forks:
1. **Aquisição de odds (349-490)**: branch novo ANTES do bloco partition. `acquireScorerOdds`
   → `getOddsProvider().getOddsForSport(sportKey,{markets:[providerMarketKey]})` (roteador #289
   manda `bet_92/212` pro `ApiFootballOddsAdapter`) → `findMatchingEvent` (119-136) →
   **`collectIndependentBinaries({event,descriptor})`** (`lib/odds/collect-independent-binaries.ts`):
   escolhe o único book com mais jogadores cotados, mapeia via `resolveSelectionKey`, dropa
   `odd<=1`/não-finito, retorna `{bookmakerTitle, lastUpdate, players:[{key,odd}]}` — **sem**
   complete-market gate, **sem** overround. Else-branch = 349-490 verbatim.
2. **Catálogo scorer**: resolver `marketId` (query markets-row-only) → `ensureScorerSelections`
   (pré-paid). `selectionKeys` scorer = lista de chaves do bundle.
3. **Seed-completeness guard (504-512)**: PULADO quando `dynamicSelections`.
4. **deriveImplied (531-557)**: partition inalterado. Scorer → `deriveIndependentImplied(bundle)`
   (`impliedByKey[p] = (1/odd_p)*100`, sem `computeMarketImpliedProbabilities`, sem `impliedSumTarget`).
5. **selectionProbs (831)**: cartucho scorer retorna `modelProb` por jogador (probs
   independentes, **não** somam 100 — correto).
6. **N-way edge (833-858)**: a fórmula `modelProbByKey[side] - impliedPct` já é per-selection e
   funciona verbatim (impliedPct = teto). Staking gate usa `descriptor.minEdgePp` threaded em
   `computeStakeUnits` (arg default 5 → partition byte-idêntico).
7. **PSO rows (883)**: iterar o set dinâmico, `selectionId` do `idByKey` upsertado.
8. **Persistência (953-996)**: `marketParams=null` (sem linha); `recommendation` = chave do
   jogador escolhido.

`select-bookmaker.ts` e `implied-probability.ts`: **ZERO diff**.

### Coleta `/fixtures/events` + settlement

- **Seam de provider**: `getFixtureEvents(ref): Promise<NormalizedFixtureEvents | undefined>` em
  `SportsDataProvider` (`types.ts:166-212`) + capability `supportsFixtureEvents`. Schema Zod
  `NormalizedFixtureEvents`: `{ fixtureStatus, eventsAvailable:boolean, goals:[{playerId:number|null,
  playerName, teamSide, minute, isPenalty, isOwnGoal, isRegulation}], assists:[...] }`. Impl
  api-football: `GET /fixtures/events?fixture={id}`, resolvendo o id exatamente como
  `getFixtureResult` (`adapter.ts:806-833`). Normalize: `type=="Goal" && detail!="Own Goal"` →
  credita; `detail=="Penalty"` → `isPenalty`, **ainda credita**; `detail=="Own Goal"` →
  `isOwnGoal`, **NÃO credita**; base **regulation-90** (mirror `toNormalizedFixtureResult` que
  usa `score.fulltime`): filtrar `time.elapsed<=90` (+ stoppage), **excluir ET (91-120) e
  pênaltis**. `eventsAvailable=true` só quando o fetch teve sucesso num fixture finalizado.
  Delegate no `FallbackProvider` capability-gated; stub football-data-org → `SportsDataUnsupportedError`.
- **`result_data` (aditivo, SEM DDL de coluna)**: estender `predictionOutcomes.resultData` `$type`
  (`db/schema.ts`) + `ResultDataSchema` (`settlement/schemas.ts:28-32`) com `scorers?:[{playerId,
  canonicalName}]` e `eventsAvailable?:boolean` **opcionais**. Linhas existentes parseiam
  byte-idênticas; `resultDataFromRegulationScore` inalterado pras regras partition.
- **Threading de settlement (chaveado por `settlementRuleKey`, NÃO descriptor** — `settle.ts`
  não tem descriptor em escopo, confirmado em `:101-116` e `predictions.ts:186)`: em `settle.ts`,
  após `resultByMatch`, também buscar `getFixtureEvents` pra um match quando QUALQUER predição
  pendente nele tem `settlementRuleKey ∈ {anytime_scorer, assist}` (memoização per-match
  `:61-82`). Merge `scorers`+`eventsAvailable` no `resultData` antes do `computeSettlement`.
  Matches só-partition mantêm o único `getFixtureResult` (byte-idêntico, sem egress extra).
- **Regra de settlement** (factory compartilhada parametrizada pelo campo a casar; registrar
  `anytime_scorer` + `assist`): **spine skip-over-wrong-settle** — se `eventsAvailable !== true`
  OU `scorers` undefined/null → `SettlementError` → `settle.ts` bucketa em errors → fica
  **PENDING**, **nunca fabrica loss**. Só com `eventsAvailable===true` E `scorers` autoritativo
  regulation-90: casar a chave por `playerId` (preferido) senão `canonicalName`; **WON** sse há
  scorer casando, senão **LOST**. Não-vazio mas id+nome inconclusivos → ambíguo → `SettlementError`
  → PENDING (prefer-skip). Override manual (`app/actions/settlement.ts`) é a saída interina até a
  liga voltar e o fio ser confirmado.

### Sequência de commits (PR2)

1. Seam de provider `getFixtureEvents` + schema + impl api-football + FallbackProvider delegate +
   stub football-data-org. Testes com payload sintético/capturado.
2. Widening aditivo de `result_data` (schema + `$type`). Assert `resultDataFromRegulationScore`
   byte-idêntico; settle-golden pglite verde.
3. Discriminante de descriptor (inerte): campos `marketKind`/`dynamicSelections`/`minEdgePp` +
   `ANYTIME_SCORER`+`ASSIST` + ambos em `ALL_DESCRIPTORS`. Teste de byte-parity (over_under +
   correct_score inalterados com os campos present-but-undefined).
4. `collect-independent-binaries.ts` + `deriveIndependentImplied` (teto 1/odd). Testes puros +
   drop odd<=1 + invariante "não importa `computeMarketImpliedProbabilities`".
5. `ensureScorerSelections` (separado de `resolveMarketCatalog`) + resolver markets-row-only.
   Teste de idempotência + race concorrente + re-read.
6. Cartuchos `anytime_scorer` + `assist` (prompt/schemas/build-input/user-message); registrar.
   Prompt codifica `minEdgePp=8` + framing de teto; output = per-jogador `{playerKey/name, prob_yes_pct}`.
7. Fork no `predict.ts` (acquireScorerOdds, catálogo scorer pré-paid, deriveIndependentImplied,
   selectionKeys dinâmico, input branch, PSO sobre set dinâmico, minEdgePp em computeStakeUnits).
   Re-rodar rede #288 byte-parity + marketkey-parity.
8. Regra de settlement (factory + `anytime_scorer`/`assist`) + threading em `settle.ts`. Testes
   dos 4 casos (won/lost/unavailable-pending/ambiguous-pending) + own-goal-excluído + ET-excluído.
9. View honesty: `presentation.ts` rotula `impliedProbPct` scorer como teto; branch
   `independent_binary` em `scenario.ts` (impliedPct=1/odd*100, sem normalização) gated por arg
   `marketKind` default partition. Testes de snapshot/view.
10. **Migration** (seed linhas `markets` `anytime_scorer`+`assist`, `is_active=true`,
    `is_graduated=false`; SEM `market_selections` fixas) + **emenda ADR 0025** + HANDOFF-290.
    Gerar número via `db:generate` (não hand-pick).

---

## Emenda ADR 0025 proposta (texto a colar no arquivo no PR2)

> Vai como seção datada anexada a `docs/decisions/0025-api-football-provider-de-odds-duplo-provider.md`
> (precedente: a própria ADR já tem "## Refino pós-decisão (2026-06-15)" anexado).

**## Emenda (2026-06-17) — mercados `independent_binary` (scorer/assist, #290)**

- **Contexto**: #290 liga correct_score (partition limpo, #289) E scorer/assist. Scorer quebra
  3 premissas da ADR base: conjunto de jogadores ilimitado por jogo; binários independentes
  yes-only (sem partição pra normalizar); novo anchor de settlement (`/fixtures/events`).
- **Decisão**: discriminante `marketKind` (`partition` | `independent_binary`) em
  `MarketDescriptor`; ship `bet_92` (anytime_scorer) + `bet_212` (assist); **defer `bet_93`
  (first_scorer)** — vencedor único mutuamente-exclusivo, precisa de regra partition-ish, não o
  modelo independent-binary; corte ratificado aqui.
- **Metodologia** (núcleo): cada jogador é binário independente cotado só no yes; NÃO se normaliza
  pelo overround (`Σ 1/odd_yes` é contagem esperada de artilheiros, não overround) e NÃO se
  sintetiza a odd no (proibido); a implícita por jogador é o **teto** `impliedCeilingPct =
  (1/odd_yes)*100` (rótulo explícito, nunca prob de-vigada); como teto, `edge = modelProb -
  impliedCeilingPct` é **piso** do edge real (conservador na direção da margem); compensa-se
  elevando `minEdgePp` (default 8pp); EV/break-even na odd crua (decisão 3 intacta, cita
  precedente `scenario.ts`/ADR 0012 D6); `impliedSumTarget` N/A.
- **Consequências**: `market_selections` por jogador crescidas lazy; settlement via
  `eventsAvailable`-ou-pending; **edge_pct scorer NÃO comparável a edge_pct partition** (segmentar
  Yield por mercado).
- **Riscos**: fio `bet_92/212` NÃO verificado (prefer-skip); `minEdgePp=8` é chute de graduação
  D9 (sem backtest, por decisão do dono); shapes de own-goal/ET de `/fixtures/events` NÃO verificados.

---

## Estratégia de teste

- **Re-rodar inalterado (rede #288)**: `marketkey-parity.test.ts`, `settle-golden.pglite.test.ts`,
  persisted-parity, scenario, select-bookmaker, the-odds-api/adapter, odds-card-parity.golden,
  predict*. Todos verdes com os campos novos present-but-undefined.
- **Byte-parity dedicado**: bytes de output do predict pra `over_under` E `correct_score`
  idênticos antes/depois dos campos do discriminante.
- **Invariante duro**: caminho scorer não importa/chama `computeMarketImpliedProbabilities`.
- **Novos**: cartuchos (schema/build-input/user-message); regra correct_score (cs_2_1 won, off-grid
  4-0 lost, null→throw); `collect-independent-binaries` (book único, drop odd<=1, sem overround);
  `deriveIndependentImplied` (teto); `ensureScorerSelections` (idempotência + race + re-read);
  `getFixtureEvents` normalize (own-goal excluído, pênalti creditado, ET/shootout excluído,
  borda regulation-90); settlement 4 casos + own-goal/ET; seed-parity pglite (labels).
- **Caveat pglite** [[pglite-suite-high-core-flake]]: verificar com `--no-file-parallelism` ou
  `--poolOptions.forks.maxForks=2` (flake local high-core; CI 2-core verde).

```bash
pnpm typecheck && pnpm lint && pnpm test --no-file-parallelism
```

## Riscos residuais

1. **Fio `bet_92/212` NÃO verificado** (liga pausada): se `value` traz `playerId` numérico ou só
   nome é desconhecido. Nome-only força match canônico entre dois endpoints (odds vs
   `/fixtures/events`) com grafias possivelmente diferentes — colisão confiante-errada mis-settla
   won/lost em vez de pending. **Mitigação**: prefer-skip em match ambíguo + inspecionar o 1º
   payload real antes de confiar no matching. É o único ponto onde uma premissa errada mis-settla.
2. **Shapes own-goal/penalty/ET de `/fixtures/events` NÃO verificados** — normalizer validado
   contra payload real, não "parece certo".
3. **`minEdgePp=8`** é chute sem backtest (D9-live-only). Alto demais → scorer quase nunca dispara
   non-pass → D9 data-starved; baixo demais num favorito de margem pequena → pouco conservador.
4. **`ensureScorerSelections`** cresce `market_selections` 1 linha por canonical player; drift de
   nome (acentos) sem `playerId` estável pode dividir o histórico de um jogador em 2 linhas.
5. **Egress extra**: `settle.ts` faz um 2º fetch per-match (`getFixtureEvents`) pros matches
   scorer-pending — carga nova num budget compartilhado cuja baseline a ADR 0025 admite não-medida.
6. **first_scorer (bet_93) diferido** — se o dono esperava 92/93/212 ao vivo em #290, isso é
   parcial; corte correto mas ratificado na emenda, não assumido.

## Critério de saída

- PR1: typecheck+lint+test verdes; checks do PR verdes; correct_score selecionável por admin pro
  Brasileirão; settla sobre o placar 90'; mergeado.
- PR2: idem + emenda ADR 0025 anexada; scorer/assist selecionável por admin; settlement
  prefer-skip comprovado por teste nos 4 casos; rede #288 byte-parity intacta; `Closes #290`;
  HANDOFF-290 escrito + prompt de kickoff (não há próxima sessão deste arco, mas registrar o
  estado: cauda pós-pivot = #203, arcos #225–#231, e #246 por último).

---

## Correções do plan-review (2026-06-17, confirmadas vs código) — PRECEDÊNCIA

5 lentes adversariais verificaram o corpo acima contra o código real; cada BLOCKER/MAJOR foi
**re-verificado independentemente**. PR1 (correct score) passou com **só 1 MINOR** (C9). PR2
ganhou 3 BLOCKERs + vários MAJORs. Estas correções **substituem** o que conflitar no corpo.

### BLOCKERs

- **C1 — O adapter de odds api-football NÃO roteia/busca `bet_92/212`.** (3 lentes.)
  `ApiFootballOddsAdapter.supportsMarket` (`adapter.ts:82-90`) só retorna true pra `bet_10`;
  `getOddsForSport` (`:92-116`) ignora `_options` e chama `getCorrectScoreOdds` (bet=10
  hardcoded, `client.ts:221-234`); The Odds API rejeita todo `bet_*` (`the-odds-api/adapter.ts:90`).
  Logo `OddsFallbackProvider.pick()` (`fallback-provider.ts:51-64`) **throw "nenhum provider
  único cobre"** antes de qualquer fetch. A frase do corpo "(roteador #289 manda bet_92/212)" é
  **FALSA**. **Fix — NOVO commit de PR2 ANTES do fork do predict** (entre os atuais commits 3 e 4):
  (a) `constants.ts`: `BET_ID_ANYTIME_SCORER=92`, `BET_ID_ASSIST=212`, `ANYTIME_SCORER_PROVIDER_KEY="bet_92"`,
  `ASSIST_PROVIDER_KEY="bet_212"`; (b) `client.ts`: generalizar `getCorrectScoreOdds` →
  `getOddsByBetId(leagueId,season,betId)` (ou irmãos `getScorerOdds`/`getAssistOdds`); (c)
  `supportsMarket` → true pra `{bet_10,bet_92,bet_212}` no sportKey BR; (d) `getOddsForSport`:
  branch em `options.markets[0]` (deixa de ser `_`), correct_score **byte-idêntico**, normalizar
  o payload de jogador no MESMO `NormalizedOddsEvent` carimbando o provider key pedido (difere de
  `normalizeOddsItem`, que filtra só `bet.id===10`); (e) testes `fallback-provider.test.ts`
  (`bet_92/212`→primary) + `adapter.test.ts` (fetch scorer). Mantém paridade #288 (namespace
  `bet_*` já é cedido pela The Odds API). **Wire `bet_92/212` NÃO verificado** → prefer-skip +
  inspecionar 1º payload (adicionar à lista de riscos e à emenda).

- **C2 — O nome do jogador nunca chega à view + sem entry de presentation pra
  `anytime_scorer`/`assist` ⇒ crash no render.** (2 lentes; BLOCKER, mais forte que o relatado.)
  `selectionLabel` é mapa puro com fallback=key (`presentation.ts:79-85`); `getMarketPresentation`
  **throw** em key desconhecida (`:301-307`), chamado em `analysis.ts:270/457/491`,
  `dashboard.ts:47/304`, `best-bet.ts:91/96`. A view lê `marketSelections.key` (`predictions.ts:114`),
  nunca `.label`. **Fix**: (a) `ensureScorerSelections(marketId, players:{key,label}[])` — persistir
  o NOME no `market_selections.label` (coluna NOT NULL; label = `canonicalName` do bundle de odds,
  já que `playerId` pode faltar); (b) threadar o label até a view: `predictions.ts:111-126` passa a
  selecionar `marketSelections.label`, widen do carrier `selections[]` (`predict.ts:78`,
  `analysis.ts:65`) com `label?`, e pra mercados `dynamicSelections` usar `selection.label` em vez
  de `presentation.selectionLabel(key)` no `BetReference` (`analysis.ts:362`), nos
  `outcome/scenarioLabel` (`:206-207`), no `recToken` do dashboard (`dashboard.ts:47`) e no
  `recent-prediction.ts:43`; (c) **ADICIONAR entries `anytime_scorer` + `assist` ao REGISTRY**
  de `presentation.ts` (`marketLabel "Artilheiro"/"Assistência"`) pra não dar throw; (d) teste de
  view: renderiza o NOME do jogador, não `scorer_p<id>`.

- **C3 — `getFixtureEvents` é método NOVO obrigatório na interface ⇒ quebra typecheck em
  3 classes de produção + 6 mocks de teste.** (Confirmado, mais sítios que o relatado.) `ProviderCapabilities`
  (`types.ts:157-162`) é fechado com 4 campos obrigatórios; 9 literais existem. **Fix**: (a)
  `supportsFixtureEvents?: boolean` **OPCIONAL** (os 9 literais compilam sem mudança;
  `FallbackProvider` lê `=== true`); (b) `getFixtureEvents` é método **REQUIRED** novo →
  enumerar e tocar os stubs: produção `api-football/adapter.ts` (impl real),
  `football-data-org/adapter.ts` (`SportsDataUnsupportedError`), `fallback-provider.ts` (delegate
  gated); mocks `predict.test.ts:78`, `predict.match-result.test.ts:59`, `predict.btts.test.ts:62`,
  `predict.double-chance.test.ts:58`, `sync-upcoming-fixtures.test.ts:47`, `fallback-provider.test.ts:42`
  (cada um ganha `getFixtureEvents: vi.fn()`); (c) **corrigir a estratégia de teste**: `predict*`/
  `fallback-provider`/`sync-upcoming-fixtures` **NÃO** são "re-rodar inalterado" — precisam de 1
  linha de mock (comportamento idêntico, intenção byte-parity preservada, mas o arquivo muda).

### MAJORs

- **C4 — `minEdgePp` NÃO é "thread" em `computeStakeUnits`.** (3 lentes.) `computeStakeUnits`
  (`staking.ts:11-19`) é **sizer** de stake (bandas 8/12), não gate de pass; não há `5` pra
  preservar; o piso de 5pp vive no **PROMPT** (decisão pass do LLM; `scenario.ts:84-86`,
  `match_result/prompt.ts:24`). **Fix**: `computeStakeUnits` **ZERO diff**. O piso scorer (8pp)
  vive no **prompt do cartucho scorer** (hardcode "8 pontos percentuais" + teste `toContain`
  dedicado, espelhando `over_under/prompt.ts:9` que hardcoda 5). Manter `minEdgePp?: number` no
  descriptor como **fonte única** do número (default 5 partition / 8 scorer), consumido por
  (i) o literal do prompt scorer e (ii) a view (C5). Emenda: `minEdgePp` é piso **de prompt**,
  não mudança de banda de stake. Invariante: `staking.ts` recebe zero diff de comportamento partition.

- **C5 — `MIN_EDGE_PP=5` vaza pra view do scorer em 4+ superfícies.** (2 lentes.) A view é
  market-agnóstica e hardcoda 5: `analysis-scenarios.tsx:159` (rodapé), `:250` (HelpHint #edge),
  `analysis.ts:384` (`minEdgeLabel`), `:179` (frase PASS). Scorer (8pp) mostraria "5pp" → "UI
  mente". **Fix**: threadar o `minEdgePp` do mercado pela view — `analysis.ts:384/:179` derivam de
  `descriptor.minEdgePp` (via o mercado da predição) em vez da constante; passar o threshold/label
  como **prop** pro `AnalysisScenarios` (`:159`/`:250`) — vindo de `scenario.ts`/número puro,
  **nunca** de `lib/ai` (pureza de bundle). Default partition = 5 → over_under/correct_score
  byte-idênticos (pinar no teste de byte-parity). Teste: scorer renderiza "8pp". Páginas estáticas
  de ajuda (`glossary.ts`, `como-funciona-content.tsx`) = **residual conhecido** (descrevem o piso
  partition); registrar, não bloquear.

- **C6 — `best-bet.ts:49` é um SEGUNDO chamador de `computeMarketScenarios`** que Σ=1-deflaciona o
  edge yes-only do scorer no **ranking** "melhor aposta do jogo". (Confirmado: scorer sobrevive ao
  `capCandidates` — 5<6 candidatos pro admin BR.) **Fix**: quando `computeMarketScenarios` ganhar o
  arg `marketKind` (default `'partition'`), atualizar **AMBOS** `analysis.ts:294` E `best-bet.ts:49`
  pra passar `getDescriptor(marketKey)?.marketKind ?? 'partition'`. No branch `independent_binary`,
  `computeRank` usa o edge-teto por jogador (`modelProb - (1/odd)*100`), não o caminho Σ=1.
  Invariante de teste: `grep computeMarketScenarios` em `lib/`+`app/` ⇒ os dois call-sites threadam
  `marketKind`; o default (ausente ⇒ partition) é byte-parity-safe.

- **C7 — `selectionKeys` é `const` capturado em `predict.ts:521`** reusado em 3 sítios
  (`deriveImplied` 531-557, PSO 883, grid de retorno 993). Com `selectionKeys:[]` no descriptor
  scorer, tudo itera vazio. **Fix**: binding condicional `const selectionKeys = isIndependentBinary
  ? scorerBundle.players.map(p=>p.key) : cartridge.descriptor.selectionKeys;`. O bundle JÁ está
  adquirido antes da linha 521 (**sem reordenar** o bloco de odds — a alegação "ordering after 521"
  foi REFUTADA). Corrigir o texto do step 6: a **fórmula** de edge é reusada verbatim, mas o
  **binding** de `selectionKeys` é forkado (não é byte-idêntico pro scorer).

- **C8 — Widening de `result_data`: ordem merge-vs-parse é load-bearing** (Zod v4 `z.object` faz
  strip de chaves desconhecidas por default → `scorers` somem → regra throw → PENDING eterno).
  **Fix**: PIN do contrato — montar o `resultData` scorer via um **único** `.parse()` do schema
  **inteiro já alargado** (todas as chaves num objeto só, após o fetch de events), OU **spread** das
  chaves novas sobre o objeto de `resultDataFromRegulationScore` **sem re-parse**; **NUNCA**
  re-parsear objeto merged contra um sub-schema. O objeto entregue a `computeSettlement` E a
  `insertOutcomeIfAbsent` deve ser idêntico e conter as chaves scorer. Teste round-trip (pglite):
  outcome `anytime_scorer`/`assist` lido de volta de `prediction_outcomes` **contém** `scorers[]` +
  `eventsAvailable` (não só que `computeSettlement` retornou won/lost). Também widen do **mirror
  local** `SettlementMetricResultData` (`presentation.ts:31-35`) com `scorers?`/`eventsAvailable?` +
  `settlementMetricValue` scorer/assist (`'artilheiro (90'')'`/`'assistência (90'')'`), mantendo
  pureza (sem import de `@/lib/settlement`/`@/lib/db`).

### MINORs

- **C9 (PR1) — flip de `market-catalog.test.ts` sub-especificado**: (a) adicionar
  `{ key:'correct_score', label:'Placar exato' }` ao fixture `ALL` (`:112-117`, por último);
  (b) atualizar o esperado de `brasileirao_a` (`:129-132`) pra incluir `correct_score`; (c)
  deixar `world_cup` (`:119-126`) e `champions_league` (`:133-136`) **inalterados**
  (`coveredLeagues=['brasileirao_a']` dropa lá); (d) reescrever o título do teste em `:128`. (O
  título "FORA de ALL_DESCRIPTORS" fica em `market-descriptor.test.ts`, já coberto pelo corpo.)

- **C10 — "Yield-by-player agrega em SQL puro" é claim solto.** O dashboard segrega **só por
  `marketKey`** (`kpis.ts:288-308`); não há agregação por jogador. **Fix**: suavizar a frase (corpo
  linha ~182) — a graduação D9 do scorer roda no **segmento agregado `anytime_scorer`** (suficiente
  pro critério); persistir `selectionId` real deixa Yield-by-player como query SQL **FUTURA**, fora
  do escopo de #290.

### Sequência de commits PR2 — REVISADA

`C0` Seam `getFixtureEvents` + `supportsFixtureEvents?` opcional + impl af + FDO stub + delegate +
**os 6 mocks de teste** (C3). → `C0b` widening `result_data` + mirror de presentation (C8). →
`C0c` discriminante de descriptor (`marketKind`/`dynamicSelections`/`minEdgePp`) + `ANYTIME_SCORER`+
`ASSIST` em `ALL_DESCRIPTORS` + teste byte-parity. → **`C0d` (NOVO, C1) adapter de odds
`bet_92/212`** (constants+client+supportsMarket+getOddsForSport branch+normalize+testes). →
`C1` `collect-independent-binaries` + `deriveIndependentImplied` (teto; invariante: não chama
`computeMarketImpliedProbabilities`). → `C2` `ensureScorerSelections(marketId,{key,label}[])` (C2,
separado de `resolveMarketCatalog`). → `C3` cartuchos `anytime_scorer`+`assist` (prompt com 8pp
hardcoded + teste `toContain`, C4). → `C4` fork no `predict.ts` (binding condicional de
`selectionKeys` C7; sem mudar `computeStakeUnits` C4). → `C5` settlement (factory + threading off
`settlementRuleKey`; round-trip test C8). → `C6` view honesty (entries de presentation C2;
`minEdgePp` na view C5; `marketKind` em `analysis.ts:294` **e** `best-bet.ts:49` C6). → `C7`
migration (markets-row-only, sem `market_selections`) + emenda ADR + HANDOFF-290.
