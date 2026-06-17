# PLAN-226 — Proveniência de desfalques (source/confidence) + per-side, ponta-a-ponta

> Implementação da issue **#226** (`ai, feature, pos-pivot`), gated pelo **ADR 0026** (#225).
> Pivot arriscado → **plano-portão de 2 rodadas** ([[two-round-plan-gate-for-pivot]]).
> Snapshot 2026-06-17, aterrado no código real (refs da issue defasados por PRs #245/#288/#290).

## 0. Grounding de escopo (achados que mudam o plano)

- **Absences model DUPLICADO em 6 cartuchos**: `over_under`, `match_result`, `btts`,
  `double_chance`, `correct_score`, `_scorer_shared` — cada um com seu `PlayerAbsenceSchema`
  (schemas.ts) + `buildAbsences` (build-input.ts) + `absences_available`/`absences` (input
  schema) + branch `if (!team.absences_available)` (user-message.ts).
- **over_under tem DOIS variantes registrados**: `over_under_v2.0` (`index.ts`/`prompt.ts`/
  `user-message.ts`, featured 2.5, **default em prod**) e `over_under_v3.0` (`index-v3.ts`/
  `prompt-v3.ts`/`user-message-v3.ts`, multi-linha, atrás da flag `enableOverUnderExtraLines`).
  **Compartilham** `schemas.ts` + `build-input.ts`; prompts/user-messages/versões separados.
- **`NormalizedInjury`** (`types.ts:147`) é referenciado em ~13 arquivos → campos novos
  **DEVEM ser opcionais** (additive expand; "sem quebrar o caminho atual").
- **Single source hoje** (API-Football; football-data.org `supportsInjuries:false`): a
  disponibilidade per-side é SEMPRE igual hoje → o per-side é **seam pra #227**, não muda
  comportamento agora. `predict.ts:345-371` busca injuries como `{ data:{home,away},
  unavailable }` com UM flag; `absencesAvailable = !injuries.unavailable` (`:371`).
- `buildAbsences` (`over_under/build-input.ts:116-128`) dropa `reason` e hardcoda
  `role:"MID"` (posição não vem confiável do /injuries) — **risco da issue: NÃO regredir**.

## 1. Camada COMPARTILHADA (uma vez; beneficia o DADO de todos os cartuchos)

1. **`NormalizedInjurySchema`** (`types.ts:147`): adicionar **opcionais** (additive):
   - `source: z.enum(["official", "unofficial"]).optional()`
   - `confidence: z.number().min(0).max(100).optional()` (seam; não populado hoje = plena)
   - `capturedAt: z.string().datetime().optional()` (seam; não populado hoje)
   Opcionais ⟹ os ~13 consumidores/construtores (fallback, view/sections, build-inputs dos
   outros 5 cartuchos, football-data-org) **não quebram**.
2. **api-football adapter** (normalização de injuries, ~`adapter.ts:998-1088`): setar
   `source: "official"` em cada `NormalizedInjury`. `confidence`/`capturedAt` ficam unset.
3. **`predict.ts`** (`:371` + commonInputArgs `:668/673`): tornar `absencesAvailable`
   **per-side**. Computar `absencesAvailableHome`/`Away` (ambos `= !injuries.unavailable`
   HOJE — comentar que divergem quando um provider per-team/multi-source aterrissar no #227)
   e passar cada lado ao seu `TeamData`. Comportamento idêntico ao atual (ambos iguais) — seam.

## 2. Camada over_under (AMBOS v2 + v3 — escopo do prompt da issue)

4. **`schemas.ts` `PlayerAbsenceSchema:52`**: adicionar `source` (enum official/unofficial,
   **opcional**) — afeta v2 E v3 (schema compartilhado). `confidence` opcional idem (seam).
5. **`build-input.ts` `buildAbsences:116`**: mapear `source: inj.source` (e confidence se
   incluído). **Manter `role:"MID"` e o drop de `reason`** (não regredir — risco da issue).
6. **`user-message.ts:81` + `user-message-v3.ts`**: renderizar source na linha de absence:
   `- ${a.player} (${a.role}, ${a.status}${a.source ? `, fonte: ${a.source}` : ""})`. Isso
   muda os bytes do prompt → **força o bump de versão** (independente da regra nova).
7. **`prompt.ts` + `prompt-v3.ts`**: adicionar regra curta — ponderar confiança por `source`
   (oficial > não-oficial) **mantendo** "sem dados (`absences_available=false`) ≠ elenco
   saudável" (preservar a distinção do ADR 0006, já presente no prompt).
8. **Bump de versão** (commit `prompt:`): `OVER_UNDER_VERSION` v2.0→**v2.1** (`index.ts:23`)
   + `OVER_UNDER_V3_VERSION` v3.0→**v3.1** (`index-v3.ts:24`). Registrar no commit (ADR 0021:
   reprodutibilidade).

## 3. Outros 5 cartuchos — NÃO tocados

`match_result`/`btts`/`double_chance`/`correct_score`/`_scorer_shared`: seus
`PlayerAbsenceSchema`/`buildAbsences`/prompt ficam **sem source** (additive — o `inj.source`
do dado é simplesmente não-mapeado lá). Beneficiam-se do per-side (shared) e do source no
DADO, mas não surfacam no prompt. Fast-follow possível; **fora do #226** (issue escopou
"cartucho over_under"). [Plan-review: confirmar que essa inconsistência é aceitável.]

## 4. Eval do bump (gate)

O bump de `PROMPT_VERSION` dispara o **replay-prompt-eval** (PAGO, dev-only, CI-guardado —
não rodável em CI/teste). O **dono roda manualmente** antes de confiar no novo prompt. A AC
pede bump + commit `prompt:`, **não** rodar o gate. (O gate é model-aware pós #203.)

## 5. Testes (NENHUM chama Anthropic pago)

- `types.ts`: `NormalizedInjury` parseia com/sem `source`; default-less (opcional) ok.
- api-football adapter: injuries normalizadas carregam `source:"official"` (mock de fetch).
- `buildAbsences`: mapeia `source`; **mantém `role:"MID"`**, não regride (sem source → undefined).
- per-side: `predict.ts` passa `absencesAvailable` per-side (test do build/commonInputArgs).
- over_under: input schema aceita `source`; `user-message` v2 **e** v3 renderizam "fonte:".
- Não-regressão dos 5 outros cartuchos: inputs/snapshots inalterados (sem source).

## 6. Riscos / atenção do plano-portão

- **Dual bump v2+v3** — não esquecer um (e dois user-messages + dois prompts).
- **Additive optional** em `NormalizedInjury` pra não quebrar ~13 referências.
- **Não regredir** `role:"MID"`/drop de `reason` no `buildAbsences`.
- **Reprodutibilidade** (ADR 0021): bump de versão → registrar no commit; eval manual.
- **Premature?** O prompt-rule de ponderar source é inerte hoje (tudo official/single-source);
  surfacar `source` no input já força o bump. [Plan-review: bump agora (seam) vs adiar a
  regra pro #227? Recomendação default: agora, é o que a AC pede e o seam fica completo.]
- **Per-side inerte hoje** (ambos iguais, single source) — seam pro #227; documentar.

## 8. Resoluções da Rodada 1 do plano-portão (rework — supersede onde conflitar)

Painel de 4 lentes (a lente `scope` retornou output degenerado/placeholder — descartada; as
outras 3 + minha verificação direta resolvem). Blockers endereçados:

- **[AC c] Per-side é predict.ts-ONLY (não cascateia pros 6 cartuchos).** Verificado:
  `commonInputArgs` (`predict.ts:655-677`) e `BuildPredictionInputArgs` (`build-input.ts:176-185`)
  JÁ têm `home.absencesAvailable` e `away.absencesAvailable` como campos **separados por lado**;
  hoje `predict.ts:668/673` atribuem a MESMA var `absencesAvailable` aos dois. Mudança concreta
  (estrutural, comportamento idêntico hoje):
  ```ts
  // predict.ts — substitui `const absencesAvailable = !injuries.unavailable;`
  // Per-side seam (#226): hoje uma fonte só (API-Football é per-liga) → ambos iguais;
  // divergem quando um provider per-team/multi-source aterrissar (#227).
  const absencesAvailableHome = !injuries.unavailable;
  const absencesAvailableAway = !injuries.unavailable;
  // ...home: { ..., absencesAvailable: absencesAvailableHome }
  // ...away: { ..., absencesAvailable: absencesAvailableAway }
  ```
  **Zero mudança** nos 6 cartuchos (já leem o campo per-lado). A lente errou ao dizer "atualizar
  os 6 BuildPredictionInputArgs".
- **[AC a] Os TRÊS campos opcionais em AMBOS os schemas** (ADR 0026 D5 pediu): `NormalizedInjurySchema`
  (`types.ts:147`) E `PlayerAbsenceSchema` (`over_under/schemas.ts:52`) recebem
  `source: z.enum(["official","unofficial"]).optional()`, `confidence: z.number().min(0).max(100).optional()`,
  `capturedAt: z.string().datetime().optional()`. Hoje só `source` é populado (api-football='official');
  `confidence`/`capturedAt` são **seam não-populado** pro #227. (Estado hoje de NormalizedInjury:
  `{player,type,reason,status}` — os 3 são novos.)
- **[blocker additive-safety] `buildAbsences` com spread condicional** (sem `source: undefined`
  poluindo o payload). Mantém `role:"MID"` + drop de `reason` (não regride):
  ```ts
  return injuries.map((inj) => ({
    player: inj.player.name,
    role: "MID" as const,
    status: mapAbsenceStatus(inj),
    ...(inj.source ? { source: inj.source } : {}),
    // confidence/capturedAt: idem quando #227 popular (spread condicional)
  }));
  ```
- **[AC d] Texto VERBATIM do prompt** (estende a regra existente — `prompt.ts:16` rule 8 /
  `prompt-v3.ts:21` rule 9 — preservando o ADR 0006). Adicionar ao FIM da regra de desfalques,
  em AMBOS os prompts:
  > "Quando um desfalque trouxer uma `fonte`: `official` = dado estruturado confiável (peso normal
  > na leitura); `unofficial` = fonte não-oficial/fallback, trate com cautela (menor peso; não deixe
  > um desfalque não-oficial sozinho dominar a recomendação). Sem `fonte` indicada, assuma confiável.
  > Isso **não** altera a regra acima: 'dados indisponíveis' continua significando dado faltante
  > (reduz confiança), NUNCA elenco saudável."

  Hoje (fonte única official) a regra é **inerte** numericamente; surfacar `source` no user-message
  já muda os bytes do prompt → o bump é inevitável. **Decisão: bumpar agora** (a AC do #226 exige
  explicitamente "PROMPT_VERSION bumpado + prompt pondera confiança"); o seam fica completo pro #227
  sem novo bump. (A lente `correctness` sugeriu adiar pro #227 — rejeitado: contraria a AC explícita.)
- **[AC e] Mock strategy dos testes** (nenhum chama Anthropic pago):
  - `lib/providers/sports-data/__tests__/...` (adapter api-football): testa a normalização de injuries
    → `source:"official"` com **fetch mockado** (idiom existente do adapter; sem SDK Anthropic).
  - `lib/ai/markets/over_under/__tests__/build-input*.test.ts`: `buildAbsences` puro (sem mock) — mapeia
    source, mantém role:"MID", e **sem source → sem campo** (spread condicional).
  - `lib/providers/sports-data/__tests__/types`/schema: `NormalizedInjury` parseia COM e SEM os 3 opcionais.
  - `lib/ai/markets/over_under/__tests__/user-message*.test.ts`: v2 **e** v3 renderizam "fonte:" quando há source.
  - `lib/ai/__tests__/predict*.test.ts`: já usam `vi.mock("@/lib/ai/anthropic")` + `vi.mock("@/lib/db")`
    (predict nunca chama o SDK real) — só estendo/reuso pra cobrir o per-side. **Nenhum** teste novo
    importa o SDK Anthropic.
  - **Dual-bump test**: assert `OVER_UNDER_VERSION==="over_under_v2.1"` e `OVER_UNDER_V3_VERSION==="over_under_v3.1"`
    (trava os DOIS bumps; pega o esquecimento de um).
  - Não-regressão dos 5 outros cartuchos: seus inputs/snapshots inalterados (não mapeiam source).
- **buildAbsences é COMPARTILHADO** (uma impl, `build-input.ts:116`), chamado por `buildPredictionInput`
  (v2, :272/291) E `buildPredictionInputV3` (v3, :405/424) → a mudança cobre os dois variantes.

## 7. Critérios de aceite (espelham #226)

- [ ] `NormalizedInjury` e `PlayerAbsenceSchema` carregam `source` (+ confidence/capturedAt opcionais).
- [ ] API-Football marca `source:"official"`; `buildAbsences` propaga.
- [ ] `absences_available` per-side (home/away independentes estruturalmente).
- [ ] `PROMPT_VERSION` bumpado (v2+v3) + commit `prompt:`; prompt pondera confiança e mantém "sem dados ≠ elenco saudável".
- [ ] `pnpm typecheck && pnpm lint && pnpm test` verdes.
