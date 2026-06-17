# PLAN-203 — Estratégia de modelo do ADR 0021 (Sonnet 4.5 default + gate model-aware)

> Plano de implementação da issue **#203** (label `ai`), follow-up do **ADR 0021**.
> Snapshot de um ponto no tempo (2026-06-17), aterrado no código real pós #240/#241/#290.

## 0. Reconciliação com o corpo (parcialmente STALE) da #203

O corpo da #203 é anterior a **#240/#241** (remoção do Fable 5 + promoção do Sonnet 4.5).
Estado **real** de `lib/ai/models.ts` hoje:

- Registry = `{opus-4-8, sonnet-4-6, sonnet-4-5-20250929, haiku-4-5}` — **Fable já removido**.
- **Sonnet 4.5 já é `userSelectable: true`** (linha 66) — feito no #240.
- **Nenhum** modelo é admin-only (`userSelectable: false`) hoje.
- `DEFAULT_MODEL_ID` ainda = `claude-opus-4-8` (linha 80).
- A row `ai_config.id=1` ainda tem `default_model_id = 'claude-opus-4-8'` (seed da 0004).
- O gate `scripts/replay-prompt-eval.ts` **não** é model-aware.

⟹ **Item 1b da issue ("flipar Sonnet 4.5 pra userSelectable; só Fable admin-only") já está
FEITO/obsoleto.** O frasing "só o Fable 5 continua admin-only" é stale — Fable não existe e
**zero** modelos são admin-only. Trabalho real remanescente: **1a** (flip do `DEFAULT_MODEL_ID`),
**2** (default persistido em `ai_config`), **3** (gate model-aware).

## 1. Parte 1 — `DEFAULT_MODEL_ID` → Sonnet 4.5 (code-only)

- `lib/ai/models.ts:80`: `"claude-opus-4-8"` → `"claude-sonnet-4-5-20250929"`; atualizar o
  comentário da linha 79 ("Opus 4.8" → "Sonnet 4.5").
- **Segurança (ADR 0013):** o default global vale pra todos → tem que ser `userSelectable`.
  Sonnet 4.5 é `userSelectable: true` ✓. É o **fallback terminal** da cascata em
  `predict.ts:283-291` (override > preferência audience-gated > `getDefaultModelId()` >
  `DEFAULT_MODEL_ID`). Sem mudança de shape do registry (Opus permanece como override).
- **Sem quebra de teste existente:** `ai-config.test.ts` compara contra o **constante importado**
  `DEFAULT_MODEL_ID` (adapta sozinho); `models.test.ts` não assere o valor do `DEFAULT_MODEL_ID`;
  os `predict.test.ts` fixam o default via `getDefaultModelId.mockResolvedValue(...)` (independentes
  da constante). Opus segue no registry (cost/request-builder/override tests intactos).

## 2. Parte 2 — default global PERSISTIDO em `ai_config` (data migration)

**Decisão: DATA MIGRATION** (não "admin troca na UI"). Razão:

- O default em runtime é a **row** `ai_config.id=1` lida por `getDefaultModelId()`
  (`lib/db/queries/ai-config.ts:24-33`), **não** a constante. Mudar só o código deixa o prod stale.
- Determinístico + reproduzível em todo ambiente; o **deploy de prod é o gate de migration**
  (ao contrário de uma ação manual na UI, que ninguém garante).
- Idioma já estabelecido no repo: **0022** flipa um valor de `ai_config` com
  `UPDATE "ai_config" SET ... WHERE "id" = 1;` (a row id=1 é **garantida** pela 0004
  `INSERT ... ON CONFLICT DO NOTHING`). DB novo flui `0004 (opus) → 0032 (sonnet)`.

**Criação (data-only, sem schema diff):**
`pnpm drizzle-kit generate --custom --name=default_model_sonnet_4_5`
→ gera `db/migrations/0032_default_model_sonnet_4_5.sql` (vazio, preencher), bump no
`_journal.json` (idx=32) e `meta/0032_snapshot.json` (cópia do schema, novo id/prevId).

