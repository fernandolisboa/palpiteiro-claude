# PLAN-354 — Tipos de palpite settleable goal-derived (margem, clean sheet, 1º a marcar, placar 1º tempo)

> Snapshot de um ponto no tempo (ver `docs/plans/README` / convenção CLAUDE.md). Plano de implementação pré-issue do **#354**. Depende de #314 (plumbing de settlement de palpite, já em prod) e ADR 0030 / #349 (palpite-first). Todas as referências `file:line` foram verificadas contra o código real em `main` (commit base `adcd5c35`).

---

## 1. Objetivo & escopo

Adicionar **quatro** tipos de palpite **liquidáveis** (`settleable: true`, badge acertou/errou) que **não exigem provider novo**, espelhando o caminho do `exact_score` existente. **TODOS OS QUATRO num único PR** (decisão do dono).

1. **`margin`** — "ganha por N+" (margem de vitória). Valor predito **DERIVADO** do `probableScore {home,away}` da síntese (sem campo de LLM novo). Liquida só do `regulationScore` (90').
2. **`clean_sheet`** — um lado não sofre gol. **DERIVADO** do `probableScore`. Liquida só do `regulationScore`.
3. **`first_half_score`** — placar do 1º tempo. **NÃO derivável** → o cartucho de síntese passa a EMITIR um placar de intervalo previsto (`palpites_v2` → `palpites_v3`). Liquida do `halftimeScore` (o adapter HOJE descarta `f.score.halftime` — precisa passar pra frente).
4. **`first_to_score`** — quem marca primeiro. **NÃO derivável** → a síntese EMITE um "primeiro a marcar" previsto. Liquida de EVENTOS de gol (o cron de palpite hoje busca SÓ o placar — precisa adicionar um fetch de eventos, gated em `eventsAvailable`, cross-provider-safe).

**Critério de saída (da issue):** regras testadas; settlement idempotente; "prefer skip over silent wrong settle" honrado (dado faltando/ambíguo → fica PENDING, nunca fabrica resultado errado). Evitar tipos que dupliquem a seção de mercados de valor (BTTS/over/1X2/DC) — ver §2.7.

**Fora de escopo:** polish visual pesado (vem depois com `/impeccable`); novos mercados de valor; qualquer número de valor (edge/EV/stake/odd/%) na manchete (firewall ADR 0030 §3, inviolável); A/B; backfill de palpites antigos (sets pré-v3 não terão as linhas novas — aceitável, são imutáveis).

---

## 2. Decisões de design (RESOLVIDAS)

### 2.1 Fonte única da verdade do gate
Hoje há **gate duplo** que pode driftar: `deriveSettleable` (`lib/ai/palpites/settleable.ts:11`) e o predicado SQL `eq(palpites.type,"exact_score")` (`lib/db/queries/palpites.ts:166`). Introduzir **uma** constante readonly que dirige AMBOS:

```ts
// lib/ai/palpites/settleable.ts
export const SETTLEABLE_PALPITE_TYPES = [
  "exact_score",
  "margin",
  "clean_sheet",
  "first_half_score",
  "first_to_score",
] as const satisfies readonly PalpiteType[];

const SETTLEABLE_SET: ReadonlySet<PalpiteType> = new Set(SETTLEABLE_PALPITE_TYPES);

export function deriveSettleable(type: PalpiteType): boolean {
  return SETTLEABLE_SET.has(type);
}
```

A query de pending passa de `eq(palpites.type,"exact_score")` para `inArray(palpites.type, SETTLEABLE_PALPITE_TYPES)`. `red_card`/`corners` ficam **de fora** da tupla → continuam `settleable=false`, nunca entram no cron (gate Tier-3 de pé, ADR 0028). O `satisfies readonly PalpiteType[]` garante em compile-time que a tupla só contém valores válidos do enum.

### 2.2 Row-per-type na geração
Cada dimensão settleable é a **própria linha `palpites`** (com `type` + `params` próprios), NÃO derivada-no-read. Mantém a idempotência limpa (uma row `palpiteOutcomes` por row `palpites`, UNIQUE em `palpiteId`, `db/schema.ts:490`) e espelha o modelo `exact_score` existente. A geração (`lib/ai/palpites/index.ts:356`) passa a emitir **N linhas** de uma síntese (hoje 1; novo: até 5 — exact_score + as 4). Insert em batch único.

### 2.3 Dispatch por tipo
A chamada incondicional `settleExactScorePalpite(p.params, resultData)` (`settle-palpites.ts:108`) vira um dispatch por `p.type`:

```ts
// lib/settlement/rules/palpite-dispatch.ts (NOVO)
type PalpiteRuleFn = (params: unknown, resultData: PalpiteSettlementResultData) => "won" | "lost";

export const PALPITE_SETTLEMENT_RULES: Record<SettleablePalpiteType, PalpiteRuleFn> = {
  exact_score: settleExactScorePalpite,
  margin: settleMarginPalpite,
  clean_sheet: settleCleanSheetPalpite,
  first_half_score: settleFirstHalfScorePalpite,
  first_to_score: settleFirstToScorePalpite,
};
```

Cada regra `(params, resultData) -> "won"|"lost"`, lança `SettlementError` em dado faltando/ambíguo (prefer-skip → bucketa em `errors`, fica PENDING). **NÃO** registrar nada em `lib/settlement/registry.ts` (esse é o registry de VALOR — palpite tem caminho próprio, ADR 0028; confirmado: `registry.ts` não é importado por palpite). `SettleablePalpiteType` = `(typeof SETTLEABLE_PALPITE_TYPES)[number]`.

### 2.4 Síntese v3 — campos novos + decisão de refine
Bump `palpites_v2` → **`palpites_v3`** (`PALPITES_VERSION`, `cartridge.ts:22`; commit `prompt:`). Adicionar ao `PalpitesOutputSchema.strict()` (`cartridge.ts:51`) e ao `SUBMIT_PALPITE_TOOL.input_schema` (`cartridge.ts:160`):

- **`firstHalfScore: { home, away }`** (inteiros 0–20, mesmo schema do `probableScore`).
- **`firstToScore: "home" | "away" | "none"`** — enum de 3 valores. `"none"` = previsão de **0-0 no jogo inteiro** (ninguém marca). **Escolha do enum justificada:** `"home"/"away"` mapeiam direto pro `teamSide` dos eventos de gol (`NormalizedGoalEvent.teamSide`, `types.ts:71`), zero tradução de nome de time (robusto a variações de string). `"none"` cobre o palpite de jogo sem gols e dá um caso de settle limpo (won sse 0 gols de regulação).

**Decisão de refine — NÃO adicionar cross-field refines no schema da síntese.** Razão: a síntese roda em try/catch e um `.refine()` que falha **degrada o palpite INTEIRO a null** (`index.ts` captura → `palpite:null`, perdendo TAMBÉM verdict/narrative/probableScore que estavam OK). A **correção de settlement** (acertou/errou) é decidida 100% pelo fato do jogo, nunca pela coerência interna da previsão — então, **do ponto de vista da CORREÇÃO de settlement**, uma previsão incoerente apenas erra mais badges, não corrompe nada (este é o sentido — e o ÚNICO sentido — de "subótimo, não bug de correção"). A coerência ainda é guiada por **prompt** ("o placar do 1º tempo deve ser ≤ o placar provável final em cada lado; o 'primeiro a marcar' deve ser coerente com quem você acha que ganha"). O `.strict()` (firewall de valor) **fica**; só não adicionamos refines de coerência.

**Coerência de PRODUTO (HERO) ≠ correção de settlement.** O raciocínio "subótimo, não bug" acima cobre SÓ a correção de settlement. A coerência de PRODUTO — o HERO nunca mostrar um chip autocontraditório (ex.: "1º tempo 3–0" sob "provável 1–0", ou "primeiro a marcar" do visitante sob um veredito de mandante) — é resolvida no **boundary de EMISSÃO** (§3.13), NÃO por refine: o build do scorecard só EMITE a row da dimensão quando ela é coerente com `probableScore`; senão pula (uma dimensão a menos, igual ao skip de margin/clean_sheet). Ver §3.13 para os gates exatos.

`probableScore` continua `min(0).max(20)`; `firstHalfScore` idem. O bump de versão é registrado em `palpites_v3` e o `promptVersion` persistido reflete (já flui via `cartridge.version`, `index.ts:333` área).

### 2.5 Halftime via fetch único
`first_half_score` NÃO precisa de chamada extra ao provider: o `getFixtureResult` já busca o fixture; basta **passar `halftimeScore` adiante** em `NormalizedFixtureResult` (`types.ts:48`) e na forma de resultData de palpite. `f.score.halftime` já é parseado em `schemas.ts:88` (`{home:number|null, away:number|null}`), só é descartado no `toNormalizedFixtureResult` (`adapter.ts:499`). Halftime null (split de intervalo indisponível) → a regra lança → skip → PENDING.

### 2.6 Fetch de eventos no cron de palpite
Só `first_to_score` precisa de eventos. Adicionar ao `settle-palpites.ts` um loop de fetch de eventos espelhando o do caminho de valor (`settle.ts:127-158`): só busca `getFixtureEvents` pros matches que têm ≥1 row pendente de tipo `first_to_score` (data-driven via um set de tipos event-backed). `SportsDataUnsupportedError` (football-data-org, `adapter.ts:644`) → o match não recebe eventos → a regra lança (`eventsAvailable !== true`) → skip → PENDING, **nunca** erro do match inteiro nem LOST. (Mirror exato do guard de `scorer.ts:28`.)

### 2.7 Não-duplicação com a seção de mercados de valor (uma frase por tipo)
- **`margin`** ("ganha por N+"): a seção 1X2 diz QUEM ganha (home/draw/away); margem é POR QUANTO — eixo ortogonal. **Não-duplicação HOLDS (não é mais borderline): com o floor `minMargin >= 2` (§3.13), a row de margin só é emitida quando `|home-away| >= 2`, então NUNCA colapsa pra a seleção 1X2-home/away** ("ganha por 2+" ≠ "ganha"). Previsões de vitória por 1 (1–0, 2–1) simplesmente pulam a row — consistente com a emissão condicional.
- **`clean_sheet`** (um lado não sofre gol): BTTS-No = "pelo menos um lado não marca"; clean_sheet é sobre um lado ESPECÍFICO não SOFRER — proposições diferentes (BTTS-No é satisfeito por 2-0 OU 0-2; clean_sheet do mandante só por X-0). Não restitui BTTS.
- **`first_half_score`** (placar do 1º tempo): nenhum mercado de valor liquida sobre o intervalo — over/1X2/BTTS são todos de 90'. Zero sobreposição.
- **`first_to_score`** (quem marca 1º): nenhum mercado de valor é sobre ordem temporal de gols. Zero sobreposição.

Os quatro foram escolhidos exatamente porque a manchete não vira redundante com o detalhe.

---

## 3. Mudanças por arquivo (sequência implementável)

> Ordem: gate const + enum + migration → resultData/adapter (halftime) → regras + dispatch → events fetch no cron → síntese v3 + geração → pending query → UI → testes.

### 3.1 `lib/ai/palpites/settleable.ts` — fonte única do gate
- Adicionar `SETTLEABLE_PALPITE_TYPES` (tupla readonly, §2.1) e `SettleablePalpiteType`.
- Reescrever `deriveSettleable` pra usar o `Set` derivado da tupla.
- Exportar ambos. (Hoje exporta só `PalpiteType` + `deriveSettleable`.)

### 3.2 `db/schema.ts` — enum + tipo de params + halftime no PalpiteResultData
- `palpiteTypeEnum` (linha 69): adicionar os 4 valores. Resultado:
  ```ts
  pgEnum("palpite_type", ["exact_score","red_card","corners","margin","clean_sheet","first_half_score","first_to_score"])
  ```
  (Acrescentar **ao final** — ordem do enum é só cosmética, mas append evita ruído no snapshot.)
- `palpites.params` (linha 456): widening do `$type`. **Decisão: union discriminada-por-tipo-implícito via shape unificado opcional**, parseado por Zod per-rule (mirror do `exact_score_palpite.ts:9`). Como o jsonb é genérico e cada regra já re-valida com Zod, o `$type` só precisa ser largo o bastante pra os call-sites de escrita:
  ```ts
  params: jsonb().$type<
    | { home: number; away: number }                 // exact_score, first_half_score
    | { side: "home" | "away"; minMargin: number }   // margin
    | { side: "home" | "away" }                      // clean_sheet
    | { firstToScore: "home" | "away" | "none" }     // first_to_score
  >(),
  ```
  A leitura no settlement NÃO confia no `$type` — cada regra faz `safeParse` do seu próprio schema (defense-in-depth, igual exact_score). A geração escreve o shape certo por tipo.
  - **[BLOCKER] Widening do `$type` quebra as DUAS leituras existentes de `exact_score`.** `palpites.params` e `palpites.type` são campos INDEPENDENTES de `DbPalpite` — não há union discriminada ligando-os. Logo `find(p => p.type === "exact_score")` **NÃO estreita** o membro do jsonb: `scoreLine.params` permanece a union completa (`{home;away} | {side;minMargin} | {side} | {firstToScore}`), que **NÃO é atribuível** a `{home:number;away:number}`. As duas leituras (`lib/view/palpites-headline.ts` `toPalpiteHeadlineViewFromSet` e `app/actions/predictions.ts` fresh-view) que hoje passam `scoreLine.params` direto pro `probableScore` **deixam de typecheckar** → precisam de **narrow em runtime** (ver §3.14).
- `PalpiteResultData` (linha 474): adicionar campos **opcionais** (aditivo, sem DDL — é jsonb; round-trip de rows antigas preservado pois ausentes ficam undefined):
  ```ts
  export type PalpiteResultData = {
    homeScore: number | null;
    awayScore: number | null;
    totalGoals: number;
    // #354: split do 1º tempo (first_half_score). undefined em rows antigas e quando
    // o provider não entrega halftime → a regra deixa PENDING (prefer-skip).
    halftimeHomeScore?: number | null;
    halftimeAwayScore?: number | null;
    // #354: quem marcou 1º por eventos de regulação (first_to_score). undefined quando
    // eventsAvailable !== true → a regra deixa PENDING. "none" = 0 gols de regulação.
    firstToScore?: "home" | "away" | "none";
    eventsAvailable?: boolean;
  };
  ```
  (Nota: o `PalpiteResultData` é a forma ESTREITA, sem Zod no read path — `schema.ts:473`. Os campos novos são populados internamente, não por LLM, então seguem sem Zod, consistente com o existente.)

### 3.3 `db/migrations/` — migration gerada (ver §5)
`pnpm db:generate` emite o próximo `0036_*.sql` (0035 já existe em `main` → o próximo é **0036**) com 4 statements `ALTER TYPE "public"."palpite_type" ADD VALUE '...'` separados por `--> statement-breakpoint` (precedente: `0015_btts_enum.sql`, `0017_double_chance_enum.sql`). Sem DDL pra jsonb (widening de `$type` é só TS). **NUNCA numerar à mão.**

### 3.4 `lib/providers/sports-data/types.ts` — halftime no resultado normalizado
- `NormalizedFixtureResultSchema` (linha 48): adicionar `halftimeScore` opcional/nullable:
  ```ts
  export const NormalizedFixtureResultSchema = z.object({
    status: NormalizedFixtureStatusSchema,
    regulationScore: z.object({ home: z.number().int(), away: z.number().int() }).nullable(),
    // #354: placar do INTERVALO (1º tempo), separado do regulationScore de 90'. OPCIONAL
    // (additive — football-data-org não expõe → omite). null quando o split não existe.
    halftimeScore: z.object({ home: z.number().int(), away: z.number().int() }).nullable().optional(),
  });
  ```
  Opcional para o caminho de VALOR (`settle.ts`) e o football-data-org seguirem byte-idênticos.

### 3.5 `lib/providers/sports-data/api-football/adapter.ts` — thread halftime
- `toNormalizedFixtureResult` (linha 499): ler `f.score.halftime` (já parseado em `schemas.ts:88`) e emitir `halftimeScore`:
  ```ts
  const ht = f.score.halftime;
  const halftimeScore = ht.home !== null && ht.away !== null ? { home: ht.home, away: ht.away } : null;
  return { status: ..., regulationScore, halftimeScore };
  ```

### 3.6 `lib/providers/sports-data/football-data-org/adapter.ts` — paridade
- `toNormalizedFixtureResult` (linha 255): emitir `halftimeScore: null` explicitamente (ou omitir — schema é opcional). football-data.org não expõe split de intervalo confiável no tier grátis → `null` → first_half_score fica PENDING pra esses fixtures (cross-provider safe, igual ao tratamento de eventos). Comentar o porquê.

### 3.7 `lib/settlement/palpite-result-data.ts` (NOVO módulo leaf) — builder do resultData de palpite com halftime + eventos
- **[minor I] Módulo dedicado, NÃO `schemas.ts`.** `resultDataFromRegulationScore` (`schemas.ts:75`) é do caminho de VALOR (retorna `ResultData` rico). O caminho de palpite usa a forma ESTREITA `PalpiteResultData` — hoje construída inline no `settle-palpites.ts:107`. **Decisão de layering:** `palpiteResultDataFrom` vai num **módulo leaf dedicado `lib/settlement/palpite-result-data.ts`** (que importa o tipo `NormalizedFixtureEvents` do provider), mantendo `lib/settlement/schemas.ts` **zod-only** — preserva o grafo acíclico `schemas → money → registry`. (O caminho de valor já importa tipos de provider na camada de ORQUESTRADOR — `settle.ts` — não em `schemas.ts`; manter essa fronteira.)
  ```ts
  // lib/settlement/palpite-result-data.ts (NOVO)
  export function palpiteResultDataFrom(
    regulationScore: { home: number; away: number },
    opts?: {
      halftimeScore?: { home: number; away: number } | null;
      events?: NormalizedFixtureEvents;
    },
  ): PalpiteResultData { ... }
  ```
  Popula `halftimeHomeScore/Away` do `opts.halftimeScore` (null/undefined → campos undefined → first_half_score PENDING) e `firstToScore`/`eventsAvailable` do `opts.events` (derivando o primeiro gol de regulação — ver §3.8 nota de derivação). Mantém o caminho de palpite independente do `ResultDataSchema` de valor.

### 3.8 `lib/settlement/rules/` — 4 regras novas (puras)
Arquivos novos, mesma forma de `exact_score_palpite.ts` (params via Zod `safeParse` → `SettlementError` em invalid; throw em dado ausente → PENDING):

- **`margin_palpite.ts`** — params `{ side: "home"|"away", minMargin: number(int >=1) }`. won sse o lado `side` venceu por `>= minMargin` no `regulationScore`; senão lost. `homeScore`/`awayScore` null → throw.
- **`clean_sheet_palpite.ts`** — params `{ side: "home"|"away" }`. won sse o ADVERSÁRIO do `side` marcou 0 (i.e. `side="home"` → `awayScore === 0`). null → throw.
- **`first_half_score_palpite.ts`** — params `{ home: number, away: number }` (0–20). won sse `params == {halftimeHomeScore, halftimeAwayScore}`. Se `halftimeHomeScore`/`Away` undefined/null → **throw → PENDING** (provider não entregou intervalo, prefer-skip).
- **`first_to_score_palpite.ts`** — params `{ firstToScore: "home"|"away"|"none" }`. Se `resultData.eventsAvailable !== true` OU `resultData.firstToScore === undefined` → **throw → PENDING** (mirror `scorer.ts:28`). Com eventos: won sse `params.firstToScore === resultData.firstToScore`.

**Derivação de `firstToScore` (no builder §3.7, não na regra):** dos `events.goals`, filtrar `isRegulation === true`; ordenar por `minute` ascendente. Own goals que **NÃO são o primeiro** gol relevante continuam contando pro `totalGoals`/placar normalmente. **Casos de borda (definir explicitamente):**
- 0 gols de regulação → `firstToScore = "none"`.
- **[major] PRIMEIRO gol relevante é own goal → AMBÍGUO → `firstToScore` undefined → PENDING** (mesmo bucket de minute-null / empate-de-minuto). **Racional:** a semântica de `ev.team` em eventos de own goal NÃO foi verificada ao vivo (`adapter.ts:519-521`, `schemas.ts:97-103`) — não dá pra saber se a api-football reporta `ev.team` como o time do jogador que fez contra (flip correto) ou o time beneficiado (flip ERRADO). Flipar `teamSide` num wire não-verificado arriscaria um **silent-wrong-settle**. Este é o **PRIMEIRO consumidor de settle do `teamSide` de own goal** — o caminho do value scorer FILTRA own goals (`settle.ts:67`) e nunca confia nesse valor. **Relaxar pro flip de OG só depois de inspecionar um payload real de OG** (mandato ADR 0025). Own goals que NÃO são o primeiro não forçam PENDING; só o primeiro-gol-é-OG.
- `minute === null` em algum gol (raro) → conservador: se o **primeiro gol relevante** tem minute null, **não derivar** (deixa `firstToScore` undefined → PENDING). Gols com minute presente são ordenáveis; um minute null no topo é ambíguo → prefer-skip.
- **Empate de minuto** (dois gols no mesmo `elapsed`, ex.: dois acréscimos reportados como 90) de lados **opostos** → ambíguo → `firstToScore` undefined → PENDING (não chutar). Mesmo minuto, mesmo lado → sem ambiguidade (o lado é determinado).
- A guarda de consistência do merge de eventos (mirror `settle.ts:62-65`: `totalGoals > 0` mas lista de regulação vazia → feed incompleto → `eventsAvailable=false`) também se aplica aqui.

### 3.9 `lib/settlement/rules/palpite-dispatch.ts` — registry por tipo (NOVO)
Record `SettleablePalpiteType → PalpiteRuleFn` (§2.3). Exporta `PALPITE_SETTLEMENT_RULES`. Set de tipos event-backed: `const EVENT_BACKED_PALPITE_TYPES = new Set<SettleablePalpiteType>(["first_to_score"])`.

### 3.10 `lib/settlement/settle-palpites.ts` — dispatch + events fetch
- Importar `getPendingPalpiteSettlements` agora retorna `type` no shape (ver §3.11). 
- Adicionar loop de fetch de eventos espelhando `settle.ts:127-158`: para cada `p` com `EVENT_BACKED_PALPITE_TYPES.has(p.type)`, `getFixtureEvents(ref)` memoizado per-match; `SportsDataUnsupportedError`/erro → `null` (log), o que a regra trata como events ausentes → PENDING.
- No loop de settle (linha 86+): trocar a chamada incondicional (`settle-palpites.ts:108`) por:
  ```ts
  const rule = PALPITE_SETTLEMENT_RULES[p.type]; // p.type já é SettleablePalpiteType (gate na query)
  const resultData = palpiteResultDataFrom(result.regulationScore, {
    halftimeScore: result.halftimeScore ?? null,
    events: EVENT_BACKED_PALPITE_TYPES.has(p.type) ? eventsByMatch.get(p.matchId) ?? undefined : undefined,
  });
  result_ = rule(p.params, resultData);
  ```
  **[minor G] Narrow em runtime, NÃO lie-cast.** O dispatch faz uma guarda em runtime que estreita soundly E honra prefer-skip: `if (!(p.type in PALPITE_SETTLEMENT_RULES)) throw new SettlementError(...)` ANTES do lookup `const rule = PALPITE_SETTLEMENT_RULES[p.type]`. Isso é defense-in-depth (não deve acontecer, gate na query) e narrow correto. Throw da regra (dado ausente) → bucketa em `errors` (já é o comportamento do try/catch em `settle-palpites.ts:109`).
- O `log("settled", { ... totalGoals })` (linha 132) segue; opcionalmente adicionar `type: p.type` no log.

### 3.11 `lib/db/queries/palpites.ts` — pending query multi-tipo + multi-row LATEST-ONLY
- `PendingPalpiteSettlement` (linha 117): adicionar `type` no shape (a regra precisa do tipo pra dispatch). **[minor G] Narrow-not-cast (convenção do repo).** Drizzle NÃO refina o tipo do resultado a partir do predicado runtime `inArray(...)` — o tipo permanece o enum LARGO; um `as SettleablePalpiteType` cru é um **lie-cast**. Estreitar de UMA das duas formas: (a) narrow explícito no `.map` via `SETTLEABLE_SET.has(t)` (igual ao narrow runtime de `outcomeResult` em `getPalpiteSetsForMatch`, `palpites.ts:102-104`), retornando `type: SettleablePalpiteType`; OU (b) deixar `type: DbPalpite["type"]` (largo) no shape e o dispatch (§3.10) fazer a guarda `if (!(p.type in PALPITE_SETTLEMENT_RULES)) throw`. **NUNCA** um `as` cru.
- O predicado (linha 166-167): trocar `eq(palpites.type,"exact_score")` por `inArray(palpites.type, SETTLEABLE_PALPITE_TYPES)`. `eq(palpites.settleable, true)` **fica** (gate duplo defense-in-depth).
- Selecionar `type: palpites.type` no `.select()` (linha 151).
- **LATEST-ONLY com multi-row:** a query JÁ é latest-only via `notExists` de um set mais novo do mesmo (matchId,userId) (linha 176-193) — esse predicado é por **set**, não por row, então com N rows/set ele continua correto: pega TODAS as rows settleable do ÚLTIMO set, exclui as de sets mais novos. **Nenhuma mudança no `notExists`.** O que muda é só o filtro de tipo (`inArray`) e o `type` no select. Com 5 tipos/set, o último set rende até 5 rows pendentes (uma por tipo) — exatamente o desejado (5 badges/dimensão, todas do mesmo set). Verificar no teste pglite (§4) que sets ANTIGOS não vazam nenhuma das 5 rows.

### 3.12 `lib/ai/palpites/cartridges/cartridge.ts` — síntese v3
- `PALPITES_VERSION` (linha 22): `"palpites_v2"` → `"palpites_v3"`. Atualizar o comentário (v3 = + firstHalfScore + firstToScore).
- `PalpitesOutputSchema` (linha 51): adicionar `firstHalfScore: ExactScoreParamsSchema` e `firstToScore: z.enum(["home","away","none"])`. `.strict()` fica. SEM refines (§2.4).
- `SUBMIT_PALPITE_TOOL.input_schema` (linha 160): espelhar — `firstHalfScore` (object home/away 0–20, additionalProperties:false) + `firstToScore` (enum 3 valores). Adicionar aos `required`.
- `SYSTEM_PROMPT` (linha 136) + `buildUserMessage` "# Sua tarefa" (linha 368): instruir os 2 campos novos + a coerência (placar 1º tempo ≤ final; primeiro a marcar coerente com o veredito). Tom mantido. Exportar tipos atualizados.

### 3.13 `lib/ai/palpites/index.ts` — geração multi-row
- Após o insert do `palpite_set` (linha 354), substituir o insert único de `exact_score` (linha 362-373) por um insert em batch das N linhas:
  ```ts
  const rows = buildSettleablePalpiteRows(setRow.id, output); // exact_score + margin + clean_sheet + first_half_score + first_to_score
  const inserted = await db.insert(palpites).values(rows).returning();
  ```
  `buildSettleablePalpiteRows` (helper, mesmo arquivo ou um novo `lib/ai/palpites/settleable-rows.ts`):
  - **exact_score**: `params = {home,away}` do `probableScore` (inalterado), text = label atual.
  - **margin** ([minor J] floor ≥2): derivar do `probableScore` — vencedor = lado com mais gols; `minMargin = |home-away|`. **Emitir a row SÓ quando `|probableScore.home - probableScore.away| >= 2`.** Assim "ganha por 2+" é genuinamente ortogonal ao 1X2 e NUNCA restitui "home vence" (margem ≥1 colapsaria pra a seleção 1X2-home; ≥2 não). Empate previsto (margin 0) e vitória por 1 (1–0, 2–1) **NÃO emitem** a row de margin. text = ex. "Mandante ganha por 2+".
  - **clean_sheet**: derivar — se o adversário previsto sofre 0 (`probableScore` tem um lado com 0), emitir clean_sheet do lado que não sofre; se ambos marcam no placar previsto, **não emitir** (clean_sheet só faz sentido quando se prevê um lado zerado). text = ex. "Mandante não sofre gol".
  - **first_half_score**: `params = {home,away}` do `firstHalfScore`. **Gate de emissão (coerência §2.4):** emitir a row SÓ quando `output.firstHalfScore.home <= output.probableScore.home AND output.firstHalfScore.away <= output.probableScore.away`; senão PULAR (uma dimensão a menos — honesto, igual ao skip de margin/clean_sheet). Isso impede o HERO de mostrar "1º tempo 3–0" sob "provável 1–0". text = ex. "1º tempo: 1–0".
  - **first_to_score**: `params = {firstToScore}` do output. **Gate de emissão (coerência §2.4):** emitir a row SÓ quando `firstToScore` ∈ `{"home","away"}` E concorda com o vencedor implícito de `probableScore` — `"home"` exige `probableScore.home > probableScore.away`; `"away"` exige `probableScore.away > probableScore.home`. Senão PULAR. **Consequência deliberada: `firstToScore === "none"` NUNCA emite row** (o exact_score já fala o 0–0 quando previsto; ver finding F dos minors) — `"none"` fica só como caso interno de settlement, não dimensão de UI; e um primeiro-a-marcar incoerente com o placar provável é descartado. **Âncora = `probableScore`** (o campo ESTRUTURADO que carrega coerência, contratado coerente-com-veredito em `cartridge.ts:142`), NÃO o `verdict` em texto livre (o schema não tem campo estruturado de vencedor). É a MESMA âncora de que margin/clean_sheet derivam. text = ex. "Mandante marca primeiro".
  - Todas: `settleable = deriveSettleable(type)` (a constante decide), `text` truncado. **[dismissed-residual P] Templates de texto FIXOS — MANDATÓRIO (não preferência):** o `text` derivado de TODA row settleable vem de um conjunto **PINADO e auditável** de templates fixos (determinístico sobre os campos inteiros estruturados — `probableScore`/`firstHalfScore`/`firstToScore`/`minMargin`), nunca texto livre do LLM. O `containsValueLanguage` guard (já planejado — MANTER) roda sobre esses `text` em geração, espelhando `index.ts:252-257`. Um teste sobre as strings derivadas EXATAS (golden, §4) torna o conjunto de templates auditável e impede um número de valor de vazar pra um label.
  - **Decisão de emissão condicional:** margin (floor ≥2), clean_sheet (empate/ambos-marcam) e os gates de coerência de first_half_score / first_to_score podem pular rows → o set terá **0, 1 ou 2** dimensões além do exact_score. Isso é OK: a ausência de uma dimensão é semanticamente honesta. Documentar que nem todo set tem todas as 5; o scorecard degrada (§3.15).
- **[major E] Return shape — WIDEN o existente, não substituir.** O gerador HOJE retorna `{ palpiteSet: setRow, palpites: [pRow], aiCall: aiCallId ? { id: aiCallId } : null }`. Trocar APENAS `palpites: [pRow]` → `palpites: inserted`:
  ```ts
  return { palpiteSet: setRow, palpites: inserted, aiCall: aiCallId ? { id: aiCallId } : null };
  ```
  `palpiteSet` e `aiCall` **permanecem** no retorno. Nota: `app/actions/predictions.ts:504-505` continua funcionando — `inserted` é o array completo de rows, `.find(p => p.type === "exact_score")` resolve a linha do placar, e `result.palpiteSet.headline` segue disponível porque `palpiteSet` NÃO sai do retorno.

### 3.14 `app/actions/predictions.ts` + `lib/view/palpites-headline.ts` — narrow do `exact_score` (BLOCKER §3.2) + `dimensions` consistentes nos dois call-sites
**[BLOCKER] As duas leituras de `exact_score` precisam estreitar `params` em runtime** (a union larga do `$type` não atribui a `{home,away}` — §3.2). NÃO é mais "no-op / mantém". Dois edits concretos:

1. **`lib/view/palpites-headline.ts` `toPalpiteHeadlineViewFromSet` (~:66-69):**
   ```ts
   import { ExactScoreParamsSchema } from "@/lib/ai/palpites/cartridges/cartridge";
   // ...
   const scoreLine = set.palpites.find((p) => p.type === "exact_score");
   if (!headline || !scoreLine?.params) return null;
   const ps = ExactScoreParamsSchema.safeParse(scoreLine.params);
   if (!ps.success) return null; // prefer-skip: params ruins → manchete null (HERO trata como empty)
   // use ps.data como probableScore
   ```
2. **`app/actions/predictions.ts` fresh-view (~:504-508):**
   ```ts
   const scoreLine = result.palpites.find((p) => p.type === "exact_score");
   const ps = scoreLine?.params ? ExactScoreParamsSchema.safeParse(scoreLine.params) : null;
   if (result.palpiteSet.headline && ps?.success) {
     palpite = toPalpiteHeadlineView({ headline: ..., probableScore: ps.data, outcome: null });
   }
   ```
   (`import { ExactScoreParamsSchema } from "@/lib/ai/palpites/cartridges/cartridge"`. Usar o schema JÁ EXPORTADO do cartucho, NÃO o duplicado privado em `lib/settlement/rules/exact_score_palpite.ts:9`.) Isso também entrega o prefer-skip: params que não casam com `{home,away}` → manchete null em vez de render quebrado.

**`dimensions` consistentes nos DOIS call-sites (§3.15 / minor K):** a manchete continua usando o `exact_score` como placar provável central; as 4 linhas novas alimentam o **scorecard**. Como `dimensions` é campo **obrigatório** de `PalpiteHeadlineView` (§3.15), o fresh path TAMBÉM precisa populá-lo — a partir do `result.palpites` em memória (todas as outras rows settleable, todas com `outcome=null` → badge pending), IDÊNTICO ao que `toPalpiteHeadlineViewFromSet` faz na reload. Não pode ficar `[]` no fresh: senão o scorecard SOME logo após "Analisar com IA" e REAPARECE só no reload (glitch visível no momento de maior intenção). Ambos os call-sites montam `dimensions` pelo MESMO helper de mapeamento.

### 3.15 UI — surfacing mínimo mas real
**Local:** um pequeno **scorecard de dimensões** dentro do HERO (`components/palpites/palpite-hero.tsx`), abaixo da narrativa / citedMarkets, visível SÓ quando há ≥1 dimensão settleável. **Firewall:** ZERO número de valor — só rótulos de palpite (placar, "ganha por 2+", "não sofre gol", "marca 1º") + badge acertou/errou/aguardando (reusa `SettleableBadge`, `palpite-badges.tsx:18`). O placar provável (exact_score) **continua** na fala do veredito (`ProbableScore`/`SettledReceipt`); o scorecard é pras OUTRAS 4 dimensões — a manchete não vira lista de números.

- **`lib/view/palpites-headline.ts`** (`PalpiteHeadlineView`, linha 8): adicionar `dimensions: PalpiteDimensionView[]` como campo **OBRIGATÓRIO** (não opcional — força os dois call-sites a popular, §3.14 / minor K), onde:
  ```ts
  type PalpiteDimensionView = {
    label: string;          // "ganha por 2+", "1º tempo 1–0", "marca primeiro", "não sofre gol"
    badge: "won" | "lost" | null; // null = pendente/sem dado
  };
  ```
  `toPalpiteHeadlineViewFromSet` (linha 61): além do `exact_score` (que vira a manchete), mapear as outras rows settleable do set pra `dimensions` (label do `p.text` ou derivado do `type`+`params`; badge do `p.outcome?.result ?? null`). exact_score continua excluído de `dimensions` (já é a fala principal). **Firewall:** nenhum dos labels carrega número de valor (são placares/proposições, não odds — placar 2–1 ≠ cotação 2.10, mesmo enquadramento já usado pra `ProbableScore`).
- **`components/palpites/palpite-hero.tsx`**: novo subcomponente `<DimensionScorecard dimensions={view.dimensions} />` (chips: label + `SettleableBadge`/"aguardando placar"). Renderizar no `PopulatedHero` (após citedMarkets). Polish pesado fica pro `/impeccable` — aqui só a estrutura honesta e a11y (badge nunca só por cor, já garantido por `SettleableBadge`).
  - **[minor H] Adapter do badge → `SettleableBadge`:** a prop do `SettleableBadge` é `state: { kind: "pending" | "settled"; result? }`, **NÃO** `"won"|"lost"|null`. O `<DimensionScorecard>` mapeia explicitamente: `badge === null ? { kind: "pending" } : { kind: "settled", result: badge }` (ou carregar o shape de state do `SettleableBadge` direto no `PalpiteDimensionView`). NÃO deixar esse passo glossado — sem ele o componente não typecheckar contra a view proposta.
- **`app/match/[id]/page.tsx`**: nenhuma mudança estrutural — `heroPalpite` já vem de `toPalpiteHeadlineViewFromSet` (linha 94-95); as `dimensions` fluem juntas.

**[major D] Decisão de produto/IA — o scorecard vs. o "UMA fala do amigo" do HERO (ADR 0030).** O HERO foi desenhado deliberadamente para agrupar veredito+placar como UMA fala do amigo, "não veredito + stat-row separado" (`palpite-hero.tsx:146-148`), e escolheu um `ScoreLabel` conversacional "não um stat-row de dashboard" (`palpite-hero.tsx:364-366`); o ADR 0030 reduziu a página a "uma manchete legível, em vez de uma tabela de edges" (Consequências). Um grid de chips+badges é, por padrão, exatamente o stat-row que esse desenho removeu. **Decisão:**
- O scorecard é uma **"ficha" QUIETA** (track-record das apostas secundárias do amigo), colocada **ESTRITAMENTE ABAIXO** do veredito/placar/narrativa/citedMarkets, no **registro CONVERSACIONAL** (NÃO eyebrow-mono / chrome de dashboard), pra ler como **badges de "fala do amigo" continuada**, não um grid de dashboard — espelhando a escolha sans-conversacional do `ScoreLabel` em `:366`.
- Vive na **zona quente (warm) do HERO**: as dimensões de palpite são entretenimento firewall-safe (placar/proposição, sem número de valor), categoria de conteúdo DISTINTA do detalhe neutro de edge/EV que mora no collapsible. Manter as duas categorias separadas é a escolha deliberada (não misturar o palpite quente com o detalhe de valor).
- **Estados vazio/esparso (decididos AQUI e golden-pinados em §4):** com os skips condicionais (floor de margin ≥2, clean_sheet, gates de coerência §3.13), um set pode ter **0, 1 ou 2** dimensões. O componente DEVE degradar graciosamente: **esconder INTEIRO em 0**; inline/single-line em 1–2; **nunca renderizar um card torto/lopsided**. Só o polish cosmético defere pro `/impeccable` — a IA de colocação e o comportamento de estado-vazio são decididos NESTE PR.

### 3.16 `lib/view/palpites.ts` (+ `lib/view/__tests__/palpites.test.ts`) — mapper enum-safe (consumidor esquecido)
**[major F] Trap de `undefined` silencioso.** Este arquivo tem um `type PalpiteType` **ESCRITO À MÃO** (linha 5: `"exact_score" | "red_card" | "corners"`) + um `TYPE_LABEL: Record<PalpiteType, string>`. Como o tipo é hand-written (não derivado do enum), o TS NÃO acusa o `Record` incompleto, e `TYPE_LABEL[line.type as PalpiteType]` (cast em `~:58`) retorna `undefined` em RUNTIME pros 4 tipos novos (margin/clean_sheet/first_half_score/first_to_score) — label vazio silencioso. Tornar **enum-safe**:
- Substituir o `type PalpiteType` hand-written (~linha 5) por `import type { PalpiteType } from "@/lib/ai/palpites/settleable"` (a fonte canônica).
- Remover o `as PalpiteType` cast (~linha 58) → `line.type` flui como o enum completo e `TYPE_LABEL[type]` passa a ser **exhaustiveness-checked** pelo TS (qualquer tipo do enum sem label vira erro de compilação).
- Adicionar os 4 labels novos ao `TYPE_LABEL` + atualizar o comentário (não é mais "exact_score é o único settleable").
- Atualizar o teste `lib/view/__tests__/palpites.test.ts` pros novos labels.
- (Se na implementação o mapper provar-se realmente dead-for-render, deletar mapper + teste é aceitável — mas enum-safe é barato e remove a trap de `undefined` silencioso; **preferir enum-safe**.)

---

## 4. Plano de testes

> Rodar pglite com `pnpm test --no-file-parallelism` (flake de 8-core, memória do repo). CI é 2-core e fica verde.

**Unit puros (novos — um arquivo por regra, espelhando `exact_score_palpite-rule.test.ts`):**
- `lib/settlement/__tests__/margin_palpite-rule.test.ts` — won (2-0, side=home, minMargin 2), won (3-0, minMargin 2), lost (1-0 com minMargin 2), lost (lado errado), **prefer-skip**: `homeScore null` → throw `SettlementError`; params inválidos → throw. (A REGRA aceita qualquer `minMargin>=1`; o **floor ≥2 é gate de EMISSÃO** em geração, testado no golden de strings derivadas, não nesta regra pura.)
- `lib/settlement/__tests__/clean_sheet_palpite-rule.test.ts` — won (2-0, side=home), lost (2-1, side=home), won (0-1, side=away→ away sofreu? cuidado: clean_sheet do away = home marcou 0), **prefer-skip**: null → throw.
- `lib/settlement/__tests__/first_half_score_palpite-rule.test.ts` — won (HT 1-0 == params 1-0), lost (HT 1-0 vs 0-0), **prefer-skip**: `halftimeHomeScore` undefined/null → throw → PENDING; params inválidos → throw.
- `lib/settlement/__tests__/first_to_score_palpite-rule.test.ts` — won (firstToScore "home" == derived "home"), lost ("home" vs "away"), won ("none" vs "none"), **prefer-skip**: `eventsAvailable !== true` → throw; `firstToScore` undefined (ambíguo/minute null) → throw.
- `lib/settlement/__tests__/palpite-result-data.test.ts` (ou estender `schemas.test.ts`) — derivação de `firstToScore`: **[major B] PRIMEIRO gol relevante é own goal → `firstToScore` undefined → PENDING** (NÃO "credita o adversário" — wire não verificado, §3.8); **positivo: um own goal MAIS TARDE** (depois de um primeiro gol normal verificado) NÃO muda o `firstToScore`; empate de minuto entre lados opostos → undefined; minute null no topo → undefined; 0 gols → "none"; guarda de feed-incompleto (totalGoals>0 mas lista vazia → eventsAvailable=false).

**Query (editar) `lib/db/queries/__tests__/pending-palpite-settlements.pglite.test.ts`:**
- Seed de um set com as 5 rows (uma por tipo) → todas as settleable pendentes voltam (5 rows).
- LATEST-ONLY: 2 sets no mesmo (match,user), cada um com 5 rows → SÓ as 5 do último set voltam (nenhuma das 5 antigas vaza). Reforça o `notExists` por-set com multi-row.
- `red_card`/`corners` seedados → NUNCA voltam (gate `inArray` + `settleable`).
- `type` presente no shape retornado.

**[minor N] Widening dos helpers de seed (pglite):** alargar o `type` dos helpers `seedPalpite`/`seedSetWithScore`-style pra `DbPalpite["type"]` (ou `SettleablePalpiteType`) e o `params` pra a nova union ANTES de seedar o set multi-row. Estender o mock `__setSportsDataProviderForTesting` pra adicionar `getFixtureEvents` (retornando `NormalizedFixtureEvents{eventsAvailable, goals}`) e `halftimeScore` no `NormalizedFixtureResult`.

**E2E (editar) `lib/settlement/__tests__/settle-palpites.pglite.test.ts`:**
- Estender o provider mock pra entregar `halftimeScore` e `getFixtureEvents` (com `eventsAvailable`).
- Um match finalizado com placar 2-0 + HT 1-0 + eventos (home marca aos 20') → settla **as 5 dimensões** com os resultados certos (exact_score won/lost, margin home≥1 won, clean_sheet home won, first_half_score 1-0 won, first_to_score home won).
- **Skip de halftime ausente:** match finalizado mas `halftimeScore: null` → first_half_score fica PENDING (errors/skip), as outras 4 settlam.
- **Skip de eventos ausentes:** `getFixtureEvents` lança `SportsDataUnsupportedError` (provider football-data-org-like) → first_to_score PENDING, as outras settlam; o match NÃO erra inteiro.
- Idempotência: 2ª run = no-op (alreadySettled) pras 5 rows.
- **[minor O] Parcial-depois-completa (idempotência ponta-a-ponta):** run 1 com `halftimeScore: null` → `first_half_score` PENDING, as outras rows settlam; run 2 com `halftimeScore` AGORA fornecido → `first_half_score` settla, `alreadySettled` cobre as demais (nenhuma outcome row nova pra elas). Assert: contagem de outcomes vai de N → N+1 e as rows anteriores ficam byte-idênticas.

**View (editar) `lib/view/__tests__/palpites-headline.test.ts`:** `dimensions` populadas corretamente; exact_score NÃO aparece em `dimensions` (é a manchete); nenhum número de valor.
- **[major C] Gates de coerência:** um `firstHalfScore` incoerente (> `probableScore` em algum lado) → NENHUM chip de first_half_score; um `firstToScore` que discorda do vencedor implícito de `probableScore` (ou `"none"`) → NENHUM chip de first_to_score.
- **[major A] Asserção typecheck-only:** `toPalpiteHeadlineViewFromSet` E o bloco fresh-view de `predictions.ts` COMPILAM contra a union de 4 membros do `$type` (regressão pega por `pnpm typecheck`, §7) — graças ao narrow via `ExactScoreParamsSchema.safeParse` (§3.14).
- **[minor K] Fresh == reload:** o fresh-analyze (`toPalpiteHeadlineView` a partir de `result.palpites`) e o persisted-reload (`toPalpiteHeadlineViewFromSet`) produzem os MESMOS `dimensions` pro mesmo set (sem glitch de sumir-no-fresh-aparecer-no-reload).

**[dismissed-residual P] Golden das strings derivadas (template fixo auditável):** teste sobre as strings EXATAS produzidas por `buildSettleablePalpiteRows` (ex.: "Mandante ganha por 2+", "1º tempo: 1–0", "Mandante marca primeiro", "Mandante não sofre gol") — torna o conjunto de templates fixos auditável e impede um número de valor de vazar pra um label. Inclui o caso do floor de margin ≥2 (1–0 / 2–1 não geram row de margin).

**Hero (editar) `components/__tests__/palpite-hero.test.tsx`:** scorecard renderiza os labels + badges; firewall continua limpo (nenhuma classe edge-*, nenhum dígito de valor) com dimensões settled e pending.
- **[major D] Estados 0 / 1 / 2 / vários dimensões (golden-pin):** 0 dimensões → componente ESCONDIDO inteiro (nenhum card); 1–2 → inline/single-line (nunca card torto); vários → renderiza todos. Novo teste renderizando chips **settled + pending** misturados através do firewall.

---

## 5. Migration

```bash
pnpm db:generate   # NUNCA numerar à mão — pega o próximo número (0036+; 0035 já existe em main)
# inspecionar o .sql gerado: deve ter SÓ 4x ALTER TYPE ... ADD VALUE, separados por
# --> statement-breakpoint. ZERO statement de jsonb (widening de $type é só TS).
pnpm db:migrate    # aplicar localmente; pglite roda as migrations reais nos testes
```

**Caveat `ALTER TYPE ... ADD VALUE`:** em Postgres, `ADD VALUE` **não pode rodar dentro de um bloco de transação** junto com uso do valor novo no mesmo tx. O Drizzle emite cada `ADD VALUE` como statement separado por `--> statement-breakpoint` (precedente verificado: `0015_btts_enum.sql` e `0017_double_chance_enum.sql` — cada `ADD VALUE` é um statement isolado, sem `BEGIN/COMMIT` no arquivo). O runner do Drizzle aplica statement-a-statement, então não há conflito. **Não** misturar o `ADD VALUE` com um INSERT que use o valor novo na mesma migration (não fazemos — só DDL de enum). Rows novas com os tipos novos só são escritas pela geração em runtime, depois da migration aplicada.

---

## 6. Riscos / landmines

1. **Cartucho de síntese VIVO (`palpites_v3`):** mudar o schema `.strict()` + tool + prompt afeta TODA síntese nova em prod assim que mergeado. Bump de versão obrigatório (rastreabilidade); o `promptVersion` persistido reflete. Custo de tokens: + 2 campos no output é marginal, mas é spend real — não rodar a síntese N vezes só pra debug (gotcha CLAUDE.md).
2. **Refine NÃO adicionado (decisão §2.4) — mas EMISSÃO gated por coerência (§3.13):** o `.refine()` rejeitante continua FORA (degradaria o palpite inteiro a null). A coerência de **settlement** (acertou/errou) é 100% fato do jogo. A coerência de **produto** (HERO sem chip autocontraditório) é garantida pelo **gate de emissão** em `buildSettleablePalpiteRows` (§3.13): first_half_score só emite se ≤ `probableScore` em cada lado; first_to_score só emite se concorda com o vencedor implícito de `probableScore`. Logo um `firstHalfScore`/`firstToScore` incoerente NÃO vira badge — é PULADO, não barrado-com-null. Risco residual mínimo: o LLM ainda pode gerar valores incoerentes, mas eles só somem do scorecard (mitigado também por prompt).
3. **Golden ripple — breakers EXATOS (auditar ANTES, memória "Audit test pins before token migration"):**
   - `palpites-headline.test.ts`: as asserções de shape `toEqual({...})` precisam GANHAR `dimensions: ...` (hoje exact_score-only); o helper `line()` (só monta exact_score hoje) precisa de fixtures multi-tipo pra cobrir dimensões.
   - `palpite-hero.test.tsx`: a fixture POPULATED (~:17-25) precisa de um campo `dimensions`; novo teste renderizando chips settled+pending através do firewall. **Confirmar que NÃO há count-pin `toHaveLength`** nos blocos do hero.
   - `settle-palpites.pglite` e `pending-palpite-settlements.pglite` mudam de "só exact_score" pra multi-tipo.
4. **Paridade cross-provider:** football-data-org não dá halftime nem eventos → first_half_score e first_to_score só liquidam em fixtures servidos pela api-football; nos outros ficam **PENDING para sempre** (nunca LOST). Isso é correto (prefer-skip) mas significa badges eternamente "aguardando" pra esses jogos — documentar/aceitar. exact_score/margin/clean_sheet liquidam em ambos.
5. **Dobra de quota no cron de palpite (precisão):** o Map de memo per-match em `settle-palpites.ts` é **SEPARADO** do Map `eventsByMatch` de `settle.ts` — a dedup cross-cron depende APENAS do `inMemoryCache` process-scoped de 15 min. Um fixture com row `first_to_score` pendente **mas sem** predição de valor `anytime_scorer`/`assist` é um fetch de `/fixtures/events` **genuinamente net-new** (não deduplicado contra o caminho de valor; só deduplica via `inMemoryCache` quando o MESMO fixture também tem scorer/assist pendente). Quantificando o pior caso: **~1 crédito extra por fixture finalizado com uma row `first_to_score` no último set**, no cron diário — bounded, não zero. Mencionar a folga do free-tier api-football (500 req/mês) no PR.
6. **Idempotência com multi-row:** cada row tem sua própria `palpiteOutcomes` (UNIQUE em `palpiteId`). Re-run → `onConflictDoNothing` por row → no-op. Uma row que ficou PENDING (halftime ausente) num run pode settlar num run futuro (quando o provider entregar o dado) sem afetar as irmãs já settled. Verificar no e2e que settle parcial + re-run completa as pendentes sem duplicar as settled (teste explícito §4, minor O).
7. **Geração condicional (margin floor ≥2 / clean_sheet / gates de coerência):** sets com vitória por 1 ou empate previsto (margin), ambos-marcam previsto (clean_sheet), ou first_half_score/first_to_score incoerente (gates §3.13) terão **0, 1 ou 2** dimensões além do exact_score. A UI e a pending query tratam ausência de dimensão como "não existe", não como erro; o scorecard ESCONDE inteiro em 0 (§3.15). Documentado em §3.13.
8. **`$type` largo vs Zod per-rule:** o `$type` da union é só conveniência de escrita; a CORREÇÃO vem do `safeParse` em cada regra (e nos DOIS read-sites de exact_score, que agora estreitam via `ExactScoreParamsSchema`, §3.14). Não confiar no `$type` no read path (mirror exact_score).
9. **[major B] Primeiro gol = own goal → PENDING para sempre até o wire ser verificado:** um jogo cujo verdadeiro primeiro a marcar foi por gol contra fica `first_to_score` PENDING (não settla) enquanto a semântica de `ev.team` em eventos de OG não for inspecionada num payload real (mandato ADR 0025). Aceitável (prefer-skip), consistente com o stance de PENDING-para-sempre cross-provider da landmine #4. É o caso raro; settlement nunca chuta o lado errado.
10. **[major D] Scorecard como "ficha" quieta, não stat-row:** o scorecard mora no HERO mas ESTRITAMENTE abaixo do veredito/placar/narrativa, em registro conversacional (não dashboard chrome), pra não reintroduzir a "tabela de edges" que o ADR 0030 removeu. Estados 0/1/2 dimensões degradam graciosamente (esconde inteiro em 0). Decisão de IA/colocação + estado-vazio são deste PR (golden-pin §4); só polish cosmético defere pro `/impeccable`.

---

## 7. Critério de saída & gates

- [ ] As 4 regras com unit puro incl. caso prefer-skip (throw → PENDING) — `pnpm test`.
- [ ] pending-query pglite atualizado: multi-row LATEST-ONLY + gate `inArray` + `red_card`/`corners` excluídos + `type` no shape.
- [ ] settle-palpites e2e: match finalizado settla as (até) 5 dimensões; skip de halftime ausente; skip de eventos `Unsupported`; idempotência multi-row.
- [ ] view + hero tests atualizados; firewall (ZERO número de valor, nenhuma classe edge-*) verde com scorecard.
- [ ] Migration gerada via `pnpm db:generate` (não numerada à mão), só 4x `ALTER TYPE ADD VALUE`, aplica limpo.
- [ ] `pnpm typecheck` (gate const dirige ambos os caminhos; union do `$type`; `SettleablePalpiteType` no dispatch — sem `any`).
- [ ] `pnpm lint`.
- [ ] `pnpm test --no-file-parallelism` (pglite) verde local; CI (typecheck+lint+test) verde no PR.
- [ ] `pnpm build`.
- [ ] Commit do bump de prompt como `prompt:` (palpites_v3), rastreabilidade.
- [ ] Fechar #354 manualmente após merge (PT-BR "Fecha #N" não auto-fecha — memória).
