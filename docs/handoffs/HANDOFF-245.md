# HANDOFF — #245 seleção de múltiplos mercados (analisar tudo de uma vez)

> Continuidade entre sessões (vive em `docs/handoffs/`, versionado — snapshot de um
> ponto no tempo, não spec viva). 5ª da fila pós-pivot (ordem: [[work-order-post-pivot]]).
> Depende de #243 (seções colapsáveis — MERGED, PR #297) e encaixa no que #244 (MERGED,
> PR #298) deixou. Snapshot 2026-06-16, aterrado no CÓDIGO real pós #243+#244.

## O que é
Hoje o disparo de NOVA análise é **single-select**: o usuário escolhe UM mercado (sem
seção ainda) e dispara. **#245:** marcar **2+ mercados** e rodar **todos de uma vez** —
cada mercado vira sua própria predição + aiCall (custo cobrado por mercado) e aterrissa
na **sua seção colapsável** (já existe, #243).

## ⚠️ #245 ≠ #178 (NÃO conflar)
- **#178 / `analyzeBestBet`** (`app/actions/predictions.ts`): fan-out AUTOMÁTICO sobre os
  mercados candidatos + escolhe o **MELHOR edge** (cross-mercado "melhor aposta", UM
  vencedor destacado). Renderiza `BestBetPanel`/`best-bet-results`. **Fora de escopo.**
- **#245:** o USUÁRIO escolhe QUAIS mercados; **TODOS** os escolhidos são analisados e
  mostrados (sem "melhor" pick), cada um na sua seção. É exposição de seleção, não
  ranking.

## ⚠️ O corpo do #245 tem line refs PRÉ-#244 (desatualizadas)
Cita `analyzeMatch (app/actions/predictions.ts:48-161)`, `checkAnalysisRateLimit
(~72-81)`. Pós #244 esses shiftaram. Construir contra o estado REAL abaixo.

## Ler primeiro / estado do código (pós #243 + #244)
- `gh issue view 245 -R fernandolisboa/palpiteiro-claude` (escopo + 5 ACs).
- **`app/actions/predictions.ts`**:
  - `analyzeMatch(prev, formData)`: SINGLE-mercado. Lê `matchId` + `marketKey` +
    `modelOverride`; **1 slot de rate-limit = 1 call** (`checkAnalysisRateLimit`, ADR
    0023). Usado por `SectionFooterDispatch` (reanálise por seção, #244) **e** por
    `NewAnalysisForm`. **NÃO mudar a semântica single dele** (o footer depende).
  - `analyzeBestBet(...)`: a **engine de fan-out JÁ EXISTE** aqui. Faz: pré-aquece odds
    *additional* (btts/dupla chance) por mercado em chamadas próprias (falha de um =
    erro POR mercado, sem abortar irmãos); chama **`runFanOut(...)`** (de
    `lib/ai/best-bet.ts`) = **fan-out SERIAL, `predict()` por mercado, best-of-successful,
    erro isolado por mercado**; lê `getAiCallById` por sucesso pro custo. **#245 reusa
    `runFanOut` / esse padrão** — NÃO reescrever fan-out do zero.
  - **Rate-limit (LANDMINE de dinheiro real):** `analyzeBestBet` credita **1 slot pro RUN
    inteiro** (até `MAX_FANOUT_MARKETS` predict() pagos) e o comentário em
    `predictions.ts:394-398` AVISA que "o teto diário não foi rederivado pra esse
    multiplicador — re-avaliar ANTES de ligar a flag". O **AC do #245 exige o contrário**:
    "custo/rate-limit refletem **N análises (N mercados)**". Então **#245 deve creditar N
    slots** (proporcional), não 1/run. Decisão a documentar no PR.
- **`lib/ai/best-bet.ts`**: `runFanOut`, `MAX_FANOUT_MARKETS = 6`, `MAX_ADDITIONAL_FETCHES`.
  A engine serial reusável + os tetos.
- **`components/new-analysis-form.tsx`** (#244): o dispatcher do TOPO, hoje **single-select**
  (`MarketSelect` sobre `unanalyzedMarkets` + hidden `marketKey` + `AnalyzeCTA`; descarta
  `state.view` — a nova análise aparece como SEÇÃO via revalidate). **É o ponto de
  integração do #245**: vira **multi-select** (checkboxes/chips) sobre `unanalyzedMarkets`,
  submetendo `marketKeys[]`. Default: over_under marcado.
- **`components/section-footer-dispatch.tsx`** (#244): reanálise POR seção, single-mercado.
  **NÃO tocar** — reanalisar 1 mercado existente é o footer; #245 é só o disparo NOVO
  multi-mercado do topo.
- **`lib/view/analysis.ts` `toMarketAnalysisSections`** (#243): agrupa o histórico por
  mercado → 1 seção por mercado. **A integração com seções é AUTOMÁTICA**: a action
  escreve N predições + `revalidatePath('/match/[id]')` → a página reagrupa → N seções
  aparecem. #245 NÃO precisa renderizar o agregado inline (espelha o NewAnalysisForm
  descartando `state.view`).
- **`lib/db/queries/market-catalog.ts`**: `marketsForAudience(isAdmin)` (gate
  `isActive` + `isGraduated`) ∩ `marketsForLeague` (#158, cobertura de liga). A página já
  computa `selectableMarkets` daí e passa pro painel → o multi-select usa a MESMA lista.

## Escopo (do #245)
- **UI multi-select** no `NewAnalysisForm`: checkboxes/chips sobre `unanalyzedMarkets`
  (mercados sem seção ainda). Default over_under marcado. Submete `marketKeys[]`.
- **Action de fan-out multi-mercado** (provável NOVA action, ex. `analyzeMarkets`, pra
  preservar `analyzeMatch` single p/ o footer): reusa `runFanOut` sobre os `marketKeys`
  escolhidos; escreve 1 predição por mercado; `revalidatePath`; retorna um SUMÁRIO
  por-mercado (sucesso/erro) p/ feedback de falha parcial. NÃO renderizar agregado inline.
- **Rate-limit**: creditar **N slots** (N mercados), não 1/run (AC). Documentar no PR.
- **Falha parcial**: um mercado sem odds não derruba os outros (`runFanOut` já isola erro
  por mercado) → os ok viram seções, os que falharam viram um aviso (quais falharam).
- **Loading**: feedback de progresso por mercado (ou agregado) durante o fan-out serial.

## Invioláveis / landmines
- **DINHEIRO REAL:** N mercados = N `predict()` pagos. Creditar N slots; respeitar
  `MAX_FANOUT_MARKETS`. Se rodar em debug, mencionar no PR (gotcha "custo de tokens").
- **NÃO mudar `analyzeMatch` (single, 1 slot = 1 call)** nem `SectionFooterDispatch` — a
  reanálise por seção (#244) é single-mercado. Fan-out é action separada.
- **Reusar `runFanOut`** (serial, erro isolado, best-of-successful) — não duplicar o
  fan-out cross-mercado do #178.
- over/under sozinho (seleção única) = idêntico ao #244 (AC). Multi-select degenera p/
  single no caminho de produção (over_under só).
- Mercados do multi-select = `marketsForAudience ∩ marketsForLeague` (gate de
  audiência/liga server-side; re-validar no server, nunca confiar no POST).
- Resultados aparecem como seção via `revalidatePath` + `toMarketAnalysisSections` — não
  reinventar render. Mercado novo = seção nova (key=marketKey, #244).
- SEM migration de schema (predições/aiCalls/markets já suportam N mercados).
- Lógica em `lib/` (a engine de fan-out já está em `lib/ai/best-bet.ts`).
- CI = GH Actions (typecheck+lint+test). **pglite flaka local multi-core** → validar com
  `pnpm test -- --no-file-parallelism` (CI 2-core é verde) — ver [[pglite-suite-high-core-flake]].
- Agentes de review = **read-only no git** — ver [[workflow-agents-mutate-checkout]];
  re-checar a branch depois.

## Decisões abertas (resolver no plano / plan-review)
1. **Nova action `analyzeMarkets(marketKeys[])` vs expandir `analyzeMatch`** — preferir
   NOVA (preserva o single do footer; reusa `runFanOut`). Confirmar.
2. **Rate-limit: N slots vs 1/run** — AC pede N. Como creditar N em `checkAnalysisRateLimit`
   (chamar N×? um increment de N?). Aterrar em `lib/rate-limit.ts`.
3. **Serial (reusa `runFanOut`) vs `Promise.all`** — serial reduz pico de custo/quota e já
   existe; o issue aceita serial. Default: serial.
4. **Default da seleção**: só over_under marcado vs todos os unanalyzed marcados. Issue diz
   over_under default.
5. **Submeter `marketKeys[]`** via N hidden inputs com mesmo `name` (FormData.getAll) vs
   CSV num input. `FormData.getAll("marketKeys")` é o idiomático.
6. **Feedback de falha parcial** no `NewAnalysisForm` (que hoje descarta `state.view`):
   precisa do sumário por-mercado pra listar os que falharam — definir a forma do retorno.

## Critério de saída (5 ACs do #245)
Marca 2+ mercados → dispara 1× → 1 análise por mercado, cada na sua seção; custo/rate-limit
refletem N análises (documentado no PR); falha de 1 mercado não impede os outros; over/under
sozinho = idêntico ao atual; `typecheck`/`lint`/`test` verdes.

## Cluster
#243 (✓) → #244 (✓) → **#245** (este) → resto do pós-pivot (#288…) → **#246** (polish
visual amplo / de-slop, POR ÚLTIMO, com a skill impeccable — inclui dedup do label de
modelo do footer #244). Construir modular.

## Fluxo da sessão (padrão do repo)
explorar (fresco) → plano → **plan-review** (é disparo PAGO + toca a action/rate-limit →
gate de 2 rodadas, [[two-round-plan-gate-for-pivot]]) → implementação → code review →
merge verde.
