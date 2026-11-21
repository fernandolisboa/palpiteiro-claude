# PLAN-669: narração do code_jev caindo no texto padrão

Issue: #669. Em produção (Palmeiras x Flamengo, 2026-11-21), a etapa do progresso mostrou "A IA não respondeu: a análise saiu com o texto padrão" numa narração de 1X2. O código decidiu `home` por preço. A causa real está em `ai_calls.error_message`, mas o Fernando só consegue ler essa coluna com SQL no PC, e a nuvem não alcança o banco de produção. O plano tem duas partes:

- **(A)** dar uma tela de admin para ler as falhas;
- **(B)** reduzir a causa provável (o narrador cita a chance do favorito e a fidelidade reprova), dar copy honesta por tipo de falha e uma segunda tentativa com retorno.

As duas partes saem num PR só (uma branch por thread).

## Estado atual (aterrado no código)

- **`lib/ai/predict.ts`, `narrateWith` (~3308–3418)**: monta o `AnalysisRequest` (`system = cartridge.systemPrompt`, `userMessage = cartridge.buildUserMessage(decision, context)`); `canFitCall(deadlineAt, {speed, maxTokens, effort})`; só quando cabe roda `beforeLlmPath` (slot de rate-limit); `beginStep(narrationStep(...))`; `runNarration` ou `narrationSkippedForDeadline`; fecha a etapa com `skip()`, `fail()` (toda falha com a mesma copy `spec.failed`) ou `done()`; insere **uma** row em `ai_calls`; devolve `{aiCallId, output ?? cartridge.fallback(decision), servedModelId}`.
- **`runNarration` (~3439–3503)**: sem chave/exceção/`!result.ok` → `provider_error`/`timeout`/`rate_limited`; sem tool → `tool_missing`; Zod → `invalid_output` (JSON das issues); fidelidade → `invalid_output` com `"fidelity: <reason>"`. Recusa do modelo cai em `provider_error`.
- **Quem chama `narrateWith`**: `narrateDecision` (pré-jogo) via `narratePendingPrediction` (fan-out em `lib/ai/best-bet.ts` com `beforeLlmPath: takeSlot`, e predict avulso); leitura ao vivo (`liveNarratorCartridge`). A reconferência com escalação não chama o LLM.
- **`toNarratorDecision` (:3186–3249)**: `focus` = lado gateado ou `engine.best` num pass. A decisão **não carrega** as outras seleções; o `engine: CodeJevDecision` (`lib/ai/engine/code-jev.ts`) já tem `modelProbByKey` e `evaluations` (`{key, line, modelProbPct, impliedPct, edgePct}`).
- **`user-message.ts` `decisionBlock`**: só os números do `focus`.
- **`fidelity.ts` `allowedPercents`**: `minEdgePp` + prob/implícita/|edge| do focus + complemento em 2 vias. No 1X2, citar a chance do outro lado reprova. Hipótese principal do incidente.
- **`prompt.ts`**: `narrator_v1.4`. A regra 2 do system diz "cite no máximo os percentuais que aparecem no bloco 'Decisão'": pôr as seleções **dentro** do bloco Decisão mantém o system idêntico e o cache (ADR 0071). Ao vivo: `narrator_live_v1`.
- **`lib/ai/progress/steps.ts`**: `narrationStep.failed` fixo; `StepHandle.fail(label?)` aceita rótulo; `protocol.test.ts` passa todo `STEP_NOTES` pelo `containsValueLanguage` e por `/%|\d/`.
- **Admin**: gate no layout + `role !== "admin" → notFound()` em cada página (`page-role-guard.test.ts`); abas em `ADMIN_SECTIONS[].children` (`lib/nav/menu.ts`); busca em `lib/admin/settings-index.ts`; padrão em `app/(app)/admin/ia/custos/page.tsx` e `lib/db/queries/ai-costs.ts`.
- **LGPD (ADR 0046)**: `error_message` de `bet_parse%`, `user_palpite%` e `bet_slip_explain%` pode ecoar texto do usuário. A página não mostra payloads e anula esse texto no SQL.

## Parte A: `/admin/ia/falhas`

### A1. Query `lib/db/queries/ai-call-failures.ts` (nova)

```ts
export const AI_CALL_FAILURE_WINDOWS = [1, 7, 30] as const;      // dias
export const AI_CALL_FAILURES_PAGE_SIZE = 50;
export const FREE_TEXT_PROMPT_PREFIXES = ["bet_parse", "user_palpite", "bet_slip_explain"] as const;

export type AiCallFailureRow = {
  id: string; createdAt: Date; matchId: string | null;
  homeTeam: string | null; awayTeam: string | null;
  provider: string; model: string; promptVersion: string;
  status: AiCallStatus; errorMessage: string | null; errorRedacted: boolean;
  latencyMs: number; costUsd: number;
};
export async function getAiCallFailures(args: { days: number; matchId: string | null; page: number; now?: Date }): Promise<{ rows: AiCallFailureRow[]; hasMore: boolean }>;
export type AiCallFailureSummary = { promptVersion: string; total: number; failed: number; byStatus: Partial<Record<AiCallStatus, number>> }[];
export async function getAiCallFailureSummary(args: { days: number; matchId: string | null; now?: Date }): Promise<AiCallFailureSummary>;
```