**SQL (preencher):**
```sql
-- Promove o Sonnet 4.5 a default global PERSISTIDO da análise (ADR 0021, #203).
-- A row id=1 é garantida pela 0004; UPDATE simples basta (modelo 0022). DML
-- idempotente (set de valor fixo) e reversível via /admin/settings (setDefaultModelId)
-- ou SET de volta pra 'claude-opus-4-8'. SEM ALTER (zero schema change).
UPDATE "ai_config" SET "default_model_id" = 'claude-sonnet-4-5-20250929' WHERE "id" = 1;
```
- **Incondicional `WHERE id=1`** (espelha 0022 + a decisão incondicional do ADR e satisfaz o
  AC#1 "default global em runtime resolve pra Sonnet 4.5" em qualquer ambiente). Alternativa
  considerada: guardar com `AND default_model_id='claude-opus-4-8'` (não-clobber de uma escolha
  admin) — **rejeitada** porque não garante o AC se a row estiver em outro modelo, e o dono é
  o único admin (a row de prod é o seed opus).
- **Landmine de renumber** ([[concurrent-storm-migration-renumber]]): hoje não há outra
  migration-PR em voo; se outra PR pegar o 0032, fazer merge main → tomar journal+snapshot deles
  → dropar o meu → `db:generate --custom` pro próximo número → re-verificar.

## 3. Parte 3 — gate model-aware em `scripts/replay-prompt-eval.ts`

**O que muda:** só a **regra de flip**. `mediana |Δconf| > 5pp` e `errors.length > 0` ficam
**intocados** (aplicados globalmente como hoje).

**Classificação de caminho (reusa o registry):**
`thinkingMode = isAIModelId(model) ? MODEL_REGISTRY[model].thinkingMode : "temperature"`
(modelo desconhecido/legado → caminho **estrito** = qualquer flip reprova; nunca tolera em silêncio).

- **Caminho temperature (Sonnet 4.5 / Haiku):** estrito — qualquer flip = reprova (inalterado).
- **Caminho adaptive (Opus / Sonnet 4.6):** um flip observado no 1º replay dispara
  **reprodução em N runs** — re-replaya **o mesmo payload** (`ADAPTIVE_FLIP_REPRO_RUNS - 1`
  vezes a mais); o flip só conta como reprovação se reproduzir na **maioria** dos N runs.
  É exatamente a metodologia A/A que o ADR cita (3 execuções manuais do #105). Custo-mínimo:
  só payloads adaptive que **já** fliparam re-rodam; estáveis e temperature não pagam extra.

**Constantes (topo do core):**
- `ADAPTIVE_FLIP_REPRO_RUNS = 3` (casa com as 3 execuções manuais do #105).
- Confirmação por **maioria**: `flippedRuns >= ceil(N/2)` (2 de 3). [Decisão de produto leve;
  default maioria; plan-review pode pedir unânime.]

**Seam de testabilidade (CRÍTICO — o script roda `main()` no import, linha 451):**
Extrair a lógica PURA pra `scripts/replay-eval-core.ts` (sem SDK/db/dotenv/`main`, só importa
`MODEL_REGISTRY`/`isAIModelId` de `@/lib/ai/models`):
- `median`, `pOver` (movidos do script), `MAX_DELTA_CONF_MEDIAN_PP`, `ADAPTIVE_FLIP_REPRO_RUNS`,
  `classifyThinkingMode(modelId)`, `isAdaptiveFlipConfirmed(flippedRuns, totalRuns)`,
  `computeVerdict({ results, errorCount, maxDeltaConfMedianPp })`.
- `computeVerdict` recebe results já anotados `{ thinkingMode, flip, flipConfirmed, deltaConf }`
  e devolve `{ failed, confirmedFlips, toleratedNoiseFlips, medianDelta }`.
  `failed = confirmedFlips > 0 || medianDelta > limite || errorCount > 0`.
- O **loop de reprodução pago** fica no `main()` do script (seta `flipConfirmed` nos adaptive).
  `deltaConf` continua sendo o do 1º replay (consistência com o caminho temperature single-shot).
- Edge: se um rerun de reprodução **erra** (replayOne lança), logar e contar como run não-completado
  (usa `completedRuns` no ratio); não derruba o gate inteiro.

**Honestidade do relatório** ([[no-silent-caps]]): o veredito distingue **flips confirmados**
(contados) de **flips tolerados** (adaptive, não reproduzidos = ruído; logados, não contados).
Atualizar o comentário-cabeçalho (linhas 1-29, esp. o "Critério de abort" 17-19) pra descrever a
regra model-aware. Somar o custo dos reruns ao total.

## 4. Testes (NENHUM chama Anthropic pago)

1. **`scripts/__tests__/replay-eval-core.test.ts`** (novo) — importa o core PURO (sem main/SDK).
   Casos: (a) flip adaptive **não** reproduzido → NÃO reprova; (b) flip adaptive reproduzido
   (≥ maioria) → reprova; (c) flip temperature single → reprova; (d) `medianDelta > 5pp` reprova
   sozinho; (e) `errorCount > 0` reprova sozinho; (f) modelo desconhecido → estrito;
   (g) `isAdaptiveFlipConfirmed` e `classifyThinkingMode` unit. Zero API/DB (dados fabricados).
2. **`lib/ai/__tests__/models.test.ts`** (add) — invariante ADR 0013/0021:
   `MODEL_REGISTRY[DEFAULT_MODEL_ID].userSelectable === true` **e** `DEFAULT_MODEL_ID ===
   "claude-sonnet-4-5-20250929"` **e** `thinkingMode === "temperature"` (default reproduzível).
   Trava a decisão e impede um futuro flip pra default admin-only/adaptive.
3. **`lib/db/queries/__tests__/ai-config.test.ts`** — já cobre "row válido (sonnet-4-5) → as-is"
   (runtime default = sonnet) e "no row → DEFAULT_MODEL_ID" (agora = sonnet, via constante). Sem
   mudança obrigatória; opcional: adicionar comentário ligando ao #203. Confirmar verde.
4. O **guard sem-paga** existente (`replay-prompt-eval-guard.test.ts`) segue válido (o script
   mantém `if (process.env.CI) throw` e não é referenciado por vitest/`package.json test`).
   O core puro é importável e seguro (não tem `main`).

## 5. Entrega

- **Um PR** fechando #203 (3 partes coesas sob um ADR; pequenas). Branch a partir de `main`.
- Verificação local: `pnpm typecheck && pnpm lint && pnpm test` (triê local; cuidado com flake
  do pglite em 8-core — [[pglite-suite-high-core-flake]] — revalidar com `--no-file-parallelism`
  se flakar). Migration aplica de verdade só no deploy de prod (gate real).
- Code review (workflow adversarial) → corrigir ressalvas que agregam valor → merge verde →
  fechar #203 (lembrar: "Fecha #N" PT-BR **não** auto-fecha — fechar manual [[github-fecha-not-autoclose]]).

## 6. Resoluções do plan-review (decisões TRAVADAS)

Painel adversarial de 4 lentes (adr-spec, gate-design, migration, conventions). Resoluções:

- **Migration incondicional `WHERE id=1`** (3/4 lentes). Adiciona comentário do trade-off:
  a row id=1 é garantida pela 0004; o UPDATE sobrescreve qualquer valor anterior **de propósito**
  pra impor a decisão do ADR de forma determinística (AC#1 em qualquer ambiente); reversível via
  /admin/settings. (Lente `conventions` pediu guardado por `AND default_model_id='claude-opus-4-8'`;
  **rejeitado** — quebra o idioma da 0022 e não garante o AC em row não-opus; o dono é o único admin
  e a row de prod é o seed opus.)
- **Sem down-migration.** O repo é forward-only (nenhum `.down.sql`); reversão é operacional
  (setDefaultModelId/UI ou SQL manual). NÃO criar arquivo de rollback (fora do padrão).
- **FALSO POSITIVO rejeitado:** "setGenerationParams clobbera default_model_id". Verificado
  (`ai-config.ts:177+`): o `onConflictDoUpdate.set` **não** seta `defaultModelId`; o `.values()`
  (linha 171) só semeia em row AUSENTE (nunca em prod pós-0004) e agora semeia o sonnet correto.
  Único writer de `ai_config` é `ai-config.ts`; flags enable_* são flipadas por migration, não por
  setter TS. **Nenhuma mudança** em setGenerationParams. (Não "consertar".)
- **`computeVerdict` — assinatura TRAVADA** (resolve o "test interface" blocker):
  ```ts
  // scripts/replay-eval-core.ts (PURO: sem SDK/db/dotenv/main; só importa MODEL_REGISTRY/isAIModelId)
  export type ThinkingPath = "adaptive" | "temperature";
  export type VerdictRow = { thinkingMode: ThinkingPath; flip: boolean; flipConfirmed: boolean; deltaConf: number };
  export function computeVerdict(args: { results: VerdictRow[]; errorCount: number; maxDeltaConfMedianPp?: number }):
    { failed: boolean; confirmedFlips: number; toleratedNoiseFlips: number; medianDelta: number };
  // failed = confirmedFlips>0 || medianDelta>limite || errorCount>0
  // confirmedFlips     = results.filter(r => r.flipConfirmed).length  (temperature: flipConfirmed===flip)
  // toleratedNoiseFlips= results.filter(r => r.thinkingMode==="adaptive" && r.flip && !r.flipConfirmed).length
  ```
  O `main()` (pago) preenche `flipConfirmed` rodando o loop de reprodução; o teste fabrica
  `VerdictRow[]` literais (zero API/DB). O loop de reprodução em `main()` **não** é unit-testado
  (é pago) — validação manual via `pnpm tsx scripts/replay-prompt-eval.ts`; o guard `process.env.CI`
  segue a rede de segurança.
- **Semântica de erro no rerun TRAVADA:** `isAdaptiveFlipConfirmed(flippedRuns, n)` confirma sse
  `flippedRuns >= Math.ceil(n / 2)` contra o **N fixo** (`ADAPTIVE_FLIP_REPRO_RUNS`). Um rerun que
  ERRA (replayOne lança) é logado e conta como **não-flip** (não incrementa `flippedRuns`); **não**
  entra em `errors[]` (o 1º replay já sucedeu — o payload foi avaliado). Conservador: erro empurra
  pra TOLERAR (evita reprovar o gate por ruído/API flaky, alinhado ao ADR). `ADAPTIVE_FLIP_REPRO_RUNS`
  deve ficar **≥ 3** pra a maioria `ceil(N/2)` ser significativa (com N=2, ceil=1 = flip único confirma).
- **Modelo desconhecido/legado → estrito + LOG** (resolve o blocker `gate-design`): `classifyThinkingMode`
  devolve `"temperature"` (= qualquer flip reprova) pra id fora do registry, e o script **loga** um aviso
  (reusa/espelha o warn de custo já existente em `replay-prompt-eval.ts:334-338`) — nunca tolera em
  silêncio. Comentar a premissa: baselines de modelos removidos (ex.: Fable) seriam avaliados estrito;
  conservador e aceitável (não há modelo adaptive removido com payload relevante hoje).
- **deltaConf** reportado é o do 1º replay (consistência com o single-shot temperature); pra flips
  adaptive confirmados pode sub-representar o sinal dos reruns — a contagem `confirmedFlips` é a
  autoridade. Custo/tokens do result row = **soma** de todas as tentativas (1 row por payload original,
  paridade com temperature). Notar no relatório/cabeçalho.
- **Hipótese do N-run (rationale afiado):** mede **estabilidade do flip sob re-amostragem do prompt
  CANDIDATO** — todo replay (run 1 e reruns) aplica o prompt novo vs a baseline (prompt antigo). Flip
  consistente = o prompt novo de fato moveu a recomendação (regressão real); flip esporádico = ruído de
  amostragem adaptive (o modo de falha A/A do #105). Não é causalidade de prompt isolada, é
  reprodutibilidade — exatamente o que o ADR pede.
- **Teste invariante (models.test.ts) — explícito + SENTINEL:** novo describe assere
  `DEFAULT_MODEL_ID === "claude-sonnet-4-5-20250929"`, `!== "claude-opus-4-8"`,
  `MODEL_REGISTRY[DEFAULT_MODEL_ID].userSelectable === true`,
  `MODEL_REGISTRY[DEFAULT_MODEL_ID].thinkingMode === "temperature"`. Comentário sentinel: mudar o default
  exige atualizar este teste + ADR 0021/PLAN-203.
- **Migration: 2 passos.** `pnpm drizzle-kit generate --custom --name=default_model_sonnet_4_5` gera
  `.sql` VAZIO → **editar e escrever o UPDATE** antes de commitar (não commitar vazio). Rodar `generate`
  só depois de `git pull` do main (janela mínima de colisão de número).
- **Commit:** tipo `feat` — `feat(ai): estratégia de modelo do ADR 0021 (Sonnet 4.5 default + gate model-aware) — #203`. **Um PR** fechando #203.
- **Verificação:** se a suíte flakar no 1º run, re-rodar `pnpm test --no-file-parallelism` (flake pglite
  em 8-core [[pglite-suite-high-core-flake]]); se verde, seguir.
- `scripts/__tests__/*.test.ts` **é** coletado pelo vitest (2 guard tests já provam); `.claude/**` excluído
  evita dupes de worktree. Sem mudança no vitest.config.

## Critérios de aceitação (espelham a #203)

- [ ] Default global em runtime resolve pra Sonnet 4.5 (registry `DEFAULT_MODEL_ID` + row `ai_config`).
- [ ] Sonnet 4.5 `userSelectable: true` (já); invariante ADR 0013 preservado; nenhum default admin-only.
- [ ] Cascata de 4 níveis intacta.
- [ ] Gate distingue adaptive (N runs) de temperature (estrito); median-Δ e errors intocados.
- [ ] Testes verdes; nenhum teste chama o Anthropic pago.
