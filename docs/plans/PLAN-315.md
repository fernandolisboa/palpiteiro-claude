# PLAN-315 — Cartucho gerador de palpites (Haiku low-temp) + auto-run idempotente + regen sem repetição

> Snapshot histórico (mesma natureza dos outros `docs/plans/`). Aterrado no código real em `main` no commit do handoff. Issue #315; depende do #314 (MERGED). Sucessor visual: **#316** (painel/UI — FORA de escopo aqui).

## 0. Escopo e o que NÃO entra

**Entra (#315):** o gerador `generatePalpites()` (irmão de `predict()`, NÃO chama `predict()`), o cartucho `palpites_v1` (o **MIX**: exatamente um `exact_score` settleable + 1–3 linhas fun `red_card`/`corners` com `settleable=false`), o bucket de rate-limit `ratelimit:palpites`, as server actions de geração + regen, o trigger de auto-run seguro com guard de idempotência, e um **stub cliente mínimo** que dispara o auto-run.

**NÃO entra:** qualquer componente visual de exibição de palpites (lista, cards, histórico "ver anteriores", estados de loading visíveis) — isso é **#316**. Nada de odds/edge/stake/Yield/implied em lugar nenhum (ADR 0028 §1). Nenhum tipo settleable novo além de `exact_score` (gate Tier 3 do CLAUDE.md) — `red_card`/`corners` entram como linhas **fun-only** (`settleable=false`, derivado), nunca liquidadas. **Decisão de v1** (§2.4): o output é o MIX exigido pelo schema mergeado do #314 (`palpiteTypeEnum = [exact_score, red_card, corners]` + o bit settleable) — exatamente um `exact_score` (settleable) + 1–3 linhas fun (`red_card`/`corners`, `settleable=false`). NÃO é exact_score isolado.

## 1. O CRUX — a seam de geração (market-free)

`predict()` (`lib/ai/predict.ts:216-223`) é monolítico e acoplado ao mercado: resolve cartucho de mercado (`getCartridge`, `:228`), monta odds N-vias (`:343+`), calcula edge (`:944+`), persiste `predictions`+`prediction_selection_odds`. **NÃO reutilizamos `predict()`** — palpite é domínio disjunto. Em vez disso, criamos um **irmão** que reusa apenas (a) o seam de provider (ADR 0027) e (b) o padrão de logging em `ai_calls`.

### 1.1 Onde vive

Módulo novo `lib/ai/palpites/` (espelha `lib/ai/markets/` em forma, NÃO em conteúdo):

```
lib/ai/palpites/
  index.ts            # generatePalpites(args) — entrypoint
  types.ts            # GeneratePalpiteArgs, PalpiteGenerationResult, PalpiteCartridge
  registry.ts         # getPalpiteCartridge() → cartucho palpites_v1
  cartridges/
    exact-score.ts    # systemPrompt, tool (ToolDef), inputSchema, outputSchema, buildInput, buildUserMessage, version
```

### 1.2 Refactor compartilhado de logging (commit 1, isolado)

`persistAiCallError()` (`lib/ai/predict.ts:163-212`) é privado de `predict.ts` mas é **genérico** (zero contexto de mercado). Extrair para `lib/ai/ai-call-logging.ts`:

- **(0) PRÉ-PASSO OBRIGATÓRIO — unificar `AiCallStatus` ANTES da extração**: hoje há uma cópia local de `AiCallStatus` em `predict.ts:100-106` que duplica a definição canônica em `./providers/types` (canônica por ADR 0027). **Deletar** a local de `predict.ts:100-106` e passar a **importar** `AiCallStatus` de `./providers/types`. Sem isso, a extração só replicaria a duplicação para mais um módulo.
- Exportar `persistAiCallError(args)` com a **assinatura idêntica** (`predict.ts:163-176`): `{ provider: AIProviderKey; userId; matchId; model: AIModelId; inputPayload; outputPayload; inputTokens; outputTokens; latencyMs; status: AiCallStatus; errorMessage; promptVersion }`.
- Mover junto: `truncate()` (`:159-161`), `ERROR_MESSAGE_MAX` (`:122`). **NÃO mover** `AiCallStatus` para `ai-call-logging.ts` — ele vem de `./providers/types`; `ai-call-logging.ts` **importa** `AiCallStatus` de `./providers/types`. **Preservar o swallow** (try/catch → `console.error`, nunca re-throw — `:201-211`): a falha do log de auditoria NUNCA mascara o erro primário. **CRÍTICO** (gotcha das findings).
- `predict.ts` passa a **importar** `persistAiCallError` + `AiCallStatus` de `./ai-call-logging` (que reexporta/repassa o tipo de `./providers/types`), apagando as cópias locais. `PredictError` continua em `predict.ts`. **Sem ciclo**: `logging → types`, `predict → logging → types` (grafo acíclico).
- Verificação: `pnpm test` + `pnpm typecheck` verdes — o comportamento de `predict()` é byte-idêntico (refactor puro).

### 1.3 Assinatura do gerador

```ts
// lib/ai/palpites/types.ts
import type { DbPalpiteSet, DbPalpite } from "@/lib/db/queries/palpites";
import type { PalpiteSetWithLines } from "@/lib/db/queries/palpites";
import type { AIModelId } from "@/lib/ai/models";

export type GeneratePalpiteArgs = {
  matchId: string;
  userId: string;
  // Histórico prévio (newest-first) como CONTEXTO DE EXCLUSÃO (regen sem repetir).
  // [] na primeira geração. Vem de getPalpiteSetsForMatch (lib/db/queries/palpites.ts:49).
  previousSets: PalpiteSetWithLines[];
  // Default Haiku (econômico). Não admin-gated; não cascateia preferência do usuário
  // (palpite é universal). Mantido como arg p/ testabilidade/futuro, mas o caller
  // sempre passa "claude-haiku-4-5".
  modelOverride?: AIModelId;
};

export type PalpiteGenerationResult = {
  palpiteSet: DbPalpiteSet;
  palpites: DbPalpite[];
  // NULLABLE: a auto-geração fire-and-forget pode falhar no log (aiCallId é nullable
  // em palpite_sets). O set ainda é válido. Hoje, na prática, é não-null no caminho ok.
  aiCall: { id: string } | null;
};

export class PalpiteError extends Error {
  readonly context: Record<string, unknown>;
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = "PalpiteError";
    this.context = context;
  }
}
```

### 1.4 Fluxo de `generatePalpites()` (sem mercado/edge/odds)

Em `lib/ai/palpites/index.ts`, na ordem (cada passo cita o análogo em `predict.ts`):

1. **Resolve modelo**: SEM cascata de preferência. Fixa `MODEL_REGISTRY[modelOverride ?? "claude-haiku-4-5"]` (`lib/ai/models.ts:80-89`; `thinkingMode:"temperature"`, `temperature:0.3`). NÃO chamar `getPreferredModelId`/`isModelAllowedForAudience` (palpite é universal).
2. **Lookup do match** (`predict.ts:255-271`): `db.select().from(matches).where(eq(matches.id, matchId)).limit(1)`. Throw `PalpiteError("match not found")` se ausente. Gate de analisabilidade idêntico ao `predict.ts:265-270` (finished/cancelled → throw): não geramos palpite de jogo encerrado.
3. **Resolve cartucho**: `getPalpiteCartridge()` (registry). Sem `extraLines`, sem `marketKey`.
4. **Fetch de dados de suporte**: reusar o bloco `predict.ts:273-341` (fixture + form/h2h/standings/absences/lineups via `getSportsDataProvider()` + `getAbsencesProvider()`). **Decisão (§2.2)**: para v1, o input de palpite é ENXUTO — placar exato precisa só de form recente + h2h + médias de gols; **NÃO** precisa de lineups/absences detalhados como o over/under. Para evitar copiar 70 linhas de fetch frágil, o cartucho exact-score declara um `buildInput` que aceita o mesmo `commonInputArgs` mas só LÊ form+h2h+standings. **Verify durante implementação**: se a fetch paralela inteira (`Promise.all` de 6) for cara/frágil demais para um palpite barato, reduzir para `Promise.all([homeForm, awayForm, h2h, standings])` — palpite não justifica gastar créditos de absences/lineups. Anotar a decisão no PR.
5. **Monta input** via `cartridge.buildPredictionInput({ match, fixture, homeForm, awayForm, h2h, standings, previousSets })`. O `previousSets` entra como contexto de exclusão (§2.5): `excludedScores: {home,away}[]` das linhas exact_score já chutadas **e** `excludedFunIdeas: {type,text}[]` das linhas fun já usadas.
6. **Monta userMessage** via `cartridge.buildUserMessage(input, { daysToKickoff })` (`predict.ts:727-731` para o cálculo de `daysToKickoff`).
7. **Monta `AnalysisRequest`** (`predict.ts:733-744`): `{ model, system: cartridge.systemPrompt, userMessage, tool: cartridge.tool, toolName: cartridge.toolName, maxTokens, temperature }`. `maxTokens` de `getGenerationParams()` (`predict.ts:732`). **NÃO passar `effort`** (Haiku é temperature-mode — gotcha das findings; effort seria ignorado, mas omitir é mais limpo). **DECISÃO (não diferida)**: passar `temperature: model.temperature` **explicitamente** na `AnalysisRequest` (Haiku = `0.3`, garantido pelo `MODEL_REGISTRY`). **NÃO** usar `genParams.temperature` (é `null` para modelos em modo temperature). Isso é consistente com o fallback do builder `args.temperature ?? args.model.temperature ?? 0.3` (`request-builder.ts:59`): passar `model.temperature` explícito garante `0.3` sem depender da cascata. O golden-payload test (§7.2) assere que a request inclui `temperature: 0.3`.
8. **Chama provider** (`predict.ts:746-782`): `getProviderForModel(model)` → checa `isAIProvider(providerKey)` (throw em desconhecido) → checa `hasKey()` (se false: `persistAiCallError(status:"provider_error")` + throw, **zero gasto** — `predict.ts:764-781`) → `await aiProvider.runAnalysis(analysisRequest)`.
9. **Erro do provider** (`predict.ts:784-802`): `!result.ok` → `persistAiCallError(status: result.status)` + throw `PalpiteError`.
10. **tool_missing** (`predict.ts:808-832`): `result.toolInput === undefined` → `persistAiCallError(status:"tool_missing")` + throw.
11. **Validação Zod** (`predict.ts:834-855`): `cartridge.outputSchema.safeParse(result.toolInput)`. `!success` → `persistAiCallError(status:"invalid_output")` + throw. `const output = parsed.data` (já tipado pelo schema concreto do cartucho de palpite — diferente de `predict` que apaga para `BaseMarketOutput`).
12. **Custo + persistência** (§6). Insere `ai_call` (status `ok`) então `palpite_set` + linhas `palpites` (sequencial, neon-http). Retorna `PalpiteGenerationResult`.

**O que este fluxo NUNCA toca** (vs `predict.ts`): `collectIndependentBinaries`, `pickBestBookmaker`, `computeMarketImpliedProbabilities`, `cartridge.selectionProbs`, `computeStakeUnits`, `predictions`, `prediction_selection_odds`. Zero import de `./staking`, `./markets/*`, `lib/odds/*`, `lib/providers/odds`.

## 2. O cartucho `palpites_v1`

### 2.1 Tipo do cartucho (disjunto do MarketCartridge)

`MarketCartridge` (`lib/ai/markets/types.ts:91-144`) carrega `descriptor`/`selectionProbs`/`selections`/`resolveParams` (acoplados a odds/edge). O cartucho de palpite é **um tipo NOVO menor** em `lib/ai/palpites/types.ts`:

```ts
import type { ZodType } from "zod";
import type { ToolDef } from "@/lib/ai/providers/types";

export type PalpiteCartridge<Input = unknown, Output = unknown, Args = unknown> = {
  version: string;          // "palpites_v1" (ADR 0017) → grava em ai_calls.promptVersion + palpite_sets.promptVersion
  systemPrompt: string;
  tool: ToolDef;            // ToolDef NEUTRO (ADR 0027), ex.: submit_palpites
  toolName: string;
  inputSchema: ZodType<Input>;
  outputSchema: ZodType<Output>;
  buildPredictionInput: (args: Args) => Input;
  buildUserMessage: (input: Input, ctx: { daysToKickoff: number }) => string;
};
```

Sem `descriptor`, `selections`, `selectionProbs`, `resolveParams`, `marketKey`, `BuildInputError` (palpite não tem o gate de "dados insuficientes" do mercado — degrada para menos palpites, não throw).

### 2.2 `version` (ADR 0017)

`export const PALPITES_VERSION = "palpites_v1";` em `cartridges/exact-score.ts`. Bump manual em qualquer mudança de prompt/schema (commit `prompt:`). Persiste em `ai_calls.promptVersion` (`db/schema.ts:249`) E `palpite_sets.promptVersion` (`db/schema.ts:414`, notNull — sobrevive mesmo quando `aiCallId` é null). `palpite_sets.modelVersion` (notNull, `:413`) recebe `model.id` (`"claude-haiku-4-5"`).

### 2.3 System prompt (builder)

`SYSTEM_PROMPT` em `cartridges/exact-score.ts`, em PT-BR, tom leve/engajamento (NÃO valor). Princípios:
- Tarefa: emitir o **MIX** — **exatamente um** placar exato (`exact_score`) divertido e plausível + **1–3 linhas fun** (`red_card`/`corners`), cada uma com uma frase humana curta. NÃO é aposta de valor.
- **Proibição de value-language (todas as linhas, inclusive o TEXTO das fun lines)**: **nunca** mencionar odd, %, edge, stake, retorno, Yield, probabilidade implícita ou qualquer linguagem de valor — nem como número, nem como palavra (proibido por ADR 0028 §1; risco real: o LLM escrever "70% de chance de cartão" no `text` de uma fun line). O prompt deve proibir isso explicitamente DENTRO do texto das linhas fun.
- **Liquidação**: apenas o `exact_score` é liquidado (badge acertou/errou). `red_card`/`corners` são **diversão pura, sem placar** — o prompt deixa isso claro para o LLM não prometer "acerto".
- Usa SÓ os dados fornecidos (form/h2h/médias). Não inventa.
- **Exclusão**: recebe a lista de placares já chutados E de ideias fun já usadas anteriormente, e **NÃO repete** nenhum deles (este é o contrato de regen sem repetição).
- Responde EXCLUSIVAMENTE chamando o tool `submit_palpites`.

### 2.4 Tool + output schema + `settleable` derivado

`SUBMIT_PALPITES_TOOL: ToolDef` com `inputSchema` (JSON Schema) cujo shape casa o Zod abaixo. **Decisão v1 (o MIX)**: o output é um **array pequeno e chamativo** (cap 2–4 itens) contendo **exatamente um** `exact_score` (settleable) + **1–3 linhas fun** (`red_card`/`corners`, `settleable=false`). É o conjunto exigido pelo schema mergeado do #314 (`palpiteTypeEnum` + bit settleable), não exact_score isolado. O shape é uma **discriminated union** por `type`: só `exact_score` carrega `params`; as linhas fun não têm `params` estruturado (uma `red_card`/`corners` com `params` é falha de Zod, não silenciosamente removida).

```ts
import { z } from "zod";

const ExactScoreParamsSchema = z.object({
  home: z.number().int().min(0).max(20),
  away: z.number().int().min(0).max(20),
});

const PalpiteLineSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("exact_score"),
    text: z.string().min(1).max(280),
    params: ExactScoreParamsSchema,      // obrigatório só p/ exact_score
  }),
  z.object({
    type: z.literal("red_card"),
    text: z.string().min(1).max(280),
    params: z.null().optional(),         // fun-only: sem params estruturado
  }),
  z.object({
    type: z.literal("corners"),
    text: z.string().min(1).max(280),
    params: z.null().optional(),
  }),
]);

export const PalpitesOutputSchema = z.object({
  palpites: z.array(PalpiteLineSchema).min(2).max(4),   // mix pequeno e chamativo
}).strict();
export type PalpitesOutput = z.infer<typeof PalpitesOutputSchema>;
```

- **Contagem**: `min(2).max(4)`. O system prompt manda **EXATAMENTE UM** `exact_score` + **1–3 linhas fun** (`red_card`/`corners`).
- **`params` só em `exact_score`**: presente e obrigatório apenas na linha `exact_score`; a discriminated union faz uma `red_card`-com-`params` virar falha de Zod (não passa silenciosa). As linhas fun não têm `params` estruturado.
- **Schema `.strict()` e SEM campo `settleable`**: o output não declara `settleable`; um `settleable` parasita vindo do LLM é **rejeitado** (`.strict()`), não silenciosamente removido.
- **`settleable` é DERIVADO, nunca vem do LLM** (constraint do issue): no boundary de escrita, `settleable = deriveSettleable(line.type)` — `exact_score → true`, `red_card`/`corners → false`. Defesa: NUNCA confiar num campo `settleable` do output (que nem existe no schema). Função pura `deriveSettleable(type): boolean` em `lib/ai/palpites/settleable.ts` — `type === "exact_score"` (única fonte da verdade; o cron usa o mesmo predicado, `palpites.ts:148-149`).
- **`params` validado por Zod no boundary de escrita** (#314 handoff): reusar `ExactScoreParamsSchema` no `.safeParse` antes do insert (já validado pelo output schema, mas re-afirmar no write path se a v2 emitir tipos sem params — defense-in-depth). `text` prosa-tolerante: se >280, `truncate()` em vez de rejeitar (gotcha de prose das findings; reuso de `truncate` do `ai-call-logging.ts`).

### 2.5 Input + exclusão

`buildPredictionInput({ match, fixture, homeForm, awayForm, h2h, standings, previousSets })` → input Zod-validado contendo nomes dos times, médias de gols (de form), h2h recente, **e DUAS listas de exclusão** extraídas de `previousSets`:
- `excludedScores: {home,away}[]` — achatar as linhas `exact_score` com `params` de todos os sets prévios.
- `excludedFunIdeas: {type,text}[]` — achatar as linhas fun (`red_card`/`corners`) de todos os sets prévios. **Necessário** porque as linhas fun não têm `params` para achatar; sem isso o regen repete "vai ter cartão vermelho" indefinidamente.

`buildUserMessage` renderiza markdown com uma seção "não repita" que lista **ambos** — "Placares já sugeridos" (de `excludedScores`) **e** "Ideias fun já usadas" (de `excludedFunIdeas`) — quando qualquer das listas é não-vazia (omite a seção/sub-seção vazia).

## 3. Bucket de rate-limit `ratelimit:palpites`

Em `lib/rate-limit.ts`, **sem tocar** os buckets de análise (`:71-88`):

1. Constante: `const DEFAULT_PALPITES_LIMIT = 50;` (owner-tunável; Haiku ~US$0.002/set).
2. Estender o singleton `cached` (`:46,49,71`) para incluir `palpites`:
```ts
let cached: { user: Ratelimit; admin: Ratelimit; palpites: Ratelimit } | null = null;
// ... dentro de getLimiters(), no objeto cached:
palpites: new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(
    limitFromEnv("RATE_LIMIT_PALPITES_PER_DAY", DEFAULT_PALPITES_LIMIT),
    "1 d",
  ),
  prefix: "ratelimit:palpites",  // prefixo DISTINTO — nunca colide com analyze
}),
```
3. Função de check própria (NÃO reusa `checkAnalysisRateLimit`):
```ts
export async function checkPalpitesRateLimit(
  userId: string,
): Promise<RateLimitResult> {
  const limiters = getLimiters();
  if (!limiters) {
    // Sem KV: fail-OPEN — DECISÃO FINAL (não diferida). Haiku ~US$0.002/set e o auto-run
    // já falha em silêncio, então fail-open é consistente: travar por falta de KV
    // degradaria a UX sem ganho de proteção material. A análise paga continua fail-CLOSED
    // exatamente porque custa caro. 50/dia por usuário (RATE_LIMIT_PALPITES_PER_DAY, default 50).
    return { ok: true, limit: Infinity, remaining: Infinity, reset: 0 };
  }
  const { success, limit, remaining, reset } = await limiters.palpites.limit(userId);
  return { ok: success, limit, remaining, reset };
}
```
- **Sem distinção de role** (Haiku universal). **Não drena** os 20/dia de análise (prefixo distinto). Fail-open sem KV é **decisão final** (acima): em dev local sem KV, permite testar; em prod com KV, o limite de 50/dia por usuário vale.

## 4. Server actions (generate + regen)

Arquivo novo `app/actions/palpites.ts` (`"use server"`). NÃO mexer em `app/actions/predictions.ts`.

### 4.1 Gate comum (helper interno)

```ts
async function gatePalpite(matchId: string): Promise<
  | { ok: false; error: string }
  | { ok: true; userId: string }
> {
  if (!z.uuid().safeParse(matchId).success) return { ok: false, error: "id inválido" };
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "login" };
  // BYPASS DELIBERADO (ADR 0028 §1): SEM getUserAccessState/isEmailAllowed,
  // SEM isModelAllowedForAudience. Palpite é universal e disjunto da análise paga.
  // Só exige auth (FK ai_calls.userId precisa de um user real — mas auth já garante).
  const rl = await checkPalpitesRateLimit(session.user.id);
  if (!rl.ok) return { ok: false, error: "rate" }; // mensagem nunca chega à UI (silent)
  return { ok: true, userId: session.user.id };
}
```

### 4.2 `generatePalpitesAction(matchId)` — auto-run idempotente, **falha silenciosa**

```ts
export async function generatePalpitesAction(
  matchId: string,
): Promise<{ ok: true }> {            // SEMPRE { ok: true } — fire-and-forget
  try {
    const gate = await gatePalpite(matchId);
    if (!gate.ok) return { ok: true };           // bloqueio → silencioso
    // GUARD DE IDEMPOTÊNCIA — ANTES de gastar token (gotcha crítico das findings):
    const previousSets = await getPalpiteSetsForMatch(matchId, gate.userId);
    if (previousSets.length > 0) return { ok: true };   // já existe → no-op, 0 gasto
    await generatePalpites({
      matchId, userId: gate.userId,
      previousSets: [],                          // 1ª geração: sem exclusão
      modelOverride: "claude-haiku-4-5",
    });
    revalidatePath(`/match/${matchId}`);         // #316 lê o set novo no próximo render
    return { ok: true };
  } catch (err) {
    // FALHA SILENCIOSA (ADR 0028 §5): o erro já foi logado em ai_calls.status != "ok"
    // dentro de generatePalpites (persistAiCallError). Aqui só engolimos p/ a UI não ver.
    console.error(JSON.stringify({ scope: "generatePalpitesAction", matchId,
      error: err instanceof Error ? err.message : String(err) }));
    return { ok: true };
  }
}
```

### 4.3 `regeneratePalpitesAction(matchId)` — regen sob demanda, sem repetir

Idêntica à 4.2 EXCETO: **NÃO** tem o guard `previousSets.length > 0` (o ponto é gerar de novo); em vez disso **passa** `previousSets` como contexto de exclusão. **Mantém** o rate-limit (regen gasta token). **DECISÃO FINAL (não diferida)**: `regeneratePalpitesAction` retorna uma **discriminated union** visível (regen é ação explícita do usuário, com botão em #316), espelhando `analyzeMatch` (`app/actions/predictions.ts`):

```ts
type RegenResult =
  | { ok: true; setId: string }
  | { ok: false; error: "rate" | "not_found" | "generation_error" };
```

(O auto-run silencioso da §4.2 continua `{ ok: true }` SEMPRE — fire-and-forget.) A action existe já com este shape em #315; o botão que a consome é #316.

```ts
const previousSets = await getPalpiteSetsForMatch(matchId, gate.userId);
await generatePalpites({ matchId, userId: gate.userId, previousSets,
  modelOverride: "claude-haiku-4-5" });
revalidatePath(`/match/${matchId}`);
```

Idempotência por GERAÇÃO: cada chamada cria um novo set (palpite_sets não tem UNIQUE(matchId,userId) — `db/schema.ts:402-422`); a "repetição" é evitada no PROMPT (exclusão), não por constraint.

## 5. O trigger de auto-run — DECISÃO FIRME

**O landmine** (ADR 0028 §5 + findings): a página `app/match/[id]/page.tsx` é Server Component async (`:60`). Um promise não-aguardado no render (`void generatePalpites(...)`) é **morto pelo serverless** quando a resposta retorna. PROIBIDO.

**Decisão: Option (a) — child cliente que chama a server action no mount.** Mecanismo seguro e único viável sem bloquear o render.

### 5.1 Em escopo para #315 (stub mínimo)

Um componente cliente minúsculo, sem UI visível (o painel é #316):

```tsx
// components/palpites/PalpiteAutoRun.tsx
"use client";
import { useEffect, useRef } from "react";
import { generatePalpitesAction } from "@/app/actions/palpites";

export function PalpiteAutoRun({ matchId }: { matchId: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;                 // guard client-side contra StrictMode double-mount
    void generatePalpitesAction(matchId); // action é idempotente no servidor (guard real lá)
  }, [matchId]);
  return null;                            // ZERO UI — render é #316
}
```

Montado em `app/match/[id]/page.tsx` **após** o render principal (não bloqueia nada):
```tsx
<PalpiteAutoRun matchId={match.id} />
```
- O guard de idempotência REAL é no servidor (§4.2, `getPalpiteSetsForMatch().length > 0`); o `useRef` client só evita o double-fire do React StrictMode/Fast Refresh em dev. Reload → action roda de novo, mas o guard server faz no-op (0 token).

### 5.2 Diferido para #316

Qualquer exibição (lista de palpites, estado pending/loading, botão "gerar de novo" que dispara `regeneratePalpitesAction`, "ver anteriores"). #315 entrega a action de regen pronta; #316 pluga o botão.

## 6. Write path (neon-http) — parent set + child rows

neon-http **não tem `db.transaction`** e `db.batch` não carrega id de `.returning()` (findings; `best-bet.ts:53-54`). Padrão **sequencial awaited** (igual `predict.ts:900-942` para ai_calls→predictions). Em `generatePalpites()`, passo 12:

```ts
// 12a. ai_call (status ok) — id alimenta palpite_sets.aiCallId
const cost = calculateCost({ model: model.id, inputTokens, outputTokens });
let aiCallId: string | null = null;
try {
  const [row] = await db.insert(aiCalls).values({
    userId, matchId, provider: providerKey, model: model.id,
    promptVersion: cartridge.version, inputPayload, outputPayload,
    inputTokens, outputTokens, latencyMs, costUsd: cost.toFixed(6),
    status: "ok", errorMessage: null,
  }).returning({ id: aiCalls.id });
  aiCallId = row.id;
} catch (err) {
  // ASSIMETRIA INTENCIONAL: aiCallId=null no insert do ai_call que falha é DELIBERADO
  // (ADR 0028 §1, FK nullable em palpite_sets — db/schema.ts:412). O set é o produto
  // e SOBREVIVE à falha do log de auditoria. Não throw aqui.
  // (Contraste: a falha do insert de palpite_set SIM faz throw — sem child rows órfãs.)
  console.error(JSON.stringify({ scope: "generatePalpites", matchId,
    error: "ai_call_insert_failed", ...extractDbCause(err) }));
}

// 12b. palpite_set — parent. RETURNING id p/ as linhas filhas.
//      Falha aqui PROPAGA (throw): sem set, não há filhos a inserir — nada de órfãos.
const [setRow] = await db.insert(palpiteSets).values({
  matchId, userId, aiCallId,                 // pode ser null
  modelVersion: model.id, promptVersion: cartridge.version,
}).returning();

// 12c. palpites — child rows, sequencial. settleable DERIVADO (não do LLM).
const palpiteRows: DbPalpite[] = [];
for (const line of output.palpites) {
  const settleable = deriveSettleable(line.type);          // exact_score → true
  const params = line.type === "exact_score"
    ? ExactScoreParamsSchema.parse(line.params)            // re-valida no boundary
    : null;
  const [pRow] = await db.insert(palpites).values({
    palpiteSetId: setRow.id, type: line.type,
    text: truncate(line.text, 280), params, settleable,
  }).returning();
  palpiteRows.push(pRow);
}
return { palpiteSet: setRow, palpites: palpiteRows, aiCall: aiCallId ? { id: aiCallId } : null };
```

**Tokens INTEGER** (gotcha): o adapter já coage `inputTokens`/`outputTokens` para finitos ≥0 (`predict.ts:803-804` confia nisso). Não re-floorar; confiar no contrato do adapter como `predict` faz. NÃO inserimos `palpite_outcomes` aqui (settlement é o cron do #314 já MERGED — `getPendingPalpiteSettlements`/`settle-palpites`).

## 7. Testes

Todos com Vitest. Unit puro onde dá; pglite só onde toca DB real.

### 7.1 Unit (sem DB)
- **`lib/ai/palpites/cartridges/__tests__/exact-score.test.ts`**:
  - `PalpitesOutputSchema.safeParse`: **aceita** um MIX válido — `{palpites:[{type:"exact_score",text,params:{home:2,away:1}},{type:"red_card",text},{type:"corners",text}]}` (2–4 itens). **Rejeita**: `params` faltando no exact_score, `home` negativo/não-inteiro/>20, array com <2 ou >4 itens (`min(2).max(4)`), `text` vazio, **`params` numa linha fun** (`red_card`/`corners` com `params` → falha da discriminated union), **campo `settleable` no output** (rejeitado por `.strict()`, não removido). Trunca `text` >280 no write helper.
  - `deriveSettleable("exact_score") === true`; `deriveSettleable("red_card") === false`, `deriveSettleable("corners") === false` (defesa Tier 3 / cron).
  - `buildUserMessage` inclui a seção "não repita" (placares **e** ideias fun) quando `excludedScores`/`excludedFunIdeas` não-vazios; omite a sub-seção vazia (contrato de exclusão).
  - `buildPredictionInput` achata `previousSets` → `excludedScores` (linhas exact_score com params → `{home,away}`) **e** `excludedFunIdeas` (linhas fun → `{type,text}`) corretamente.
- **`lib/ai/__tests__/ai-call-logging.test.ts`** (refactor commit 1): `persistAiCallError` engole erro de DB (mock `db.insert` rejeitando → não re-throw, `console.error` chamado). Garante que o refactor preservou o swallow.

### 7.2 Generator (mock do provider seam)
- **`lib/ai/palpites/__tests__/generate-palpites.test.ts`**: espelha o padrão golden-payload de `predict` (mockar `getProviderForModel` → `runAnalysis` retornando `AnalysisOk` com `toolInput`). Asserts:
  - **Output inválido do LLM** → `persistAiCallError(status:"invalid_output")` chamado, `PalpiteError` lançado, **nenhum** `palpite_set` inserido.
  - **`hasKey()===false`** → `status:"provider_error"`, throw, zero `runAnalysis`.
  - **tool_missing** → `status:"tool_missing"`, throw.
  - **Caminho ok** → insere ai_call(ok) → palpite_set → linhas do MIX; `settleable=true` na linha exact_score e `false` nas linhas fun; `modelVersion="claude-haiku-4-5"`, `promptVersion="palpites_v1"`.
  - **Golden payload — temperatura** (§1.4 passo 7): a `AnalysisRequest` capturada no mock inclui `temperature: 0.3` (passado explícito de `model.temperature`).
  - **Exclusão**: `previousSets` não-vazio → o `userMessage` montado (capturado no mock) contém os placares prévios.

### 7.3 pglite (DB real) — `// @vitest-environment node`
Reusar o harness do `get-palpite-sets-for-match.pglite.test.ts:1-40` (PGlite + migrate + `vi.mock("@/lib/db")` Proxy).
- **`lib/ai/palpites/__tests__/generate-palpites.pglite.test.ts`** (ou na action): write path real — após `generatePalpites` ok, `getPalpiteSetsForMatch` retorna 1 set com N linhas, `aiCallId` não-null, `settleable` correto (true só na linha exact_score, false nas fun). Verifica a sequência parent→child sem transação.
- **Assimetria de partial-write — ai_call falha (set sobrevive)**: forçar o insert de `ai_call` a falhar (mock/erro) → asserir que o set **É escrito** com `aiCallId=null` e **sobrevive** (`getPalpiteSetsForMatch` retorna 1 set, linhas presentes). Sem throw.
- **Assimetria de partial-write — palpite_set falha (sem órfãos)**: forçar o insert de `palpite_set` a falhar → asserir que `generatePalpites` **lança** e **NENHUMA** linha parcial resta (nenhum set, nenhum `palpites` órfão).
- **Guard de idempotência** (action): `generatePalpitesAction` chamado 2× → só **1** set existe (2ª é no-op); o provider mock é chamado **1×** (prova de "0 token na 2ª"). Mockar `auth()` + `checkPalpitesRateLimit`.
- **Concorrência do auto-run** (documentação de comportamento, §11): `Promise.all([generatePalpitesAction(m), generatePalpitesAction(m)])` (duas chamadas simultâneas, sem ordenação do guard) → asserir o comportamento OBSERVADO (race aceito: sem `UNIQUE` no DB, pode criar 2 sets; teto de dano ~US$0.004). Não é um guard a corrigir — é um teste que fixa o comportamento; anotar no PR.

### 7.4 Isolamento do rate-limit (`lib/__tests__/rate-limit.test.ts`)
- `checkPalpitesRateLimit` usa prefixo `ratelimit:palpites` (mockar `Ratelimit`/`Redis`, asserir o prefix passado), **não** incrementa o limiter de análise. Garante que auto-run não drena os 20/dia (asserir que `checkAnalysisRateLimit` e `checkPalpitesRateLimit` operam em instâncias `Ratelimit` distintas).
- **Verify**: confirmar se já existe `rate-limit.test.ts`; se não, criar com mocks de `@upstash/ratelimit`/`@upstash/redis` (sem KV real).

### 7.5 Flake guard (memória do repo)
pglite full-suite flakeia em 8-core local. Rodar a verificação local com `pnpm test --no-file-parallelism` (ou `--poolOptions.forks.maxForks=2`) antes de declarar verde; CI (2-core) é o gate real.

## 8. Landmines (não esquecer)

1. **Promise solto no render** = morto no serverless. SÓ o child cliente `PalpiteAutoRun` (§5.1). Nunca `void generatePalpites()` em page.tsx.
2. **Guard de idempotência ANTES do token** (§4.2): `getPalpiteSetsForMatch().length > 0` → no-op. Sem isso, todo reload duplica set e gasta Haiku.
3. **Rate-limit é bucket SEPARADO** (`ratelimit:palpites`). Reusar `checkAnalysisRateLimit` dreanalaria os 20/dia. Função própria.
4. **Bypass de gate de acesso** (§4.1): SEM `isEmailAllowed`/`isModelAllowedForAudience`. Palpite é universal (ADR 0028 §1). Mas exige `auth()` (FK `ai_calls.userId`).
5. **`settleable` derivado, nunca do LLM** (§2.4): `deriveSettleable(type)`. Mesmo predicado do cron (`palpites.ts:148-149`). Tier 3 gate: nenhum tipo settleable novo sem ADR.
6. **`aiCallId` NULLABLE** (`db/schema.ts:412`): o set sobrevive a uma falha de log; o write path insere o set mesmo com `aiCallId=null`. `modelVersion`/`promptVersion` em `palpite_sets` são notNull → a proveniência não depende do ai_call.
7. **neon-http: sequencial, não batch** (§6). `.returning()` para encadear ids.
8. **Falha SILENCIOSA no auto-run** (§4.2): action retorna `{ ok: true }` sempre; o erro vive em `ai_calls.status != "ok"`, nunca na UI.
9. **Sem odds/edge/stake/Yield em lugar nenhum** — nem no prompt, nem no schema, nem na persistência (ADR 0028 §1). Zero import de `lib/odds/*`, `./staking`, `./markets/*`.
10. **prose-tolerante**: `text` >280 → truncar, não rejeitar (não derrubar um set válido por uma frase longa).
11. **`extractDbCause`** (`predict.ts:931`) ao logar falha de insert — o erro real do PG mora em `err.cause`.
12. **Número de migration**: #315 NÃO cria migration (schema do #314 já MERGED). Se algo exigir schema, é sinal de erro de escopo — re-avaliar.

## 9. Sequência de commits pequenos

1. **`refactor(ai): extrai persistAiCallError + truncate p/ lib/ai/ai-call-logging.ts + unifica AiCallStatus`** — pré-passo (0): deleta a `AiCallStatus` local de `predict.ts:100-106` e importa de `./providers/types`; depois extrai `persistAiCallError`+`truncate` (que importam `AiCallStatus` de `./providers/types`); `predict.ts` importa de `./ai-call-logging`. **Grep gate**: `grep -rn 'type AiCallStatus' lib/ai` retorna **exatamente UMA** definição (a canônica em `providers/types`). Comportamento byte-idêntico; `pnpm test`+`typecheck` verdes. (commit isolado, reviewable sozinho)
2. **`feat(ai): bucket de rate-limit ratelimit:palpites + checkPalpitesRateLimit`** — `lib/rate-limit.ts` + teste de isolamento (§7.4).
3. **`feat(ai): cartucho palpites_v1 (exact_score) — prompt/tool/schemas/build-input`** — `lib/ai/palpites/{types,registry}.ts` + `cartridges/exact-score.ts` + `settleable.ts`; testes unit (§7.1). Commit `prompt:` se preferir o tipo por causa da versão de prompt.
4. **`feat(ai): generatePalpites() — seam de geração market-free (Haiku) + write path`** — `lib/ai/palpites/index.ts`; testes do generator (§7.2) + pglite write path (§7.3).
5. **`feat(palpites): server actions generate + regen (idempotente, silent-fail, bypass de gate)`** — `app/actions/palpites.ts`; pglite de idempotência (§7.3).
6. **`feat(palpites): trigger de auto-run (child cliente PalpiteAutoRun) na página do jogo`** — `components/palpites/PalpiteAutoRun.tsx` + mount em `app/match/[id]/page.tsx`. (stub sem UI; painel é #316)

Cada commit: `pnpm lint && pnpm typecheck && pnpm test` verdes (com o flag de paralelismo do §7.5 ao rodar local). PR fecha #315 manualmente após verde (lembrete: "Fecha #N" em PT-BR não auto-fecha).

## 10. Critério de saída

- `generatePalpites()` roteia pelo seam ADR 0027, loga em `ai_calls`, valida output por Zod, NÃO importa SDK nem máquina de mercado.
- Cartucho `palpites_v1` versionado; `settleable` derivado de `type`; sem odds/edge/stake.
- Bucket `ratelimit:palpites` isolado dos 20/dia.
- Auto-run idempotente por `(matchId,userId)` via child cliente; falha silenciosa; guard antes do token.
- Regen reusa o gerador passando exclusão; cada geração cria novo set sem repetir placares.
- Write path sequencial neon-http; `aiCallId` nullable tratado.
- Suíte verde (triade local + CI). #316 (UI) destravado.

## 11. Itens a descobrir na implementação (genuínos)

> Itens de temperatura (§1.4 passo 7), fail-open do rate-limit (§3), regen return shape (§4.3) e escopo de tipo v1 (§2.4) já são **decisões finais** acima — saíram daqui.

- **Auto-run concurrency race**: ACEITO. **Não** há `UNIQUE(matchId,userId)` no DB (quebraria o regen, que cria múltiplos sets por par por design). Adicionar um teste concorrente em §7.3 (`Promise.all` de duas chamadas da action) que **documenta** o comportamento observado; anotar no PR. Teto de dano ~US$0.004.
- **§1.4 passo 4 — largura do input**: manter enxuto (form/h2h/standings, nomes; **pular** absences/lineups). **Medir** o custo real de token em uma run; aparar se >US$0.003/set; anotar no PR.
- **Cartridge `inputSchema`**: ou chamar `cartridge.inputSchema.parse(input)` após `buildPredictionInput`, ou **remover** o campo se não for usado — não deixar declarado-mas-morto.
- **§7.4 `rate-limit.test.ts`**: confirmar se existe; se não, criar com mocks de `@upstash/ratelimit`/`@upstash/redis`; asserir que `checkPalpitesRateLimit` e `checkAnalysisRateLimit` batem em **prefixos DISTINTOS**.
- **Versionamento (ADR 0017)**: v1 = `exact_score` + `red_card` + `corners`; ajustes de prompt dentro deste escopo **NÃO** bumpam a versão; um **novo tipo** ou uma **nova regra de settlement** = v2.