- Colunas explícitas, **nunca** `inputPayload`/`outputPayload` (teste trava as chaves). `leftJoin(matches)`; `status <> 'ok'`, janela, filtro opcional por jogo; `orderBy(desc(createdAt), desc(id))`, `limit(PAGE_SIZE + 1)`.
- Redação **no SQL** (`case when prompt_version like 'bet\_parse%' ... then null`), `errorRedacted` idem.
- Resumo: `group by prompt_version, status` com todas as rows (ok incluído) pra dar a taxa; mostrar só versões com falha.

### A2. Parâmetros `lib/admin/ai-call-failures-params.ts` (puro)

`parseAiCallFailuresParams({dias, jogo, pagina})`: `dias` fora da lista → 7; `jogo` só uuid válido (uuid inválido derruba a query no Postgres); `pagina` inteiro 1..200. Mais `failuresHref(params)`.

### A3. Página `app/(app)/admin/ia/falhas/page.tsx`

Server Component, `force-dynamic`, guard de admin na primeira linha, `PageHeading`, `AdminSubTabs current="/admin/ia/falhas"`, `RevisitRefresh`. Seletor de janela por links; chip do jogo filtrado com "limpar filtro". Resumo por versão de prompt. Lista: quando (Brasília), jogo (`IntentLink` + "só este jogo"), prompt/modelo em mono, status com rótulo PT (enum cru no `title`), erro em `<details>` (prévia ~140 caracteres, texto inteiro no corpo; redigido → "texto omitido (pode conter texto do usuário)"), latência e custo. Vazio: "Nenhuma falha nesta janela." Paginação.

### A4. Navegação

`lib/nav/menu.ts` ganha a aba "falhas" em `/admin/ia`; `lib/admin/settings-index.ts` ganha a entrada "Falhas de IA".

### A5. Testes

pglite da query (só não-ok, janela, ordem, filtro, paginação, redação, sem payloads, `costUsd` number, resumo); params; menu; settings-index se travar ids.

## Parte B: narrador (`narrator_v1.5` e `narrator_live_v1.1`)

### B1. `NarratorDecision.selections: NarratorSelection[]` (obrigatório)

Montado em `toNarratorDecision` a partir de `engine.evaluations` filtradas pela linha decidida (fallback `engine.modelProbByKey`), na ordem de `selectionKeys`. O template (`fallback.ts`) não lê.

### B2. Mensagem do usuário

Dentro de "## Decisão", depois do focus: lista de todas as seleções (modelo · implícita sem margem, "sem odd" quando nula) e a linha "A decisão compara a chance do modelo com o preço de cada seleção, não aponta quem é o favorito ... sem verbos de aposta para ele". `SYSTEM_PROMPT` e tool **não mudam** (teste de hash).

`buildNarratorMessage(decision, context, rejection?)`: 3º parâmetro opcional (B5).

### B3. Fidelidade

`allowedPercents` aceita prob e implícita de cada seleção. Não entram edges das outras. A checagem de lado não muda.

### B4. Copy por tipo de falha

`STEP_NOTES.narrationOffFormat` ("O texto da IA veio fora do formato: a análise saiu com o texto padrão") e `STEP_NOTES.narrationMismatch` ("O texto da IA não passou na conferência com os números: a análise saiu com o texto padrão"); `narrationFailedLabel("no_answer" | "format" | "fidelity")`.

### B5. Segunda tentativa

- `NarrationOutcome` ganha `failure` e `retryFeedback` (só em format/fidelity; Zod resumido em PT, até 500 caracteres; `errorMessage` segue o JSON).
- Helper `rejectionBlock(reason, block)` em `lib/ai/markets/_narrator/retry.ts`, inserido antes da última linha da mensagem (pré-jogo e ao vivo). Só na mensagem do usuário: o prefixo cacheado é lido na 2ª chamada.
- `narrateWith`: no máximo **uma** nova tentativa, só em format/fidelity e só se `canFitCall` ainda couber; `beforeLlmPath` não roda de novo (mesmo slot). `no_answer` nunca repete. Uma row por chamada, inseridas em ordem (`insertNarrationCall` extraído sem mudar comportamento); a 2ª falha leva `retry: ` no `error_message`; a prediction aponta pra row final. Sem prazo pra 2ª: fecha `fail` com a copy da recusa.
- Custo: pior caso +1 narração por análise, só quando a 1ª é recusada (≈ US$ 0,006–0,017, menos o prefixo cacheado).

### B6. Versões e ADR

