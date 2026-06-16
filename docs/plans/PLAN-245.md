# PLAN — #245 seleção de múltiplos mercados (analisar tudo de uma vez)

> Plano de implementação pré-issue (vive em `docs/plans/`, versionado — snapshot).
> Aterrado no CÓDIGO real pós #243 (PR #297) + #244 (PR #298). 5ª da fila pós-pivot.
> Lê junto: [`docs/handoffs/HANDOFF-245.md`](../handoffs/HANDOFF-245.md).
> **Rev 2** — incorpora o gate de plan-review round-1 (1 blocker + 5 should-fix + nits).

## Objetivo (5 ACs do #245)
Usuário marca **2+ mercados** no dispatcher do topo, dispara **1×**, e recebe **uma
análise por mercado** — cada uma na sua **seção colapsável** (já existe, #243).
Custo/rate-limit refletem **N análises (N mercados)**; falha de 1 mercado não derruba os
outros; over/under sozinho = idêntico ao atual; `typecheck`/`lint`/`test` verdes.

**#245 ≠ #178**: o usuário ESCOLHE quais mercados (todos são mostrados, sem "melhor").
`analyzeBestBet` (fan-out automático + best-edge, atrás de flag) fica **100% intocado**.

## Decisões (resolvendo as 6 abertas do handoff)
1. **NOVA action `analyzeMarkets(marketKeys[])`** em `app/actions/predictions.ts`.
   `analyzeMatch` (single) e `SectionFooterDispatch` ficam **intocados** — a reanálise por
   seção (#244) continua single-mercado, 1 slot = 1 call. `analyzeMatch` segue VIVO (usado
   pelo footer) — não vira dead code.
2. **Rate-limit = N slots (consumo POR mercado)**, não 1/run. Upstash `.limit()`
   incrementa exatamente 1 por call e **não tem parâmetro de count** → creditar N = chamar
   `checkAnalysisRateLimit` **uma vez por mercado**, em loop, ANTES do spend. Degrada com
   graça quando o teto é atingido no meio do lote (ver §Rate-limit). Documentado no PR.
3. **Serial** — reusa `runFanOut` (`lib/ai/best-bet.ts`): `predict()` por mercado em ordem,
   erro isolado por mercado, best-of-successful **NÃO aplicado** (#245 mostra TODOS, sem
   ranking). **Não** reescrever fan-out nem usar `Promise.all`.
4. **Default = só `over_under` marcado** (se estiver entre os não-analisados; senão o 1º).
5. **Submeter `marketKeys[]`** via N `<input type="hidden" name="marketKeys">` →
   `formData.getAll("marketKeys")` (idiomático).
6. **Retorno = sumário por-mercado** (não view agregada inline). Forma em §Action.
7. **Pre-warm de odds: DUPLICAR o bloco inline** no `analyzeMarkets` (NÃO extrair helper, NÃO
   tocar `analyzeBestBet`). Decisão do plan-review: a extração mudaria o `console.info`
   (`additionalFetches`) do `analyzeBestBet` — path pago golden fora do escopo. ~15 linhas
   duplicadas < risco de regressão num path pago. Blast radius local.

---

## Action: `analyzeMarkets` (em `app/actions/predictions.ts`)

### Tipos (novos, exportados)
```ts
export type MarketRunStatus = "ok" | "failed" | "rate-limited";
export type MarketRunSummaryItem = {
  marketKey: string;
  marketLabel: string;        // label do allowlist server-side (NUNCA do POST)
  status: MarketRunStatus;
  message?: string;           // failed | rate-limited
};
export type AnalyzeMarketsResult =
  | { ok: true; summaries: MarketRunSummaryItem[] }
  | { ok: false; error: string };
```
`ok:false` é reservado a **rejeições totais pré-spend** (sem matchId/login/acesso, jogo
encerrado, nenhum mercado válido, fail-closed de KV, **zero slots** disponíveis). Uma vez
que ≥1 slot foi concedido e o fan-out rodou, é **sempre `ok:true`** com `summaries` — mesmo
se TODOS os predicts falharem. **Por quê** (≠ `analyzeBestBet`, que vira `ok:false` em
`view.entries.length===0`, predictions.ts:474-481): aqui já gastamos N slots e queremos o
**detalhe por-mercado** (qual falhou e por quê), não uma string de erro única — o banner
explica e nenhuma seção nova aparece. Decisão LOAD-BEARING (dinheiro já gasto) → **pinada por
teste** (§Testes caso 9).

### Corpo (gates LOAD-BEARING — espelha `analyzeMatch`/`analyzeBestBet`)
Ordem: **todos os gates grátis ANTES do 1º `checkAnalysisRateLimit`** (que CONSOME slot).
1. `matchId` = `String(formData.get("matchId"))`; vazio → erro; `z.uuid().safeParse` → erro.
2. `auth()` → sessão; sem `user.id` → "Faça login".
3. `getUserAccessState` → `access`; `null` → "sessão expirou"; `!allowed && !isEmailAllowed`
   → "acesso bloqueado" (mesma semântica do floor, ADR 0023 §3/§6).
4. `getMatchById` → `match`; `null` → "não encontrado"; `finished|cancelled` → erro
   (curto-circuita ANTES do pre-warm, market-agnóstico).
5. `isAdmin`; `modelOverride` gateado por `isModelAllowedForAudience` (idêntico aos outros).
6. **Allowlist server-side**:
   `allowed = marketsForLeague(await marketsForAudience(isAdmin), match.league)` →
   `{ key, label }[]` (audiência ∩ cobertura de liga). MESMA expressão de `analyzeMatch`/`page.tsx`.
7. **Seleção do usuário, re-validada + dedupada**:
   `raw = formData.getAll("marketKeys").map(String)`; `rawSet = new Set(raw)` (dedupe).
   `chosen = allowed.filter(a => rawSet.has(a.key))` → preserva `{key,label}` do **server**
   (não confia no POST; um `marketKeys=btts` numa liga sem cobertura é dropado aqui, sem
   gastar slot; duplicatas colapsam). `chosen.length === 0` → `{ ok:false, error:"Nenhum
   mercado válido selecionado." }`. **Ordem** = ordem determinística de `allowed`
   (`marketsForAudience`: over_under primeiro) — base de exibição do sumário.
8. **Cap**: `chosen = capCandidates(chosen, MAX_FANOUT_MARKETS)` (reusa o helper; mantém
   Tier-1; preserva ordem). Roda ANTES do loop de rate-limit → N-selecionados-mas-capados
   NUNCA sobre-cobra (≤ MAX_FANOUT_MARKETS slots).
9. **Rate-limit por mercado** (ver §Rate-limit) → `granted: {key,label}[]` (prefixo de
   `chosen`) + `rateLimited = chosen.slice(granted.length)`. Se `granted.length === 0`:
   retorno `ok:false` (fail-closed → copy de indisponível; cap → copy de "limite de N/dia").
10. **Pre-warm (DUPLICADO inline, sobre `granted` SÓ — nunca `chosen`/`rateLimited`, p/ não
    gastar crédito da The Odds API num mercado rate-limited)**:
    `extraLinesEnabled = await getEnableOverUnderExtraLines()`;
    `fanOut = granted.map(c => ({ marketKey:c.key, extraLines: resolveExtraLines(c.key, match.league, extraLinesEnabled) }))`.
    Bloco de pre-warm = port VERBATIM de `predictions.ts:419-452` (filtra `oddsSource ===
    "additional"`, corta em `MAX_ADDITIONAL_FETCHES`, loop `ensureOddsSnapshotsFresh` com
    try/catch). Erros de pre-warm **não** vão ao sumário: o mercado segue no `fanOut`,
    `predict` lança "sem snapshot fresco" ANTES do Anthropic → vira `failed` no outcome com a
    copy amigável certa (sem custo de LLM). `console.info` próprio do `analyzeMarkets`.
11. **Fan-out**:
    `outcomes = await runFanOut({ matchId, userId, isAdmin, modelOverride }, fanOut, friendlyMessageFromUnknown)`.
    (NÃO ler `getAiCallById` — custo já é persistido no `ai_calls` por `predict`; as seções o
    renderizam via `toAnalysisView`. `analyzeMarkets` não exibe custo inline.)
12. **Sumário** (ordem = `chosen`: ok/failed na ordem dos outcomes, rate-limited na cauda):
    ```ts
    const labelByKey = new Map(chosen.map(c => [c.key, c.label]));
    const summaries = [
      ...outcomes.map(o => o.ok
        ? { marketKey:o.marketKey, marketLabel:labelByKey.get(o.marketKey)!, status:"ok" as const }
        : { marketKey:o.marketKey, marketLabel:labelByKey.get(o.marketKey)!, status:"failed" as const, message:o.message }),
      ...rateLimited.map(c => ({ marketKey:c.key, marketLabel:c.label, status:"rate-limited" as const,
                                 message:"Limite diário atingido — não analisado." })),
    ];
    ```
    (`labelByKey` cobre todos os outcomes — `fanOut` ⊆ `granted` ⊆ `chosen` — e os rateLimited
    carregam o próprio `c.label`; o `!` é seguro.)
13. `revalidatePath(`/match/${matchId}`); revalidatePath("/");` (≥1 predict rodou — mesmo se
    todos falharem, é inócuo).
14. `return { ok:true, summaries };`

### Rate-limit por mercado (a LANDMINE — dinheiro real)
`checkAnalysisRateLimit(userId, role)` → `{ ok, limit, remaining, reset, reason? }`,
incrementa **1 por call**, atômico, **sem count param** (verificado vs lib/rate-limit.ts:108-128).
Consumir N = chamar N×, em loop, parando no 1º não-ok (não queimar slots além do teto):
```ts
const granted: { key: string; label: string }[] = [];
let capRl: RateLimitResult | null = null;
for (const c of chosen) {
  const rl = await checkAnalysisRateLimit(session.user.id, session.user.role);
  if (rl.ok) { granted.push(c); continue; }
  if (rl.reason === "fail-closed") {                       // KV ausente p/ não-admin
    return { ok: false, error: "Análises temporariamente indisponíveis. Tente mais tarde." };
  }
  capRl = rl;                                              // teto real atingido
  break;                                                  // para de consumir (não queima além do teto)
}
const rateLimited = chosen.slice(granted.length);          // a cauda não concedida (granted é prefixo)
if (granted.length === 0) {
  // capRl SEMPRE setado aqui: fail-closed já retornou acima; granted vazio só por cap na 1ª iteração.
  return { ok: false,
    error: `Você atingiu o limite de ${capRl?.limit ?? 0} análises por dia. Tente novamente amanhã.` };
}
```
- **Invariante de spend (pinada por teste + comentário)**: `slots consumidos == granted.length
  == mercados no runFanOut == chamadas predict()`. `capCandidates` roda ANTES do loop → nunca
  sobre-cobra. `granted` é **prefixo de `chosen`** (quebramos no 1º não-ok) → `slice(granted.length)`
  = a cauda exata. Comentário fixa a invariante contra um refactor que mova o cap pra depois.
- **Consistência com single**: `analyzeMatch` consome o slot ANTES do `predict` (slot some
  mesmo se o predict falhar por odds). Aqui idem: 1 slot por mercado concedido, mesmo que o
  `predict` daquele mercado falhe. Cap real de spend = `min(remaining, MAX_FANOUT_MARKETS)`.
- **Admin sem KV (path dominante de dev local)**: `checkAnalysisRateLimit` devolve
  `{ ok:true, limit:Infinity }` em toda call (lib/rate-limit.ts:114-115) → todos os N
  concedidos (limitado por MAX_FANOUT_MARKETS; nenhum `Infinity` vaza pra copy de usuário).
- **fail-closed** (KV ausente p/ não-admin) é estável no run → na prática só dispara na 1ª
  iteração; abortamos o run inteiro (sem spend), espelhando o single-market.
- `RateLimitResult` já é exportado de `@/lib/rate-limit` (lib/rate-limit.ts:16) → só importar
  o type; nenhuma mudança no arquivo de rate-limit.

---

## UI: `components/new-analysis-form.tsx` → multi-select

- Troca a action: `useActionState<AnalyzeMarketsResult | null, FormData>(analyzeMarkets, null)`.
- Estado de seleção: `const [selected, setSelected] = useState<Set<string>>` semeado com
  `over_under` se presente em `unanalyzedMarkets`, senão `unanalyzedMarkets[0].key`.
- **Render por cardinalidade** (mantém a paridade do single):
  - `unanalyzedMarkets.length > 1` → grupo de **checkboxes/chips** sobre `unanalyzedMarkets`
    (novo `MarketMultiSelect`, funcional e enxuto — o **polish visual é #246**, não aqui).
  - `length === 1` → sem seletor; um único hidden `name="marketKeys"` value=a-única-key
    (paridade com hoje; **atenção**: o NAME muda de `marketKey`→`marketKeys`, plural — pinar
    no teste de UI pra AC4 não quebrar silenciosamente no nome do campo).
- **Submit**: 1 `<input type="hidden" name="marketKeys" value={key} />` por key selecionada
  → `formData.getAll("marketKeys")`. Botão desabilitado quando `selected.size === 0`.
- **Re-sync (fase de render, COM GUARD de mudança — senão loop infinito de render)**:
  Set é igualdade por referência → um `setSelected` incondicional na render loopa pra sempre.
  ```ts
  const present = new Set(unanalyzedMarkets.map(m => m.key));
  let next = new Set([...selected].filter(k => present.has(k)));
  if (next.size === 0 && unanalyzedMarkets.length > 0) {
    const seed = present.has("over_under") ? "over_under" : unanalyzedMarkets[0].key;
    next = new Set([seed]);
  }
  // só re-setar quando a MEMBERSHIP mudou (tamanho difere OU alguma key sumiu):
  const changed = next.size !== selected.size || [...selected].some(k => !next.has(k));
  if (changed) setSelected(next);
  ```
  Espelha (com guard) a auto-correção do `marketKey` de hoje (L73-78), que é condicional.
- **Pending**: `<AnalyzeCTA pending marketCount={selected.size} modelLabel={modelLabel} />`.
  Prop nova opcional `marketCount` no `AnalyzeCTA`: `>1` → header "Analisando N mercados…" +
  nota de serial (feedback agregado — AC aceita "agregado"). `count<=1`/`undefined` → **copy
  byte-idêntica** à de hoje ("Analisando jogo…") — paridade pinada por teste.
- **Feedback de resultado** (o form descarta a view; sucessos viram seções via revalidate):
  - `state.ok === false` → `AnalysisErrorCard(state.error)` (rejeição total — idêntico a hoje).
  - **AC4 BLOCKER FIX — falha single**: `state.ok === true && summaries.length === 1 &&
    summaries[0].status !== "ok"` → renderiza pela **MESMA via `AnalysisErrorCard`(message)**
    de hoje (heading "Falha na análise" + botão "Tentar novamente"), **NÃO** o banner. Garante
    que um over_under sozinho que falha fique byte-for-byte como o `analyzeMatch` atual.
    (Single rate-limited já cai em `ok:false` → AnalysisErrorCard pelo granted.length===0.)
  - `state.ok === true && summaries.length > 1` → `MarketRunSummary` (novo) acima do CTA,
    listando SÓ os `failed`/`rate-limited` na ordem do array (= ordem de dispatch); os `ok`
    falam pelas seções. Todos ok → nada extra (as seções são a confirmação; um toast "N
    prontas" fica pra #246). O CTA persiste pros mercados que sobraram em `unanalyzedMarkets`.
- Wiring de `ModelOverrideSelect` / `seededOverride` / `NoOddsHint`: **intocado**.
- `MarketSelect` (dropdown single) deixa de ser importado aqui. Se ficar órfão, **manter o
  arquivo** (sem dead-code removal — fora de escopo; candidato a #246).

### Componentes novos (funcionais, sem polish — #246 depois)
- `components/market-multi-select.tsx`: grupo de checkboxes/chips controlado
  (`value: Set<string>`, `onToggle(key)`, `markets: {key,label}[]`).
- `components/market-run-summary.tsx`: banner enxuto de `failed`/`rate-limited`
  (`items: MarketRunSummaryItem[]`), renderiza na ordem do array, só quando há ≥1 não-ok.

---

## Testes (Vitest; harness `__tests__/` existente)

> **Paths corretos**: testes vivem em `app/actions/__tests__/` e `components/__tests__/`
> (verificado), NÃO em siblings flat.

### `app/actions/__tests__/predictions-multi-market.test.ts` (novo — espelha `predictions-best-bet.test.ts`)
Mocks: `predict`+`PredictError`; `marketsForAudience` mockado, `marketsForLeague` REAL;
`checkAnalysisRateLimit` mockado; `getUserAccessState`/`getMatchById` mockados;
`getEnableOverUnderExtraLines` mockado; **`isEmailAllowed` (whitelist) mockado** (`vi.mock(
"@/lib/auth/whitelist", () => ({ isEmailAllowed: vi.fn(() => false) }))`, igual a
`predictions-best-bet.test.ts:33`) → o gate de acesso bloqueado (caso 13) fica determinístico,
não dependente de env ambiente. (Sem DB real — `predict` é mockado; ambiente jsdom ok.)
**Helper `form` ESTENDIDO** (o atual `Record<string,string>` colapsa keys repetidas → `getAll`
só veria 1 e os testes passariam pelo motivo errado):
```ts
function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields))
    (Array.isArray(v) ? v : [v]).forEach((x) => fd.append(k, x));
  return fd;
}
```
Casos (vários asseguram `formData.getAll("marketKeys").length === N` dirigindo a contagem de
`predict`, pra pegar uma regressão pra hidden-input único):
1. 2 mercados ok → `predict` 2×, rate-limit 2×, 2 summaries `ok`, `revalidatePath` chamado, `ok:true`.
2. Falha parcial: mercado 2 lança `PredictError` → summaries `[ok, failed(msg)]`; `predict` 2×; 2 slots.
3. Cap no meio: 3 escolhidos, rate-limit `ok,ok,!ok(cap)` → 2 granted rodam, 1 `rate-limited`;
   `predict` 2×; rate-limit **exatamente 3×** (2 grant + 1 reject); summaries 2 + 1 rate-limited.
4. Zero slots (1ª call cap) → `ok:false` copy de limite (`limite de N`); `predict` 0×; rate-limit 1×.
5. fail-closed (1ª call) → `ok:false` copy de indisponível; `predict` 0×.
6. Allowlist: `marketKeys` forjado fora da audiência/liga é filtrado; se sobra ≥1 válido, só os
   válidos rodam; se NADA válido → `ok:false` "nenhum mercado válido", rate-limit **0×** (sem slot).
7. **Paridade single SUCESSO** (AC4): `over_under` sozinho ok → `predict` 1×, rate-limit 1×, 1 summary `ok`.
8. **Paridade single FALHA** (AC4 BLOCKER): `over_under` sozinho lança `PredictError` → `ok:true`,
   summaries `[{status:'failed', message}]` (a UI roteia pro AnalysisErrorCard — pinado no teste de UI).
9. **All-fail → ok:true** (decisão LOAD-BEARING): 2 granted, ambos lançam → `ok:true`, summaries
   ambos `failed` com mensagens distintas, `revalidatePath` AINDA chamado (slots gastos).
10. **Dedupe**: `marketKeys:['over_under','over_under']` num POST → 1 entrada → `predict` 1×, rate-limit 1×.
11. **Admin sem KV** (path dev local): KV unset + role==='admin' → `checkAnalysisRateLimit`
    `{ok:true, limit:Infinity}` toda call → todos os N (≤ MAX) concedidos; nenhum `Infinity` em copy.
12. Gate order: matchId inválido / sem login / bloqueado / encerrado → rate-limit 0×, `predict` 0×.

> **NÃO** escrever teste de `> MAX_FANOUT_MARKETS` (capCandidates trim): com só **4 descriptors**
> (`ALL_DESCRIPTORS`) + `marketsForLeague` fail-closed, `chosen` nunca passa de 4 → o branch de
> trim (`length > max`, best-bet.ts:40) é **inalcançável** no path #245 e o teste passaria vacuamente.
> O trim já é pinado por `best-bet-cap.test.ts` (max=2 explícito). Anotar essa inalcançabilidade no PR.

### `components/__tests__/new-analysis-form-multi.test.tsx` (novo — `renderToStaticMarkup`, como `override-form.test.tsx`)
Mock da action `analyzeMarkets`.
- `unanalyzedMarkets.length>1` → 1 checkbox por mercado, `over_under` marcado por default;
  hidden `marketKeys` refletem a seleção inicial (nome do campo = `marketKeys`).
- `length===1` (over_under) → sem multi-select; 1 hidden `marketKeys`=over_under (paridade).
- `length===1` (não-over_under, ex. só `btts` disponível) → 1 hidden `marketKeys`=btts
  (pina o nome plural; AC4 não quebra no nome do campo).
- **Falha single roteada pro AnalysisErrorCard**: com state semeado `ok:true,
  summaries:[{status:'failed',message:'…'}]` → markup contém o heading "Falha na análise"
  do `AnalysisErrorCard` (não o `MarketRunSummary`).

### `components/__tests__/analyze-cta.test.tsx` (novo OU caso adicionado se já existir)
- `marketCount<=1`/`undefined` → markup byte-idêntico ao "Analisando jogo…" de hoje.
- `marketCount>1` → troca pra "Analisando N mercados…".

### Guard do path pago intocado
NÃO tocamos `analyzeBestBet` (pre-warm duplicado, não extraído). O guard que protege seu
pre-warm (ordem/contagem `providerMarketKey`) é `app/actions/__tests__/predictions-best-bet.test.ts:312-348`
(+ o describe de best-of-successful/all-fail) — deve seguir **verde sem alteração**.

### Validação local
`pnpm typecheck && pnpm lint && pnpm test -- --no-file-parallelism` (pglite flaka em
multi-core local; CI 2-core é verde — [[pglite-suite-high-core-flake]]).

---

## Arquivos
**Modifica**:
- `app/actions/predictions.ts` — +`analyzeMarkets` (+ tipos `MarketRunStatus`/
  `MarketRunSummaryItem`/`AnalyzeMarketsResult`); **pre-warm DUPLICADO inline** (NÃO extrair
  helper, NÃO tocar `analyzeBestBet`/`analyzeMatch`). Reusa `friendlyMessageFromUnknown`,
  `resolveExtraLines`, `capCandidates`, `runFanOut`, `MAX_FANOUT_MARKETS`, `MAX_ADDITIONAL_FETCHES`.
- `lib/rate-limit.ts` — **sem mudança**: `RateLimitResult` já é exportado (lib/rate-limit.ts:16) →
  só importar o type no `analyzeMarkets`. Não deve aparecer no diff.
- `components/new-analysis-form.tsx` — multi-select + `analyzeMarkets` + roteamento de
  feedback (single-fail→AnalysisErrorCard, multi→MarketRunSummary) + re-sync com guard.
- `components/analyze-cta.tsx` — prop opcional `marketCount` (copy agregada; paridade `<=1`).
**Cria**: `components/market-multi-select.tsx`, `components/market-run-summary.tsx`,
`app/actions/__tests__/predictions-multi-market.test.ts`,
`components/__tests__/new-analysis-form-multi.test.tsx`,
`components/__tests__/analyze-cta.test.tsx` (se não existir).
**NÃO toca**: `analyzeMatch`, `analyzeBestBet`, `SectionFooterDispatch`,
`toMarketAnalysisSections`, `market-catalog.ts`, schema/migrations.

## Mapa AC → cobertura
1. 2+ → 1 dispatch → 1/mercado em seção: multi-select + `analyzeMarkets` + revalidate (testes 1-3).
2. Custo/rate-limit por N: N slots + N `predict` (cada loga `ai_calls`); documentado no PR (1-4, 9-12).
3. Falha de 1 não derruba: `runFanOut` isola + summaries (testes 2, 9).
4. O/U sozinho idêntico: path degenerado single — SUCESSO (teste 7) **e FALHA→AnalysisErrorCard**
   (teste 8 + teste de UI) + paridade de copy do CTA + nome de campo `marketKeys`.
5. Verdes: CI (validar `--no-file-parallelism`).

## AC2 — checklist de "documentado no PR" (deliverable concreto)
O corpo do PR DEVE conter: (a) racional do consumo de **N slots** + contraste com o modelo
**1-slot/run** do `analyzeBestBet`; (b) spend de pior caso = `min(remaining, MAX_FANOUT_MARKETS)`
chamadas `predict()` pagas; (c) disclosure do gotcha de custo do CLAUDE.md p/ runs de debug
com N chamadas. Torna a AC verificável, não aspiracional.

## Princípios inegociáveis (do handoff)
- DINHEIRO REAL: N mercados = N `predict()` pagos. N slots. Respeitar `MAX_FANOUT_MARKETS`.
- NÃO mudar `analyzeMatch`/`analyzeBestBet`/`SectionFooterDispatch` (single, footer #244, path pago).
- Reusar `runFanOut` (serial, erro isolado). Allowlist server-side (nunca confiar no POST).
- Seções via `revalidatePath`+`toMarketAnalysisSections` (não reinventar render). Sem migration.
- Agentes de review = read-only no git ([[workflow-agents-mutate-checkout]]); re-checar branch.
