# HANDOFF — Wave final pós-pivot: multi-AI provider (#229 → #230 → #231)

> Snapshot 2026-06-17. **Auto-suficiente**, aterrado no código real. NÃO é spec viva.
> Objetivo da wave: fazer os **3** de uma vez (#229 ADR → #230 seam → #231 provider de prova).
> **Depois desta wave, falta só o #246** (polish visual da match page, com `/impeccable`) pra fechar o pós-pivot.

## TL;DR

Hoje todo o caminho de LLM é **Anthropic-shaped** e o repo quer avaliar/abrir pra um 2º provider
(OpenAI/Gemini/xAI). A wave: **(#229)** escreve o **ADR** que decide SE/COMO; **(#230)** extrai o
**seam `AIProvider`** (Anthropic-only, zero-behavior-change); **(#231)** pluga **UM** provider de
prova (admin-only, com saída A/B). Cada issue passa pelo **plano-portão de 2 rodadas**
([[two-round-plan-gate-for-pivot]]): plan-review → rework → lean re-verify ANTES de código.

⚠️ **#229 é um go/no-go honesto, não um carimbo.** O próprio corpo da issue admite: valor
**baixo-a-médio** pra um app solo (majoritariamente *aprendizado de IA*, objetivo do projeto), e
multi-provider **trabalha CONTRA a reprodutibilidade do ADR 0021**. É o MESMO padrão do #225
(a discovery revelou valor baixo → outcome enxuto). O ADR deve pesar isso com franqueza e
recomendar **a fatia mínima** (seam + 1 PoC admin-only) com **critério de saída A/B** — e pode
legitimamente recomendar **parar na PoC** se o A/B não justificar perder reprodutibilidade.

## Estado que já landou (deps SATISFEITAS — reconciliar com código, não com alvo móvel)

- **#179 (contract da Fase 5)** concluído/live — o sequenciamento pós-pivot está liberado.
- **#203 MERGED** (PR #306): `DEFAULT_MODEL_ID = claude-sonnet-4-5-20250929` (default reprodutível,
  caminho temperature); migration 0032 flipou a row `ai_config`; **gate de replay model-aware**
  (`scripts/replay-eval-core.ts` + `replay-prompt-eval.ts`) que distingue adaptive vs temperature
  por `thinkingMode` — **isso é Anthropic-específico**. O #229 dizia "reconciliar com #203 em voo";
  agora #203 está **fechado**, então o ADR reconcilia com **código landado**, não com alvo móvel.
- **Arco desfalques #225/#226/#227 MERGED**; **#228 desescopado** (cache, baixo ROI). Ver
  [[work-order-post-pivot]]. Padrão de provider opcional **key-gated/inerte** (SportMonks no #227)
  é o template pro provider de prova sem chave: [[work-order-post-pivot]].

## Ler primeiro

1. As 3 issues: `gh issue view 229|230|231` (ricas, citam file:line — mas **algumas linhas/números
   estão STALE**, ver Landmines).
2. ADRs que o 0027 amenda/preserva: **0008** (modelo calibrável), **0013** (seleção/audiência
   `userSelectable`), **0021** (estratégia de modelo / reprodutibilidade). Antecedente: #123 (discovery fechada).
3. Superfície de acoplamento Anthropic (linhas ATUAIS verificadas 2026-06-17):
   - `lib/ai/predict.ts`: `import Anthropic` (**:1**); `getAnthropicClient` (import :44, uso :789);
     `buildAnthropicRequest` (import :54, uso :776); `classifyAnthropicError` (:162) /
     `serializeAnthropicError` (:189); `client.messages.create` (:793); `response.usage.input_tokens/
     output_tokens` (:815-816); extração `tool_use` (:819-822); `cartridge.outputSchema.safeParse(toolUse.input)` (:846).
   - `lib/ai/anthropic.ts` (client), `lib/ai/request-builder.ts` (as 3 armadilhas-400: `thinking:{type:adaptive}`
     sem temperature / `tool_choice` forçado vs `auto` / `output_config.effort`).
   - `lib/ai/models.ts`: `AIModelId` union + `MODEL_REGISTRY` (assume `thinkingMode` + pricing Anthropic);
     `lib/ai/cost.ts` `calculateCost` (tipado por `AIModelId`).
   - `db/schema.ts:50`: `aiProviderEnum = pgEnum("ai_provider", ["anthropic"])`, usado em `:233`.

## Sequenciamento & contrato de cada fatia

### #229 — ADR (= **0027**, NÃO 0024) — discovery/decisão
- Estrutura 7 seções, PT (espelha 0021/0026). Recomendação **fundamentada**: vale ou não pra app solo
  (franqueza sobre valor baixo-a-médio + tensão com reprodutibilidade do 0021).
- Define a interface `AIProvider` + ponto de injeção em `predict.ts` **sem furar a fronteira do SDK**.
- Decide **enum-vs-text** pro `provider` (convenção do repo: `model`/`preferredModelId`/`promptVersion`
  já são `text` validado-na-app → evita migrations futuras; mas `aiProviderEnum` hoje é enum).
- Escolhe o **provider de prova** (recomendação a fundamentar: **OpenAI** por maturidade de JSON-mode/
  tool-calling) e justifica.
- Diz o que amenda (0008/0013/0021) e **como preserva o default reprodutível** já landado pelo #203.
- Critério de **saída A/B** explícito (quando parar na PoC).
- Se positivo, as issues derivadas (#230/#231) já existem.

### #230 — seam `AIProvider` (Anthropic-only, ZERO-behavior-change)
- `lib/ai/providers/types.ts`: `AIProvider.runAnalysis(request) → { output, usage:{inputTokens,outputTokens}, raw }`
  + mapeamento de erro → `AiCallStatus` (rate_limited/timeout/provider_error/tool_missing/invalid_output).
- Mover o Anthropic-específico pra `lib/ai/providers/anthropic/` (client, request-builder, extração de
  tool_use, classify/serialize error). **predict.ts deixa de importar `@anthropic-ai/sdk`** (só via adapter).
- **Contrato portável = `cartridge.outputSchema`** (POR-MERCADO; NÃO existe `lib/ai/schemas/output.ts` —
  o corpo da issue está stale aí). Cada provider produz o objeto que `toolUse.input` produziria e o
  cartucho valida via Zod (`predict.ts:846`) — Zod e persistência em `ai_calls` ficam onde estão.
- `replay-prompt-eval.ts` fica **documentado como Anthropic-only** (fora do seam — é thinkingMode-específico, #203).
- Sem mudança de DB (`provider` segue `'anthropic'`).

### #231 — UM provider de prova (admin-only, A/B exit)
- Adapter em `lib/ai/providers/<provider>/` implementando `AIProvider`.
- **OpenAI: `arguments` = STRING JSON** → `JSON.parse` + erro vira `invalid_output` (NÃO crash);
  normaliza pro mesmo objeto que o cartucho valida.
- Entrada(s) no `AIModelId` union + `MODEL_REGISTRY` **COM pricing** (`userSelectable:false` inicial,
  admin-only — igual foi com Fable/Sonnet 4.5). ~14 arquivos referenciam o registry — inserir na ordem
  sem quebrar dropdowns.
- Migration do `provider`: `ALTER TYPE ai_provider ADD VALUE` **OU** enum→`text` validado-na-app (decisão
  do ADR) + **des-hardcodar os DOIS literais `provider:"anthropic"`** (`predict.ts:229` e **`:922`** —
  o segundo é fácil de esquecer). Avaliar colunas NULLABLE de token-accounting (cached/reasoning) ou deferir.
- **A/B de N jogos** documentado no PR (recomendação/edge/custo vs Anthropic) → base pra manter ou parar na PoC.

## Princípios inegociáveis

- **Fronteira do SDK**: nenhum SDK de IA fora do adapter do provider (CLAUDE.md). `predict.ts` orquestra; o adapter fala com o vendor.
- **Zod sempre** no output do LLM; **logging em `ai_calls`** preservado (a porta única segue sendo `predict.ts`).
- **Reprodutibilidade (0021)**: provider novo entra **admin-only**; o default reprodutível (Sonnet 4.5, #203) NÃO muda.
- **Plano-portão de 2 rodadas** em cada fatia (pivot arriscado).
- **Nenhum teste chama API paga** — nem Anthropic, nem o provider novo (mock/fixture; key-gated, validação ao vivo diferida se não houver chave — padrão SportMonks/#227).

## Landmines (corrigir o que está stale nas issues)

- **ADR = 0027** (0024/0025/0026 já ocupados; a "nota de numeração" da #229 diz 0024 = STALE, igual a #225 dizia 0023).
- **Os 2 literais `provider:"anthropic"`** estão em **`predict.ts:229` e `:922`** (a issue diz 190/529 = STALE). Esquecer o 2º (path de erro) = bug.
- **`calculateCost` quebra** se o modelo do provider novo NÃO entrar no `AIModelId` union + `MODEL_REGISTRY` com `pricing` (ou for forçado como string não-tipada). `costUsd` é `numeric(10,6) NOT NULL` → pricing é obrigatório junto do modelo.
- **Output contract é POR-CARTUCHO** (`cartridge.outputSchema`), não um `lib/ai/schemas/output.ts` global (não existe). O seam produz o objeto que o cartucho valida.
- **Gate model-aware (#203) é Anthropic-thinkingMode-específico** → fica FORA do seam (replay-prompt-eval Anthropic-only). Não tente portá-lo.
- **Migration renumber concorrente** ([[concurrent-storm-migration-renumber]]): `db:generate` só depois de `git pull` do main; se colidir o número, re-gerar.
- **Chave do provider pode faltar** (sem OPENAI_API_KEY): key-gate + admin-only + validação ao vivo diferida (padrão SportMonks/#227); A/B só roda com chave (documentar como diferido se não houver).

## Critério de saída da wave

- **#229**: ADR 0027 aceito (recomendação fundamentada + interface + enum-vs-text + provider de prova + reconciliação com 0008/0013/0021 + critério A/B). Pode ser **negativo** (parar) — válido.
- **#230**: seam extraído, predict.ts sem `@anthropic-ai/sdk` direto, **zero diff de output/custo** em jogos de regressão; typecheck/lint/test/build verdes; preview Vercel sobe.
- **#231**: provider de prova end-to-end via predict.ts logando em `ai_calls` (provider+custo corretos), output pelo MESMO `cartridge.outputSchema`, admin-only sem quebrar dropdowns, migration via `db:migrate`, A/B documentado. (Se o ADR mandou parar na PoC, #231 pode fechar como "PoC suficiente / não graduar".)
- **Depois disso: só o #246** (polish visual, `/impeccable`, por último de propósito — [[separate-functional-from-visual-polish]]).

## Gotchas de ambiente

- Worktree: `pnpm install --ignore-workspace` ([[pnpm-worktree-ignore-workspace]]); `pnpm-workspace.yaml` é stub gitignored.
- `pnpm test` pode flakar pglite em 8-core ([[pglite-suite-high-core-flake]]) → re-rodar `--no-file-parallelism`.
- CI = typecheck+lint+test (triê local); Vercel preview pode ficar red por branch Neon stale; **prod deploy é o gate real de migration** ([[pr-verification-no-test-ci]]).
- **"Fecha #N" PT-BR NÃO auto-fecha** no merge → fechar manual ([[github-fecha-not-autoclose]]).
- **`gh` tem rate limit** (5000/h compartilhado) — se estourar, `gh api rate_limit` e esperar o reset; não pollar em loop.