`narrator_v1.5`, `narrator_live_v1.1`, commit `prompt:`. Adendo (#669) curto no ADR 0041 §4.

### B7. Testes

- `narrator.test.ts`: fixtures com `selections`; versão; hash de system/tool igual ao da v1.4; mensagem 1X2 com as três seleções dentro do bloco Decisão; fidelidade aceita a chance do favorito e a implícita do empate, reprova número fora, reprova "o mercado aposta no X"; bloco de recusa.
- `narrator-live.test.ts`: versão, hash do system, bloco de recusa.
- `protocol.test.ts`: `narrationFailedLabel`.
- `predict.code-jev.test.ts`: Zod e fidelidade → 2 chamadas e 2 rows; recusa e depois ok → `[invalid_output, ok]` com o texto do LLM e a prediction na row ok, system idêntico nas duas; `tool_missing` → 2; provider_error → 1; recusa do modelo → 1; prazo → 1 e etapa `failed` com `narrationMismatch`; slot cobrado 1× no best bet; mensagem com "Empate" e os dois times; labels de progresso por tipo.
- `predict.in-play.test.ts`: fidelidade 2 rows; recusa e depois ok.

## Landmines

- Cache: system e tools não mudam nem 1 byte.
- Citar o favorito aumenta "o mercado aposta no X", que o `recommends` lê como recomendação; mitigado pela instrução e pela 2ª tentativa. Não afrouxar a regex aqui.
- Payloads nunca no `select`; `FREE_TEXT_PROMPT_PREFIXES` precisa crescer com novos prompts de texto livre.
- uuid inválido no `?jogo=` saneado antes da query.
- Nenhum teste chama LLM real.

## Critério de saída

`/admin/ia/falhas` lista as falhas legíveis, filtra por jogo e mostra a taxa por versão, sem payloads; a etapa diz se a IA não respondeu, veio fora do formato ou não bateu com os números; o 1X2 cita o favorito sem reprovar; a recusa tenta uma 2ª vez com prazo e sem slot extra. `pnpm lint`, `typecheck`, `test` e `build` verdes.

## Ajustes da revisão do plano (valem sobre o texto acima)

- **A0 (novo, barato):** o painel de admin da análise (`/admin/users/<userId>/<predictionId>`, `lib/view/dashboard.ts` ~447–463 + `components/dashboard/prediction-detail.tsx`) já mostra status e saída crua da narração; passa a mostrar também `aiCall.errorMessage`. Rows ligadas a prediction nunca são de prompt de texto livre.
- **A: sem paginação.** Últimas 100 na janela + filtro por jogo. `jogo` validado com `z.uuid()` (como em `admin/users/[userId]/[predictionId]/page.tsx`). `AdminSubTabs section="/admin/ia" current=...`. Datas com `getRequestTimeZone()`. Atualizar a description de `/admin/ia` em `ADMIN_SECTIONS`. Redação com `starts_with(prompt_version, ...)`; comentário da constante cita o ADR 0046.
- **Um mecanismo só de reprovação:** nada de 3º parâmetro em `buildUserMessage`. `narrateWith` pós-processa `withRejection(cartridge.buildUserMessage(d, c), feedback)` inserindo o bloco antes da última linha ("Escreva ... via submit_narration."); teste trava que as duas mensagens terminam nessa linha.
- **Row 1 gravada antes da 2ª tentativa** (`insertNarrationCall` logo após a 1ª), pra não perder o custo pago se a função morrer no meio.
- **`retryOf: <id da row 1>`** no `outputPayload` da 2ª row; a query do admin seleciona só o escalar `output_payload->>'retryOf'` e a página mostra "2ª tentativa". O card da análise mostra o custo da row final; aceito e registrado (o `/admin/ia/custos` soma as duas).
- **Sem 2ª tentativa em `tool_missing` com `stopReason === "max_tokens"`** (falharia igual).
- **Comentários "1 chamada paga = 1 slot"** atualizados (`narratePendingPrediction`, `best-bet.ts` `acquireSlot`/`runCodeJevFanOut`, comentários de teste); o adendo do ADR 0041 diz que a 2ª tentativa não cobra slot (a falha é nossa).
- **Hash de system e tool fixado com o valor de ANTES da mudança** (v1.4 e live v1), calculado no main atual e escrito como literal; no teste da 2ª tentativa, `tools` e `system` idênticos.
- **Testes a mais:** contagens em `predict.code-jev.test.ts:851/:866`, `predict.in-play.test.ts:357`, e um caso de 2ª tentativa em `best-bet-code-jev.test.ts` (caminho real do fan-out).
- **B1:** sem o fallback `engine.modelProbByKey`; tipo estreito pras outras seleções `{key, label, modelProbPct, impliedPct}` (sem edge).
- **B4:** a copy num lugar só (`STEP_NOTES`), escolhida inline no `step.fail(...)`; no ao vivo, "leitura" em vez de "análise".
- **B5:** feedback de Zod = `path: message` em inglês mesmo, até 500 caracteres; feedback de fidelidade só a primeira parte do motivo (sem a lista `[...]` com ponto decimal).
- **Nomes:** "reprovação" pra nossa conferência; "recusa" só pra `stop_reason: refusal`.
