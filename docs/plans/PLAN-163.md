# PLAN — #163 Generalizar odds math para N seleções (paridade exata)

> Fase 2, passo 1 (base p/ #164/#165). Funções PURAS, sem DB/LLM. Critério-mestre:
> **paridade bit-a-bit em N=2** + N≥3 novo + zero consumidor quebrado. ADR 0018 é a spec.
> **v2 — incorpora as 10 emendas do plan-review adversarial (verdict SHIP_WITH_AMENDMENTS).**

## Princípio de design (expand-migrate-contract)

A forma N-ária é a CANÔNICA; o binário é o **caso particular implementado via N-ário**
(literalmente "binário = caso particular", não `if (n===2)`). Os 5+2 consumidores binários
NÃO mudam neste PR (migram em #164/#165/Fase 3). Paridade trivial porque a assinatura/shape
binária é preservada e delega ao core N-ário com a MESMA ordem de operações float.

### Contrato / downstream (DESVIOS DELIBERADOS do texto literal do #163/ADR 0018 — emenda 4)
Duas divergências do texto literal, ambas conscientes e corretas:
- **(a) Nome do core N-ário = `computeMarketImpliedProbabilities`** (o issue/ADR dec.1 escrevem
  `computeImpliedProbabilities(number[])`). O nome binário `computeImpliedProbabilities(over,under)`
  é RETIDO para o wrapper bit-exato de churn-zero — daí o core precisa de nome próprio.
- **(b) Campo = `overround` (FRAÇÃO, `sum−1`), NÃO `overroundPct`** (o issue ilustra `overroundPct`).
  Os 3 consumidores tratam overround como fração e multiplicam por 100 downstream
  (`view/odds.ts:28`, `fetch-and-snapshot.ts:120`, `scripts/test-odds-api.ts:125`) — percentual
  quebraria paridade + semântica.
- **#164/#165 devem importar `computeMarketImpliedProbabilities` e ler `.overround` (fração).**
  Em #164, trocar `select-bookmaker.ts:34` (`1/over+1/under−1`) por
  `computeMarketImpliedProbabilities(odds).overround` — o reduce-a-partir-de-0 preserva a ordem
  float legada, então o pick do bookmaker de menor overround continua bit-exato.

## Mudança 1 — `lib/odds/implied-probability.ts`

Hoje: `computeImpliedProbabilities(overOdd, underOdd): { overProb, underProb, overround }`
com `overround = sum − 1` (FRAÇÃO, ex. 0.039136), 5 consumidores destructuram esse shape.

Plano:
- **Core N-ário novo** (canônico): `computeMarketImpliedProbabilities(odds: number[]): { probs: number[]; overround: number }`.
  - `raw_i = 1/odds[i]`; `sum = raw.reduce((a,b)=>a+b, 0)`; `probs_i = raw_i/sum`; `overround = sum − 1`.
  - `overround` permanece **FRAÇÃO** (ver Contrato acima).
  - Valida cada odd (`Number.isFinite(o) && o > 1`); throw em odd inválida. Array vazio → throw.
    N=1 é matematicamente computável (prob=1) mas `overround=sum−1` é **sem sentido para N<2** —
    o menor mercado real é N=2 (ADR 0018:64-67); callers NÃO devem ler overround com N<2 (emenda 10).
- **Wrapper binário** (assinatura + shape + name preservados, churn zero):
  `computeImpliedProbabilities(overOdd, underOdd)` continua, agora delega:
  - Mantém `assertValidOdd("over", overOdd)` / `assertValidOdd("under", underOdd)` ANTES de delegar.
    Nenhum teste pina o TEXTO da mensagem (todos os `toThrow()` são sem argumento — emenda 8); a
    validação-antes-de-delegar é preservada só pela ORDEM (governa qual odd é reportada) e
    continuidade de debug. **NÃO** adicionar asserts de igualdade de mensagem.
  - `const { probs, overround } = computeMarketImpliedProbabilities([overOdd, underOdd])`
  - retorna `{ overProb: probs[0], underProb: probs[1], overround }`.
  - **Bit-exatidão provada:** reduce a partir de 0 → `(0+rawOver)+rawUnder === rawOver+rawUnder` em
    IEEE754 (soma de +0 é identidade); ordem idêntica; `probs[i]=raw_i/sum` e `overround=sum−1`
    idênticos. ⇒ os 6 goldens de `implied-probability.test.ts` passam SEM mudar valores.
- Tipos `Overround`, `ImpliedProbabilities` preservados.

## Mudança 2 — `lib/odds/scenario.ts`

`MIN_EDGE_PP`, `computeEvPerUnit`, `computeBreakEvenProbPct`, `computeModelBreakEvenOdd` JÁ são
por-escalar/por-seleção (ADR 0018 dec. 3) → **inalterados** (MIN_EDGE_PP NÃO sai daqui).

Adições N-árias (canônicas, consumidas por #164/#165/Fase 3):
- `computeSelectionEdgePp(modelProbPct, impliedProbPct): number` — helper puro `model − implied`.
- `computeMarketScenarios(input: { selections: { key; modelProbPct; odd: number|null }[]; recommendedKey: string|null }): { selections: ScenarioSelection[]; recommended: string|null }`
  - `ScenarioSelection = { key; modelProbPct; impliedProbPct|null; odd|null; edgePct|null; evPerUnit|null; breakEvenProbPct|null; modelBreakEvenOdd }`.
  - **`recommendedKey` é ECHO/PASS-THROUGH** (emenda 5): o LLM/prompt é dono do gatilho
    `edge ≥ MIN_EDGE_PP` (ADR dec.2), espelhando como `computeScenarios` passa `input.recommendation`
    adiante (`scenario.ts:113-114`). `computeMarketScenarios` **NÃO** deriva a recomendação dos edges
    (MIN_EDGE_PP é só display, `scenario.ts:3-9`). Isso evita scope-creep no #165.
  - implícita: **se TODAS as odds presentes** → `computeMarketImpliedProbabilities(odds[])`; edge_i =
    `model_i − implied_i`. **Se QUALQUER odd ausente** (emenda 7) → TODAS as implícitas/edge do
    mercado = null (não dá pra normalizar mercado parcial — Σraw incompleto). `modelProbPct` e
    `modelBreakEvenOdd` ainda derivam. EV/break-even por seleção na **odd CRUA** (ADR dec.3). SEM `100−x`.
  - PURA de inputs (model probs + odds). NÃO replica a precedência "salvo vence recomputado" do
    `computeScenarios` binário (lógica de VIEW atada a `.toFixed(2)` do DB — fica no binário até Fase 3).
- Comentário de premissa binária (`:88-90`, cita ADR 0003) → reescrever cobrindo AS DUAS METADES
  (emenda 9): (a) a forma canônica agora é N-vias (ADR 0018 dec.5); (b) a derivação `100−x` do
  lado oposto no `computeScenarios` binário é um **adaptador de view legado DELIBERADO** pros valores
  congelados `.toFixed(2)`, aposentado em #170 — NÃO é caminho N-ário vivo nem esquecimento. O issue
  pede "remover a invariante 100−x": satisfeito tornando o core N-ário (sem 100−x) o canônico; o
  adaptador binário mantém 100−x até #170 migrar a view.

**`computeScenarios` (binário) FICA** servindo a view atual (`view/analysis.ts`,
`analysis-scenarios.tsx`) — NÃO mexer no shape `{over, under, recommended}` nem na precedência
(saved-value-wins / `100−x` lado oposto / pass recompute), paridade load-bearing dos congelados.
Decisão: manter como está (menor risco).

## Testes

- `implied-probability.test.ts`: preservar os 6 goldens binários intactos (provam paridade).
  ADICIONAR:
  - bloco N-ário pro core: N=3 (1X2 `2.10/3.40/3.60`) com **goldens full-precision a precisão 6**
    (emenda 2/3 — NÃO usar os valores 2dp display do ADR a precisão 4/6, falham): `probs` (×100) =
    `45.43430 / 28.06236 / 26.50334`; `overround = 0.0480859`. N=2 idêntico ao binário; erros
    (array vazio, odd ≤1, não-finito).
  - **teste de equivalência direta wrapper↔core (emenda 10), com `toBe` (exato):** p/ alguns pares
    `computeImpliedProbabilities(o,u)` deep-equals `{overProb: core([o,u]).probs[0], underProb:
    core([o,u]).probs[1], overround: core([o,u]).overround}` — trava o contrato bit-exato.
- `scenario.test.ts`: preservar os ~16 goldens binários. ADICIONAR:
  - `computeSelectionEdgePp` (incl. `52 − 45.43430 = +6.5657`).
  - `computeMarketScenarios` N=3 (1X2 do ADR), pinando **TODOS OS 3** os campos por seleção (emenda 2):
    - `impliedProbPct`: 45.43430 / 28.06236 / 26.50334
    - `edgePct`: +6.5657 / −1.0624 / −5.5033
    - `evPerUnit`: 0.0920 / −0.0820 / −0.2440  (`0.52·2.10−1`, `0.27·3.40−1`, `0.21·3.60−1`)
    - `breakEvenProbPct`: 47.61905 / 29.41176 / 27.77778
    - `modelBreakEvenOdd`: 100/52 / 100/27 / 100/21
  - **assert estrutural de morte do 100−x (emenda 1):** `Σ impliedProbPct ≈ 100`; p/ todo par (i,j)
    `edge_i !== −edge_j`; `modelProbPct` passa intacto (sem complemento derivado).
  - **N=3 `recommendedKey=null`** (nenhuma seleção ≥ MIN_EDGE_PP — espelha o pass binário,
    `scenario.test.ts:135`).
  - **N=3 mercado parcial (emenda 7):** uma odd ausente → as 3 seleções com implied/edge null,
    `modelProbPct`/`modelBreakEvenOdd` retidos.
- Float via `toBeCloseTo` (precisão 6 onde os goldens são full-precision; precisão 2 só se pinar 2dp);
  igualdade exata `toBe` só no teste de equivalência wrapper↔core. Nenhum teste chama Anthropic/DB.

## Critérios de saída
- [ ] N=2 bit-a-bit com hoje (6+16 goldens binários inalterados passam)
- [ ] N=3 do ADR 0018 coberto (3 seleções, todos os campos), incl. assert estrutural de morte do 100−x
      e o caso de mercado parcial
- [ ] `computeMarketScenarios` aplica **zero** derivação `100−x`; implied/edge de cada seleção
      computados independentemente
- [ ] `pnpm test` (vitest.config já exclui `.claude/`/`.next`) + `pnpm lint` (eslint.config:21-27 já
      ignora) verdes; p/ `pnpm typecheck`, scopear aos arquivos mudados SE as cópias do `.claude`
      worktree (49.948 `.ts`; tsconfig.json:26 exclui só node_modules) poluírem — condição de ambiente
      pré-existente, fora de escopo do #163. **NÃO** inventar flag `tsc --exclude`.
- [ ] Zero consumidor binário tocado (5 de implied + 2 de scenarios intactos); zero `if (n===2)`
- [ ] MIN_EDGE_PP intacto em `lib/odds/scenario.ts`
