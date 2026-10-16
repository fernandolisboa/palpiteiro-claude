# PLAN-608 — Versões novas de Haiku, Sonnet e Opus entram sozinhas, por família

> Plano pré-issue, aterrado no código de `main` em 9e2b4cb (logo depois do #609 / ADR 0061). Snapshot de um ponto no tempo. ADR novo: **0062**.

## 0. Ideia central

- **O registry estático continua sendo a base conferida.** `MODEL_REGISTRY` (`lib/ai/models.ts`) segue com os três 5.5 e preço oficial, sempre disponíveis como fallback. `AIModelId` continua significando "id conferido" e serve, na prática, como a **chave da família** (`claude-sonnet-5-5` = "Sonnet").
- **A versão adotada mora no banco** (tabela nova `model_versions`). `resolveActiveModel(family)` é assíncrona e fica num módulo novo **só de servidor** (`lib/ai/model-versions/active.ts`). É memoizada por instância com TTL de 60s, no padrão de `lib/ai/engine/analysis-engine-flag.ts`. É fail-safe: erro, flag desligada ou row inválida → devolve a conferida.
- **A troca acontece no seam, não em cada call site.** `getProviderForModel()` (`lib/ai/providers/index.ts`) devolve o provider embrulhado por `withAdoptedVersions(provider)`. O wrapper recebe o `AIModel` conferido, resolve a versão ativa da família, chama, faz o fallback e devolve `servedModel` no `AnalysisResult`. Os call sites seguem resolvendo a cascata como hoje (preferência > default > `UTILITY_MODEL_ID`). A única mudança neles é **logar e calcular o custo com `result.servedModel`**.
- **Por que o wrapper e não resolver em cada call site:** são 8 portas de LLM. Com o resolver no seam, nenhuma esquece, e o fallback mora num lugar só.
- **Custo da escolha:** o modelo efetivo só é conhecido depois da chamada, então o `modelVersion` passa a ser composto depois da narração (§2.3). Hoje nada antes da chamada depende do id: `canFitCall` usa `model.speed`, e a versão adotada herda o `speed` da família.

## 1. Leituras síncronas do registry

### 1.1 Tipos (`lib/ai/models.ts`)

- `AIModel.id` passa a ser `string`. Entra `type PinnedModel = AIModel & { id: AIModelId }`, e `MODEL_REGISTRY` vira `Record<AIModelId, PinnedModel>`. Um `AIModel` vindo do banco tem id arbitrário.
- Campo novo opcional em `AIModel`: `adopted?: { priceEstimated: boolean; pinnedId: AIModelId }`. Fica ausente nos conferidos.
- `FAMILY_LABEL: Record<ModelFamily, string>` e `pinnedModelFor(family): PinnedModel` passam a ser exportados.
- `resolveModelId(raw)` também aceita a família pura (`"sonnet"` → `claude-sonnet-5-5`).
- `parseClaudeVersion(id)` é pura e usa a regex estrita `^claude-(opus|sonnet|haiku)-(\d+)-(\d+)(?:-(\d{8}))?$`. Devolve `{family, major, minor, snapshot}` ou `null`.
- **models.ts NÃO pode importar `db`**, porque componentes `"use client"` importam esse arquivo. Tudo que é assíncrono vai para `lib/ai/model-versions/*`.

### 1.2 Consumidores síncronos

| Onde | Depois |
|---|---|
| `lib/ai/cost.ts` `calculateCost` | recebe `{ model: AIModel, inputTokens, outputTokens }` e lê o preço do objeto |
| `lib/ai/ai-call-logging.ts` `persistAiCallError` | `model: AIModel` |
| `predict.ts` `resolveRunModel` | não muda (devolve a conferida da família) |
| `predict.ts` `inPlayModelVersion`, `codeJevModelVersion` | o parâmetro vira `string` e recebe o id efetivo (§2.3) |
| palpites, narrate, extract, bet-parse, news, cartões | não mudam a seleção (o wrapper faz a troca) |
| `getDefaultModelId`, `getPreferredModelId`, audiência | não mudam |
| `app/(app)/perfil/page.tsx`, default-model-form | rótulos via `getModelChoices` (§3) |
| `scripts/backtest-cartridge.ts` | `calculateCost({model})`; segue na conferida (reprodutibilidade) |
| `scripts/replay-eval-core.ts` `classifyThinkingMode` | `parseClaudeVersion(id) !== null \|\| isAIModelId(id)` |
| `scripts/replay-prompt-eval.ts` | não muda (replay na conferida) |

### 1.3 Histórico

- **Custo:** `ai_calls.cost_usd` é gravado na hora da chamada, e nada recalcula pelo registry. Quando o preço é confirmado, os custos já gravados **não** são reescritos (auditoria imutável).
- **Rótulos:** `formatModelName` (`lib/format.ts`) já é genérico. O seed do dropdown (`initialModelOverride` → `resolveModelId`) leva um id novo à conferida da família.
- **Calibração:** segmenta por `modelVersion`, então uma versão nova aparece sozinha como segmento.

## 2. Portas de LLM, fallback e modelo efetivo

### 2.1 Seam (`lib/ai/providers/types.ts`)

- `AnalysisOk` e `AnalysisErr` ganham **`servedModel: AIModel`, obrigatório**. Os adapters base devolvem `request.model`.
- `AnalysisErr` ganha `rejection?: "invalid_request" | "not_found"`. É preenchido por `rejectionOf(err)` em `anthropic/errors.ts`, com `Anthropic.BadRequestError` (400) e `Anthropic.NotFoundError` (404). O status continua `provider_error`.

### 2.2 Wrapper (`lib/ai/providers/adopted-versions.ts`)

1. **Repasse direto** se o provider não for anthropic ou se o pedido não for a conferida da família.
2. `active = await resolveActiveModel(family)`. Se for igual ao pedido, repassa.
3. Chama em `active`. Devolve como está, com `servedModel: active`, se a chamada:
   - deu ok, ou
   - falhou sem `rejection`, ou
   - falhou com usage > 0, já que refazer perderia o custo de `pause_turn`.
4. **Rejeição com usage 0:** refaz na conferida, com o mesmo `deadlineAt`.
5. **Quando marcar a versão como falha:**
   - em `not_found`, sempre;
   - em `invalid_request`, só se a conferida passou (um 400 que falha nas duas é culpa do pedido).

   Ao marcar: `markModelVersionFailed` + `resetActiveModelMemo()`, em try/catch.
6. **O que devolve:** `r2` com `servedModel: req.model` e `outputPayload.adoptedFallback = { model, status, error }`.

### 2.3 Call sites

- **predict (caminho LLM):** o erro, o custo, o insert e `modelVersion` usam `served`.
- **narrateWith / runNarration:**
  - `NarrationOutcome.servedModel` (quando não houve chamada, vale o pedido);
  - a função devolve `{ aiCallId, output, servedModelId }`.
- **Armadilha:**
  - `codeJevModelVersion` e `inPlayModelVersion` são compostos antes da narração. A correção é `withModelId(modelVersion, modelId)` em `lib/format.ts`.
  - O helper é aplicado em `persistPendingPrediction` (best bet, todos os mercados do run), no code_jev avulso e em `predictInPlay`.
- **palpites (`palpite_sets.modelVersion` incluso), user-palpite narrate/extract, bet-parse, news, cartões:** mesmo padrão. Nos `catch` em volta de `runAnalysis`, usa o pedido.

## 3. Escolha do usuário e do admin

- **Ficam gravados os ids conferidos** (`users.preferred_model_id`, `ai_config.default_model_id`), sem migration: o id conferido já é a chave da família.
- **Muda o rótulo:** `getModelChoices(isAdmin)` (`lib/ai/model-versions/choices.ts`) monta "Sonnet · versão 5.6 (automática)". Usam esse rótulo:
  - a página de perfil;
  - o `default-model-form`, que recebe options e o preço por prop.
- Override por análise e audiência não mudam.

## 4. Banco

### 4.1 `model_versions`

| Grupo | Colunas |
|---|---|
| Identificação | `id text PK`, `family` (CHECK opus/sonnet/haiku) |
| Metadado da API | `displayName`, `apiCreatedAt`, `capabilities jsonb`, `maxTokens` |
| Estado | `status` (CHECK active/superseded/failed/reverted) |
| Preço | `inputPricePerMTok`, `outputPricePerMTok`, `longPromptAboveInputTokens` / `longPromptInputPricePerMTok` / `longPromptOutputPricePerMTok` |
| Confirmação do preço | `priceEstimated` (default true), `priceConfirmedAt`, `priceConfirmedByUserId` |
| Adoção e falhas | `adoptedAt`, `failureCount`, `lastFailureAt`, `lastFailureReason` |
| Rastreio | `probeAiCallId`, `createdAt`, `updatedAt` |

**Índice único parcial:** uma `active` por família.

### 4.2 `ai_config`

- `enableAutoModelVersions` (default true);
- `modelVersionsCheckedAt`;
- `modelVersionsCheckSummary jsonb`.

### 4.3 `ai_calls` para a sondagem

- `promptVersion` da sondagem: `model_probe_v1` (e `model_probe_search_v1` no Haiku).
- `match_id` passa a aceitar NULL.
- `ai_calls_user_id_system_only` é recriado **com o mesmo nome**, aceitando `prompt_version LIKE 'model_probe_%'`.
- Constraint nova: `ai_calls_match_id_system_only`.
- Os scripts que fazem join por `matchId` ganham um guard.

### 4.4 Migration

`0060_model_versions.sql` sai de `pnpm db:generate` e é editada à mão:

- IF NOT EXISTS;
- DO/duplicate_object;
- DROP CONSTRAINT IF EXISTS antes de re-ADD.

### 4.5 Queries (`lib/db/queries/model-versions.ts`)

- `getActiveModelState()` lê o banco direto, sem importar `ai-config.ts`.
- `listModelVersions`.
- `adoptModelVersion` é um CTE único (neon-http não tem transação).
- `recordFailedVersion`, `markModelVersionFailed`, `confirmModelVersionPrice`, `revertFamily`, `setModelVersionsCheck`.

## 5. Cron `app/api/cron/check-model-versions`

- **Rota:** `runtime nodejs`, `force-dynamic`, `maxDuration 300`, `isAuthorizedCron`, lock KV. Roda diariamente às `15 8 * * *`.
- **Orquestrador:** `runModelVersionCheck` (`lib/ai/model-versions/check.ts`).

1. Sem chave → `skipped`.
2. Listagem sem cache que lança erro (refactor de `models-catalog.ts`). A listagem fica fora de `ai_calls`: é metadado e não custa nada.
3. Kill switch desligado → só grava o resumo.
4. `pickCandidate`, puro:
   - regex estrita;
   - (major, minor) maior que a conferida e que a ativa;
   - ignora ids já em `model_versions`;
   - prefere o alias ao snapshot;
   - `created_at` desempata.
5. **Capabilities** (`ModelInfo` do SDK 0.95.2). Reprova se:
   - `capabilities` vier null;
   - faltar `thinking.types.adaptive.supported`;
   - faltar `effort.supported` ou algum de `effort.low/.medium/.high/.max .supported`;
   - `effort.xhigh` for null;
   - `max_tokens` < 32000.

   Reprovou → `recordFailedVersion`.
6. **Sondagem** (`probe.ts`):
   - usa o adapter cru, com o formato de produção (`buildAnthropicRequest`);
   - tool `submit_probe` com `{answer:int}`, `tool_choice auto`, `thinking adaptive`, `effort low`, `max_tokens 2048`;
   - pergunta "2+3" e passa se `answer === 5`;
   - no Haiku, uma segunda chamada com web search (`maxUses: 1`);
   - cada chamada loga em `ai_calls`, com custo pelo preço herdado.
7. **Falha:**
   - rejeição, tool_missing, Zod ou resposta errada → `recordFailedVersion`;
   - erro transitório (rate_limited, timeout, 5xx) → só o resumo; tenta de novo amanhã.
8. Passou → `adoptModelVersion` com o preço herdado e `priceEstimated = true`, depois `resetActiveModelMemo()`.
9. `setModelVersionsCheck(summary)`. O prazo é de 240s.

- **Custo:** centavos, e só quando sai versão nova.

## 6. Kill switch

- Entrada `enableAutoModelVersions` em `ADMIN_FLAGS` (`lib/config/admin-flags.ts`), default ON.
- Getter em `ai-config.ts`.
- `updateAdminFlag` chama `resetActiveModelMemo()`.
- Desligado → só as conferidas rodam. As rows `active` ficam intactas.

## 7. Painel em /admin/settings

- **Removidos:** `unregistered-models-note.tsx`, `unregisteredApiModels` e `listApiModels` (com o cache).
- **Novo:** `model-versions-panel.tsx`, um Server Component. Mostra, por família:
  - a versão em uso, com selo "automática desde" ou "conferida";
  - o fallback;
  - o preço, com selo "estimado";
  - o formulário de confirmar preço;
  - as falhas;
  - o botão "usar a conferida".
- **No rodapé:** última checagem e resumo, estado do kill switch e "verificar agora".
- **Actions** (todas com gate de admin, revalidate e reset do memo):
  - `confirmModelVersionPrice` (Zod);
  - `useCheckedModel` (revert);
  - `checkModelVersionsNow`.

## 8. Testes

- **Novos:**
  - `parseClaudeVersion`, `resolveModelId("sonnet")`;
  - cost com `AIModel`;
  - `active` (TTL, fail-safe, flag, Zod, reset);
  - wrapper (repasse, `servedModel`, 400/404, usage > 0, `adoptedFallback`, falha ao marcar);
  - `rejectionOf`;
  - `pickCandidate` e capabilities;
  - probe;
  - pglite do check (CTE, falha, flag, idempotência, CHECKs de `ai_calls`);
  - rota do cron;
  - actions;
  - painel;
  - predict com `servedModel ≠ pedido` (caminho LLM, best bet code_jev, in-play).
- **O que quebra:**
  - **Mocks do banco:**
    - ~25 arquivos mockam `@/lib/db` com um select genérico. Um mock global em `vitest.setup.ts` de `@/lib/db/queries/model-versions` faz `getActiveModelState → {enabled:false, active:[]}`.
    - Validar primeiro que setupFile se aplica. O plano B é mockar arquivo por arquivo.
    - O wrapper não importa `ai-config.ts`, porque ~27 arquivos mockam esse módulo com factory.
  - **Fakes de `AnalysisResult` sem `servedModel`** (typecheck e `toEqual`).
  - **Asserts de `persistAiCallError({model:"claude-…"})`.**
  - **Outros:** `cost.test`, `models-catalog.test`, `unregistered-models-note.test` (removido), `admin-flags` (pglite e unit).

## 9. Riscos

1. **`models.ts` no bundle do cliente:** sem `db` nem resolver ali.
2. **`modelVersion` composto antes da chamada** (§2.3).
3. **Um 400 do pedido derrubando uma versão boa:** marca só se a conferida passar.
4. **Falha parcial no `pause_turn`:** não refaz.
5. **Prazo do run:** o adapter devolve timeout sem chamar.
6. **neon-http sem transação:** CTE mais índice parcial.
7. **Preço estimado errado:** o selo fica visível, e os custos já gravados não são reescritos.
8. **Conferida fora da listagem da API:** a comparação é pelo número da versão.
9. **Ids exóticos:** `-preview` fica fora. Um major novo (Sonnet 6) entra, por decisão do dono.
10. **Capabilities incompletas:** fail-closed.
11. **Preview DB compartilhado:** migration idempotente.
12. **A sondagem não passa por predict.ts:** usa o seam e loga em `ai_calls`, como palpites, notícias e cartões.
13. **Scripts:** ficam na versão conferida, de propósito.

## 10. Ordem e PRs

- **PR A — o seam informa o modelo efetivo (sem mudança de comportamento):**
  - tipos;
  - `calculateCost` e `persistAiCallError` com `AIModel`;
  - `servedModel` e `rejection`;
  - os 8 call sites;
  - `withModelId`;
  - testes.
- **PR B — adoção automática (ADR 0062):**
  - validar o mock global;
  - schema e migration;
  - queries, resolver e wrapper;
  - flag;
  - listagem, candidatos, capabilities, sondagem, check, cron e lock;
  - painel, actions e `getModelChoices`;
  - ADR, ARCHITECTURE e CLAUDE.md.
- **Verificação em preview:** uma row `active` falsa → 404 → fallback pra 5.5 → `failed` → `ai_calls.model = 5.5`.

---

## 11. Ajustes depois do review do plano (prevalecem sobre as seções acima)

**Correções obrigatórias**
- **B1 · Regex de versão.** `parseClaudeVersion` passa a usar `^claude-(opus|sonnet|haiku)-(\d{1,2})(?:-(\d{1,2}))?(?:-(\d{8}))?$`, com minor ausente = 0.
  - `claude-sonnet-6` → 6.0 (entra).
  - `claude-sonnet-5-20260301` → 5.0 (não é candidato).
  - `claude-haiku-5-6-20261101` → 5.6 com snapshot.
- **B2 · Adoção atômica.** O CTE dava erro 23505: o índice parcial é checado antes do UPDATE do CTE. A adoção vira `db.batch([supersede, insert])`, que no neon-http é uma transação (padrão de `lib/db/queries/team-ratings.ts`).

**Mudanças na versão adotada e no cron**
- **S1 · E-mail no cron** (Resend, `SPEND_ALERT_EMAIL`), quando:
  - uma versão é adotada (com o preço estimado, pedindo confirmação);
  - uma versão falha ou é rebaixada;
  - uma conferida some da listagem.

  Isso substitui o botão "verificar agora".
- **S2 · Regressão em produção.** No cron, para cada versão adotada há mais de 24h:
  - a taxa de `tool_missing` + `invalid_output` + recusa em `ai_calls` desde `adoptedAt` é comparada com a da conferida nos 7 dias anteriores à adoção;
  - com n ≥ 10 e taxa ≥ max(2×, +15pp), a versão vira `failed` ("regressão"), e o e-mail sai.
- **S3 · Dedup por versão.** O candidato é descartado quando já existe uma row da mesma (família, major, minor), em qualquer status.
- **S4 · Capabilities.**
  - `xhigh?.supported === true`.
  - `max_tokens === null` ou `< MAX_TOKENS_MAX` reprova.
  - `capabilities === null` é transitório (tenta amanhã), não `failed`.
- **S5 · Erros 403 e 529.** 403 (`PermissionDeniedError`) é tratado como `not_found`. 529/overloaded com usage 0 cai para a conferida sem marcar.
- **S6 · Sondagem do Haiku** no formato real de notícias e cartões:
  - effort `UTILITY_SEARCH_EFFORT` (medium);
  - `allowedDomains`;
  - `maxUses: 1`;
  - só passa se houver um bloco `web_search_tool_result`.

  Opus e Sonnet não testam web search: nenhum caminho de produção usa.
- **S7 · `modelVersion` montado no fim.** `PersistArgs` passa a carregar `modelId` + `modelTags`, e `persistPrediction` monta a string no fim, então nenhum caminho compõe a versão antes da chamada. `lib/ai/best-bet.ts` (~l.450–478) repassa `narration.servedModelId` para `persistPendingPrediction`.
- **S8 · Conferida aposentada.** O cron confere se os 3 ids conferidos ainda aparecem na listagem e avisa no resumo e no e-mail.
- **S9 · Replay de prompt.** Roda no id gravado quando ele é uma versão adotada reconhecida por `parseClaudeVersion` e mais nova que a conferida; caso contrário, usa `resolveModelId`. Avisa no log.
- **N5 · Falha transitória.** Depois de 7 dias seguidos, a versão vira `failed` ("transitório persistente").

**Cortes**
- **C1.** Sai o botão "verificar agora" e o lock KV. Para rodar à mão: `curl` com `CRON_SECRET`.
- **C2.** Sai o status `reverted` e `useCheckedModel`. Fica só "rejeitar esta versão", que marca `failed` com o motivo "rejeitada pelo admin".
- **C3.** O preço vira `pricing jsonb` validado por Zod, no formato do `AIModel` (input, output, `longPromptPricing?`). `priceConfirmedAt IS NULL` significa estimado. Saem `priceEstimated` e `priceConfirmedByUserId`. O form confirma input e output.
- **C4.** Sai `getModelChoices`. Os rótulos do registry viram o nome da família ("Opus", "Sonnet", "Haiku (econômico)"), tudo síncrono. A versão concreta só aparece no painel admin e no rodapé da análise (`formatModelName` do id que serviu).
- **C5.** Saem `resolveModelId("sonnet")`, `failureCount` e `lastFailureAt` (fica `failureReason` + `updatedAt`), e o resumo do check fica enxuto.

**Sem mudança**
- **C6.** A sondagem continua em `ai_calls` (regra do CLAUDE.md: toda chamada de LLM é logada), com as CHECKs do §4.3. Afrouxar o `match_id` é seguro (só `scripts/replay-prompt-eval.ts` precisa de guard).
- Os 2 PRs ficam como estão.

**Detalhes**
- **N1.** O replay (`calculateCost`), `backtest-cartridge.ts:600` e `generateLivePalpites` (`palpites/index.ts:662`) também mudam.
- **N2.** Mock global em `vitest.setup.ts`, com `importOriginal`. Os testes pglite usam `vi.unmock`.
- **N3.** `markModelVersionFailed` idempotente e `inFlight` de dedup no resolver.
- **N4.** O override do admin "Sonnet" também usa a versão adotada. Para forçar a 5.5: kill switch ou "rejeitar". Isso vai para o ADR.
- **N6.** A calibração NÃO segmenta por modelo (`calibration.ts` lê só engine/engineConfig). Comparar versões fica fora deste escopo.
