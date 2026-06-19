# PLAN-314 — Domínio de palpites (DB-only)

Issue: **#314** — `feat(db): dominio de palpites (palpite_sets + palpites + settlement de placar) + seed de tipos`

> Snapshot histórico de um ponto no tempo (ver `docs/plans/README`). Aterra no
> CÓDIGO real lido durante a exploração. **Escopo: DB-ONLY.** Sem geração LLM
> (isso é #315), sem UI (isso é #316). Esta fatia entrega: schema + migration +
> seed de tipos + caminho de settlement de placar exato + query de leitura +
> testes pglite.

ADR de referência: `docs/decisions/0028-palpites-engajamento-separado-das-recomendacoes.md`.

---

## 0. Invariantes inegociáveis (do ADR 0028)

Antes de qualquer linha de código, internalizar estes limites — violar qualquer
um deles é retrabalho garantido:

1. **palpites = PREDIÇÕES de engajamento, schema PRÓPRIO.** NUNCA colunas de
   valor: sem `edgePct`, `impliedProbPct`, `stakeUnits`, `minimumOdd`,
   `oddAtRecommendation`, `bookmaker`, `confidencePct`. Contaminar isso polui o
   motor de valor (ADR 0018-0019).
2. **FKs espelham `predictions`** (`db/schema.ts:254-309`): `matchId →
   matches.id`, `userId → users.id`, ambos `uuid().notNull()` com
   `onDelete: "restrict"` — **EXCETO** `aiCallId`, que em palpites é
   **NULLABLE** (a auto-geração de #315 pode falhar silenciosamente;
   `predictions.aiCallId` é `.notNull()` em `db/schema.ts:264-266`).
   `palpite_sets` também carrega `modelVersion`/`promptVersion` **notNull**
   como `predictions` (`db/schema.ts:298-299`) — proveniência de cartucho
   (ADR 0017), engagement-neutral, **não** é coluna de valor. O `aiCallId`
   nullable é a **única** divergência de não-FK restante.
3. **`exact_score` liquida por compare DIRETO** de `params {home, away}` contra
   o placar de 90' (regulation), **SEM o limite da grade 0-3** do
   `correctScoreRule` (um palpite `4-1` TEM que liquidar). Reusa
   `regulationScore` + `resultDataFromRegulationScore`, mas com um compare NOVO
   específico de palpite, **NÃO** `correctScoreRule`.
4. **`settleable=false` NUNCA cria outcome row e NUNCA entra no cron** ("prefer
   skip over silent wrong settle").
5. **Migration 0033 já existe** (`db/migrations/meta/_journal.json` idx=33,
   `0033_black_george_stacy`). Gerar via `pnpm db:generate` → próximo livre
   (0034 hoje). **NUNCA hand-number.**

---

## 1. Schema — definições Drizzle a adicionar em `db/schema.ts`

### 1.0 Decisão de arquitetura — UMA tabela de outcome, NÃO reusar `prediction_outcomes`

**Decisão: criar `palpite_outcomes` DEDICADA, espelhando a forma de
`prediction_outcomes` (`db/schema.ts:346-374`), mas SEM `profitUnits` e
referenciando `palpites.id`.**

Justificativa, aterrada na forma real de `prediction_outcomes`:

- `prediction_outcomes.predictionId` é `uuid().notNull().unique().references(()
  => predictions.id)` (`db/schema.ts:348-351`). A FK aponta para `predictions` —
  não dá para reusar a tabela apontando uma row de palpite, e relaxar a FK
  contaminaria o domínio de valor. **Tabela separada é a única opção limpa.**
- `prediction_outcomes.profitUnits` é `numeric(8,2).notNull()`
  (`db/schema.ts:371`). Palpite **não tem stake nem profit** (invariante 1).
  Reusar a tabela forçaria `profitUnits` a um valor fabricado (ex.: `0`), o que
  é exatamente a contaminação de valor que o ADR proíbe. `palpite_outcomes`
  **omite `profitUnits` inteiro.**
- O `resultData` jsonb de `prediction_outcomes` (`db/schema.ts:359-369`) carrega
  `{homeScore, awayScore, totalGoals, scorers?, assisters?, eventsAvailable?}`.
  Para palpite de placar só precisamos de `{homeScore, awayScore, totalGoals}` —
  **reusamos a forma `ResultData`** (`lib/settlement/schemas.ts:42-53`) verbatim
  para o jsonb (round-trip já validado por Zod), mas numa coluna de tabela
  separada. Os campos `scorers?/assisters?` ficam ausentes (opcionais) — inertes.
- O enum de resultado: `prediction_outcomes.result` usa `outcomeResultEnum`
  (`won/lost/void/push`, `db/schema.ts:38-48`). Palpite de placar exato só
  resolve **acertou / errou** (binário). Ver §1.4 para a decisão do enum.

> **Granularidade do outcome: por `palpite` (linha individual), não por
> `palpite_set`.** Um set pode conter um `exact_score` (settleable) + um
> `red_card` (não-settleable). O outcome é da linha settleable. Isso espelha o
> 1:1 `prediction_outcomes ↔ predictions` (`db/schema.ts:350` `.unique()`),
> aqui `palpite_outcomes ↔ palpites`.

### 1.1 pgEnum — tipo de palpite

**Decisão: `type` é um pgEnum (`palpiteTypeEnum`), NÃO uma tabela de catálogo.**

Justificativa: o catálogo de `markets`/`market_selections` virou tabela de
referência porque cada mercado carrega `settlement_rule_key`, `label`,
`is_active/is_graduated` e seleções filhas (`db/schema.ts:73-97`) — estrutura
rica que precisa de FK. Um **tipo de palpite não tem nada disso**: é só um rótulo
controlado com um bit `settleable`. O repo prefere enum quando o conjunto é
pequeno, fechado e sem atributos (ex.: `leagueEnum`, `matchStatusEnum`,
`db/schema.ts:19-31`). A propriedade `settleable` por tipo **não** vira coluna de
catálogo — mora na linha `palpites.settleable` (ver §1.3 e a justificativa de
seed em §2), evitando ALTER TYPE a cada tipo novo *e* uma tabela de catálogo
órfã de 1 coluna.

```ts
// Tipos de palpite de ENGAJAMENTO (ADR 0028). Enum controlado (não tabela de
// catálogo): um tipo é só um rótulo fechado sem atributos próprios — diferente
// de markets, que carrega settlement_rule_key/seleções (FK). exact_score é o
// ÚNICO settleable na v1 (liquida por placar de 90'); os demais são "fun-only"
// (settleable=false, NUNCA entram no cron — ADR 0028 §3). Tipo novo = ALTER TYPE
// ADD VALUE numa migration (raro). settleable mora na linha palpites, não aqui.
export const palpiteTypeEnum = pgEnum("palpite_type", [
  "exact_score",
  "red_card",
  "corners",
  // adicionar tipos fun-only conforme #313/#316 pedirem (penalty, first_goal…)
]);
```

> **verify during implementation:** confirmar com o corpo de #313/#316 quais
> tipos fun-only entram na v1. O ADR cita `red_card`/`corners` como exemplos. Se
> a lista exata não estiver fixada, seedar SÓ `exact_score` + os 2 exemplos é o
> mínimo coerente — mais tipos entram por ALTER TYPE depois.

### 1.2 pgEnum / coluna — resultado do outcome de palpite

Ver §1.4. Decisão: **reusar `outcomeResultEnum` restrito a `won`/`lost`** no
nível de aplicação, sem novo enum. (Detalhe e alternativa em §1.4.)

### 1.3 Tabelas

Inserir **depois** de `predictionOutcomes` (`db/schema.ts:374`) e antes dos
snapshots, mantendo a ordem topológica de declaração (FKs apontam para tabelas já
declaradas: `matches` :207, `users` :100, `aiCalls` :228 todas vêm antes).

```ts
// ─── Palpites de engajamento (ADR 0028) ──────────────────────────────────────
// Domínio SEPARADO das recomendações de valor: palpite é uma PREDIÇÃO de
// engajamento (placar exato, cartão vermelho, escanteios…), NUNCA carrega
// edge/implied/stake/Yield (ADR 0028 §1 — contaminaria o motor de valor). Um
// palpite_set = um evento de geração por (match, user); imutável. As linhas
// individuais ficam em `palpites`.

// Um EVENTO de geração de palpites por (match, user). Espelha as FKs de
// predictions (matchId/userId notNull restrict) EXCETO aiCallId, que é NULLABLE:
// a auto-geração (#315) é fire-and-forget e pode falhar silenciosamente, então
// um set pode existir sem ai_call (predictions.aiCallId é notNull). Imutável:
// revisão = novo set (mesma disciplina de predictions).
export const palpiteSets = pgTable(
  "palpite_sets",
  {
    id: uuid().primaryKey().defaultRandom(),
    matchId: uuid()
      .notNull()
      .references(() => matches.id, { onDelete: "restrict" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // NULLABLE (divergência deliberada vs predictions.aiCallId notNull): a
    // auto-geração pode falhar silenciosamente; um set órfão de ai_call é válido.
    aiCallId: uuid().references(() => aiCalls.id, { onDelete: "restrict" }),
    // Proveniência do cartucho (ADR 0017 dupla-persistência + ADR 0028 §5:
    // palpites = "cartucho próprio"). NOTNULL como predictions (db/schema.ts:298-299).
    // Crítico: aiCallId é NULLABLE, então ai_calls.promptVersion NÃO pode ser a
    // única casa da versão — um set órfão perderia toda rastreabilidade de cartucho.
    // Provenance é engagement-neutral (NÃO é coluna de valor — ver §0 invariante 1).
    // #315 grava qual modelo Haiku + versão do cartucho de palpite produziu o set.
    modelVersion: text().notNull(),
    promptVersion: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("palpite_sets_match_id_idx").on(t.matchId),
    index("palpite_sets_user_id_idx").on(t.userId),
    index("palpite_sets_created_at_idx").on(t.createdAt),
  ],
);

// Uma LINHA de palpite dentro de um set. `type` (enum controlado), `text` (a
// frase humana renderizada na UI), `params` jsonb OPCIONAL (forma estruturada,
// p.ex. {home, away} no exact_score; null em tipos sem params), `settleable`
// (bit: só exact_score=true na v1). NUNCA edge/stake/Yield (ADR 0028 §1).
// settleable=false NUNCA gera outcome nem entra no cron (ADR 0028 §3).
export const palpites = pgTable(
  "palpites",
  {
    id: uuid().primaryKey().defaultRandom(),
    palpiteSetId: uuid()
      .notNull()
      .references(() => palpiteSets.id, { onDelete: "cascade" }),
    type: palpiteTypeEnum().notNull(),
    text: text().notNull(),
    // OPCIONAL: forma estruturada do palpite. exact_score → {home, away}
    // (inteiros). Validada por Zod no boundary de escrita (#315) e no compare de
    // settlement (§3). Tipos fun-only podem deixar null.
    params: jsonb().$type<{ home: number; away: number }>(),
    // Só exact_score=true na v1. O cron de placar filtra por (type='exact_score'
    // AND settleable=true) — defense-in-depth contra um seed errado.
    settleable: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("palpites_palpite_set_id_idx").on(t.palpiteSetId),
    // Suporta o pending-set do cron (WHERE type='exact_score' AND settleable).
    index("palpites_type_idx").on(t.type),
  ],
);

// Outcome de um palpite SETTLEABLE. Espelha prediction_outcomes
// (db/schema.ts:346-374) MAS sem profitUnits (palpite não tem stake/profit — ADR
// 0028 §1) e referenciando palpites.id. predição UNIQUE → 1:1 idempotente
// (mesmo contrato de prediction_outcomes.predictionId). resultData reusa a forma
// ResultData (lib/settlement/schemas.ts) — {homeScore, awayScore, totalGoals}.
// Forma ESTREITA do resultData de palpite — NOMEADA (não a ResultData rica de
// prediction_outcomes). Só {homeScore, awayScore, totalGoals}; SEM
// scorers?/assisters?/eventsAvailable? (que ficariam inertes e ambíguos: "não
// buscado ainda" vs "palpite nunca captura"). Definir junto da tabela (schema)
// e reusar em insertPalpiteOutcomeIfAbsent (§3.5) e no retorno de §3.2.
// SEM validador Zod no read path: resultData é produzido internamente por
// resultDataFromRegulationScore (já validado upstream), não por output de LLM.
export type PalpiteResultData = {
  homeScore: number | null;
  awayScore: number | null;
  totalGoals: number;
};

export const palpiteOutcomes = pgTable("palpite_outcomes", {
  id: uuid().primaryKey().defaultRandom(),
  palpiteId: uuid()
    .notNull()
    .unique()
    .references(() => palpites.id, { onDelete: "cascade" }),
  resultData: jsonb().$type<PalpiteResultData>(),
  // Binário p/ palpite de placar: acertou (won) ou errou (lost). Reusa
  // outcomeResultEnum (db/schema.ts:38-48) restrito a won/lost no app — void/push
  // não se aplicam a placar exato. Sem profitUnits (sem stake — ADR 0028 §1).
  result: outcomeResultEnum().notNull(),
  overrideByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
  settledAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
```

**Tipos exportados** (convenção `lib/db/queries`, ex. `db/schema` +
`predictions.ts:26-29`):

```ts
// em lib/db/queries/palpites.ts (ou onde a query morar)
export type DbPalpiteSet = typeof palpiteSets.$inferSelect;
export type DbPalpite = typeof palpites.$inferSelect;
export type DbPalpiteOutcome = typeof palpiteOutcomes.$inferSelect;
```

### 1.4 Decisão do enum de resultado — reusar `outcomeResultEnum`, NÃO criar novo

`outcomeResultEnum` é `['won','lost','void','push']` (`db/schema.ts:38-48`). Para
placar exato só `won`/`lost` fazem sentido (`void`/`push` são semântica de
aposta: stake devolvido / empate na linha — não há linha num palpite de placar).

**Decisão: reusar `outcomeResultEnum` e restringir a `won`/`lost` no nível de
aplicação** (o compare de §3 só emite esses dois). Justificativa: criar um
`palpiteResultEnum` separado duplicaria o domínio sem ganho — a coluna persiste
o mesmo `pgEnum` que `prediction_outcomes.result` já usa, e a restrição
won/lost é uma invariante de código (o palpite-rule só retorna esses dois),
exatamente como `push` está no enum mas "nenhum caminho de código o EMITE" hoje
(`db/schema.ts:42-47`). Não há ALTER TYPE.

> **Por que NÃO é contaminação de valor** (blocker dismissado na revisão): um
> enum é um *vocabulário*, não uma *coluna* de valor. A regra "nenhuma coluna de
> valor" do ADR 0028 §1 enumera `edge_pct`/`stake_units`/`implied_prob_pct`/`odd_*`
> — `void`/`push` são *membros* de enum nunca usados, nunca colunas. Se o motor de
> valor um dia adicionar um membro, ele simplesmente permanece **inalcançável**
> pra palpite (como `push` é hoje). Disjunção não ganha nada com um enum paralelo
> a manter em sincronia.

> **Hardening (obrigatório):** o tipo TS da coluna `result` e **todas** as
> assinaturas de função de palpite (§3.2, §3.5, §4) usam o literal estreito
> **`"won" | "lost"`**, NUNCA a união completa `DbOutcomeResult`. Assim um
> `void`/`push` perdido vira **erro de tipo** em cada boundary de palpite.

> **verify during implementation:** confirmar que `drizzle-kit` não tenta
> recriar o enum ao reusá-lo numa tabela nova (deve só referenciar o tipo
> existente). Se gerar DDL inesperado, inspecionar o `.sql` antes de aplicar.

### 1.5 `relations()` — NÃO adicionar

**O repo NÃO usa `relations()` em lugar nenhum** (grep `relations` em
`db/schema.ts` → 0 hits; nenhum arquivo de relations existe). Os joins são
explícitos via `.leftJoin`/`.innerJoin` nas queries (ex.:
`predictions.ts:103-108`, `:207-217`). **Não inventar blocos `relations()`** —
seguir a convenção real do código (o contexto da issue mencionou relations, mas
o código é a fonte da verdade). Joins de palpites são explícitos na query (§4).

---

## 2. Seed dos tipos v1

**Decisão: NÃO há tabela de catálogo a seedar.** O `type` é enum (§1.1) e
`settleable` é um bit por LINHA de palpite (`palpites.settleable`), não um
atributo de catálogo. Diferente de `markets`/`market_selections`, que **precisam**
de rows seedadas porque são tabelas de referência com FK
(`db/migrations/0014_small_nomad.sql:10-18` mostra o padrão DML idempotente
appendado).

**Consequência prática:** a migration de 0034 é **schema-only** (CREATE TYPE +
CREATE TABLE), **sem INSERT de seed**. A semântica "exact_score é settleable, o
resto não" é aplicada por quem **escreve** o palpite (#315), gravando
`settleable=true` só no `exact_score`. A migration não tem como (nem deve)
materializar linhas de palpite — palpites são dados dinâmicos por (match, user),
nunca estáticos (gotcha confirmado: "Do NOT hardcode seedData in migrations for
palpites").

> Se durante #315 ficar claro que a UI precisa enumerar os tipos disponíveis +
> seus rótulos antes de qualquer palpite existir, isso é um **catálogo de
> apresentação** (TS em `lib/`, padrão `presentation.ts`), não DB. Fora do escopo
> de #314.

---

## 3. Caminho de settlement de placar exato

### 3.1 Onde vive

Função NOVA, **separada de `settlePendingPredictions`** — preserva a
ortogonalidade (gotcha confirmado: "NÃO estender `settlePendingPredictions` com
lógica condicional — risco de contaminar o fluxo de predictions").

- Regra pura de compare: `lib/settlement/rules/exact_score_palpite.ts` (novo).
- Orquestrador: `lib/settlement/settle-palpites.ts` (novo) OU uma função
  `settlePendingPalpites` em `lib/settlement/settle.ts`. **Preferir arquivo
  novo** para isolar imports e testes.
- Query pending: `getPendingPalpiteSettlements` em `lib/db/queries/palpites.ts`.
- Write idempotente: `insertPalpiteOutcomeIfAbsent` em
  `lib/db/queries/palpite-outcomes.ts` (espelha `prediction-outcomes.ts:24-38`).

### 3.2 O compare direto (sem grade)

Reusa `resultDataFromRegulationScore` (`lib/settlement/schemas.ts:75-84`) para
obter `{homeScore, awayScore, totalGoals}` do `regulationScore` (90', sem
ET/pênaltis). O compare é **estrutural e direto**, sem o curto-circuito
`homeScore>3 || awayScore>3 → lost` do `correctScoreRule`
(`lib/settlement/rules/correct_score.ts`):

```ts
// lib/settlement/rules/exact_score_palpite.ts
import { z } from "zod";
import type { ResultData } from "@/lib/settlement/schemas";
import { SettlementError } from "@/lib/settlement/schemas";

// {home, away} do palpite — inteiros >= 0. Distinto do correctScoreRule: SEM a
// grade 0-3, um 4-1 liquida normalmente (ADR 0028 §3).
const ExactScoreParamsSchema = z.object({
  home: z.number().int().nonnegative(),
  away: z.number().int().nonnegative(),
});

// "won" sse o placar palpitado == placar de 90', senão "lost". NUNCA void/push
// (não há linha). Lança SettlementError em params/score inválidos → o
// orquestrador bucketa em errors e deixa PENDING (prefer-skip).
export function settleExactScorePalpite(
  params: unknown,
  resultData: ResultData,
): "won" | "lost" {
  const parsed = ExactScoreParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new SettlementError("invalid exact_score palpite params", {
      issues: parsed.error.issues,
    });
  }
  // Defense-in-depth. Em operação normal o orquestrador (§3.3, espelho de
  // settle.ts:166-171) já filtra `!result.regulationScore → skipped` ANTES de
  // chamar esta regra, então este throw NUNCA dispara ao vivo — ele guarda só
  // resultData corrompido/backfilled. homeScore/awayScore vêm de
  // resultDataFromRegulationScore → sempre não-null no caminho ao vivo.
  if (resultData.homeScore === null || resultData.awayScore === null) {
    throw new SettlementError("missing 90' split for exact_score palpite");
  }
  return parsed.data.home === resultData.homeScore &&
    parsed.data.away === resultData.awayScore
    ? "won"
    : "lost";
}
```

> **NÃO** registrar isso no `REGISTRY` de `lib/settlement/registry.ts:25-33` —
> aquele registry é dispatch de mercado de VALOR por `settlement_rule_key`.
> Palpite tem seu próprio caminho. (Reusar o registry reintroduziria o
> acoplamento que o ADR separa.)

### 3.3 Orquestrador `settlePendingPalpites`

Espelha o esqueleto de `settlePendingPredictions`
(`lib/settlement/settle.ts:83-249`): memoiza `getFixtureResult` por matchId,
filtra `status==='finished' && regulationScore`, computa, grava idempotente.
**Reusa o MESMO provider** (`getSportsDataProvider()`, `settle.ts:100`) — sem
fetch novo dedicado por design, mas com seu próprio `resultByMatch` Map (não
compartilha estado com o loop de predictions).

**Padrão de memoização (copiar `settle.ts:104-125` verbatim):** `resultByMatch`
é um `Map<string, NormalizedFixtureResult | null | undefined>` com **três
estados distintos** — `undefined` = lookup ainda não tentado (chave ausente do
Map); `null` = provider tentou e não retornou resultado → bucketa em **`errors`**;
objeto presente mas `!finished`/`!regulationScore` → **`skipped`**. Não colapsar
`undefined` e `null` no mesmo branch (seria re-fetch infinito ou contagem errada).

```ts
// lib/settlement/settle-palpites.ts
export type PalpiteSettlementSummary = {
  considered: number;
  settled: number;
  alreadySettled: number;
  skipped: number;   // jogo não-finalizado / sem regulationScore
  errors: number;    // provider falhou / score malformado / params inválidos
  byResult: { won: number; lost: number };
};

export async function settlePendingPalpites(
  now: Date = new Date(),
): Promise<PalpiteSettlementSummary> {
  // 1. const pending = await getPendingPalpiteSettlements(now);  // §3.4
  // 2. resultByMatch = new Map<string, NormalizedFixtureResult|undefined|null>()
  //    (mesmo loop de settle.ts:104-125, mesmo provider singleton)
  // 3. para cada palpite pendente:
  //    - result null  → errors++ (provider falhou)
  //    - !finished / !regulationScore → skipped++  (settle.ts:166-171)
  //    - try: resultData = resultDataFromRegulationScore(result.regulationScore)
  //           result = settleExactScorePalpite(p.params, resultData)  // §3.2
  //      catch SettlementError → errors++, log, continue  (settle.ts:205-217)
  //    - inserted = await insertPalpiteOutcomeIfAbsent({ palpiteId, resultData, result })
  //    - inserted ? settled++/byResult[result]++ : alreadySettled++
}
```

`SETTLEMENT_MIN_ELAPSED_MS` (150 min, `predictions.ts:158`): **decisão final —
exportar da casa atual** (`predictions.ts`/`settle.ts:158`) e **importar** em
`getPendingPalpiteSettlements`. **NÃO duplicar** o magic number (mesmo cutoff: 90'
já decorreram; uma fonte única evita drift entre os dois caminhos de settlement).

### 3.4 Query pending — `getPendingPalpiteSettlements`

Em `lib/db/queries/palpites.ts`. Espelha `getPendingSettlementPredictions`
(`predictions.ts:186-222`):

```ts
export type PendingPalpiteSettlement = {
  palpiteId: string;
  params: DbPalpite["params"];
  matchId: string;
  league: DbMatch["league"];
  kickoffAt: Date;
  homeTeam: string;
  awayTeam: string;
};

export async function getPendingPalpiteSettlements(
  now: Date = new Date(),
): Promise<PendingPalpiteSettlement[]> {
  const cutoff = new Date(now.getTime() - SETTLEMENT_MIN_ELAPSED_MS);
  return db
    .select({ /* palpiteId, params, matchId, league, kickoffAt, homeTeam, awayTeam */ })
    .from(palpites)
    .innerJoin(palpiteSets, eq(palpites.palpiteSetId, palpiteSets.id))
    .innerJoin(matches, eq(palpiteSets.matchId, matches.id))
    .leftJoin(palpiteOutcomes, eq(palpiteOutcomes.palpiteId, palpites.id))
    .where(
      and(
        eq(palpites.type, "exact_score"),   // só placar
        eq(palpites.settleable, true),      // defense-in-depth (ADR 0028 §3)
        isNull(palpiteOutcomes.id),         // ainda não liquidado / não overridden
        lt(matches.kickoffAt, cutoff),
      ),
    )
    .orderBy(desc(matches.kickoffAt));
}
```

> O filtro `type='exact_score' AND settleable=true` é o **gate que honra "prefer
> skip over silent wrong settle"**: `red_card`/`corners`
> (`settleable=false`) **nunca** entram no pending set, nunca recebem outcome.

### 3.5 Write idempotente — `insertPalpiteOutcomeIfAbsent`

Espelha `insertOutcomeIfAbsent` (`prediction-outcomes.ts:24-38`) — mesmo
`onConflictDoNothing` na coluna UNIQUE, `.returning()` → boolean:

```ts
export async function insertPalpiteOutcomeIfAbsent(args: {
  palpiteId: string;
  resultData: PalpiteResultData;   // tipo nomeado estreito (§1.3)
  result: "won" | "lost";          // literal estreito, NUNCA DbOutcomeResult (§1.4)
}): Promise<boolean> {
  const inserted = await db
    .insert(palpiteOutcomes)
    .values({ palpiteId: args.palpiteId, resultData: args.resultData, result: args.result })
    .onConflictDoNothing({ target: palpiteOutcomes.palpiteId })
    .returning({ id: palpiteOutcomes.id });
  return inserted.length > 0;
}
```

> **Idempotência:** `palpite_outcomes.palpiteId` é UNIQUE (§1.3) — re-rodar o
> cron no mesmo jogo é no-op (mesmo contrato de `prediction_outcomes`,
> `prediction-outcomes.ts:19-23`). Sem `profitUnits` no insert (não existe).

### 3.6 Plug no cron — SEM tocar o loop de predictions

A rota `app/api/cron/settle-predictions/route.ts:27-29` chama hoje só
`settlePendingPredictions()`. **Adicionar uma 2ª chamada sequencial DENTRO do
mesmo `try { ... } catch → 500`** (preservar o guard de auth/secret e o catch
existentes), e incluir o summary de palpites na resposta:

```ts
// dentro do try existente (qualquer throw → um único 500, comportamento atual)
const summary = await settlePendingPredictions();
const palpiteSummary = await settlePendingPalpites();   // NOVO
return NextResponse.json({ ok: true, summary, palpiteSummary });
```

**Contrato de erro = all-or-nothing (decisão final, não relitigar):** um throw em
qualquer dos dois aborta o request inteiro (500), consistente com o que
predictions já faz hoje; o Vercel re-tenta o cron — **seguro porque ambos os
caminhos são idempotentes** (`onConflictDoNothing` na coluna UNIQUE). **NÃO**
engolir o erro de palpite num 200 de meia-vitória — um 500 honesto mantém o sinal
de falha do cron. (A alternativa "half-success 200" foi explicitamente rejeitada.)

- Sequencial (não paralelo) para não duplicar pressão no provider / quota.
- O loop de predictions **não é tocado** — `settlePendingPalpites` é
  ortogonal, próprio Map, próprio pending set.
- **Decisão default: reusar a rota** existente (menor diff, sem quota extra — o
  provider cacheia por `FixtureRef`). Se algum dia preferir rota separada
  (`/api/cron/settle-palpites`), registrar o cron em `vercel.json`.

---

## 4. `getPalpiteSetsForMatch` — query de leitura

Em `lib/db/queries/palpites.ts`. Espelha `getPredictionHistoryForMatch`
(`predictions.ts:91-153`): escopo `(matchId AND userId)`, ordem newest-first
determinística `desc(createdAt), desc(id)`, sem LIMIT, batch das linhas via
`inArray` para evitar N+1.

```ts
export type PalpiteSetWithLines = {
  palpiteSet: DbPalpiteSet;
  aiCall: DbAiCall | null;         // nullable (aiCallId nullable §1.3)
  palpites: (DbPalpite & {
    outcome: { result: "won" | "lost" } | null;  // null em settleable=false ou ainda-pendente
  })[];
};

export async function getPalpiteSetsForMatch(
  matchId: string,
  userId: string,
): Promise<PalpiteSetWithLines[]> {
  // Query 1: sets + aiCall (LEFT join — aiCallId nullable)
  const sets = await db
    .select({ palpiteSet: palpiteSets, aiCall: aiCalls })
    .from(palpiteSets)
    .leftJoin(aiCalls, eq(palpiteSets.aiCallId, aiCalls.id))
    .where(and(eq(palpiteSets.matchId, matchId), eq(palpiteSets.userId, userId)))
    .orderBy(desc(palpiteSets.createdAt), desc(palpiteSets.id));
  if (sets.length === 0) return [];

  // Query 2: linhas + outcome BATCHEADAS via inArray(setIds) — sem N+1
  const setIds = sets.map((s) => s.palpiteSet.id);
  const lines = await db
    .select({ palpite: palpites, outcomeResult: palpiteOutcomes.result })
    .from(palpites)
    .leftJoin(palpiteOutcomes, eq(palpiteOutcomes.palpiteId, palpites.id))
    .where(inArray(palpites.palpiteSetId, setIds))
    .orderBy(asc(palpites.palpiteSetId), asc(palpites.createdAt), asc(palpites.id));

  // agrupa por palpiteSetId num Map (mesmo padrão de selByPrediction, :139-147)
}
```

Notas de fronteira:
- **`params` é jsonb tipado `{home, away}` (inteiros)** — sem coluna numeric, o
  gotcha drizzle-numeric-returns-string **não se aplica** (ADR 0028 §1: palpite
  tem zero colunas numeric). Se algum dia uma linha ganhar jsonb com string
  numérica, criar mapper análogo a `mapSelectionRow`. Por ora, render direto.
- `aiCall` pode ser `null` (aiCallId nullable). O consumidor (#316) trata.
- Retorna **sempre `[]`** quando vazio (nunca `null`).
- Consumida por #316 (UI) e pelo gerador de #315 (contexto de exclusão).

> **Handoff pro #315 (fora do escopo de #314, registrado pra não se perder):**
> (a) o gerador precisa de um **bucket de rate-limit próprio** `ratelimit:palpites`
> em `lib/rate-limit.ts` (ADR 0028 §5 — NÃO drenar a cota de 20/dia das análises);
> (b) o `params` jsonb é escrito por output de LLM, então #315 valida na escrita
> com um `ExactScoreParamsSchema` Zod (a regra de settlement §3.2 só revalida como
> defense-in-depth). Ambos são responsabilidade do #315, citados aqui como ponte.

---

## 5. Migration + testes pglite

### 5.1 Migration

1. Adicionar todo o schema (§1) em `db/schema.ts`.
2. `pnpm db:generate` → gera `0034_<sufixo_random>.sql` (próximo livre; journal
   atual termina em idx=33, `db/migrations/meta/_journal.json`).
3. **Inspecionar o `.sql` gerado** antes de aplicar: deve conter `CREATE TYPE
   "public"."palpite_type"`, 3 `CREATE TABLE`, os índices, e as FKs com o
   `onDelete` certo. **Confirmar que NÃO recria `outcome_result`** (§1.4) —
   se recriar, parar e investigar.
4. **Sem seed DML** (§2) — migration é schema-only.
5. `pnpm db:migrate` em dev para validar.

### 5.2 Testes pglite

Seguir o harness existente (`get-prediction-history.pglite.test.ts:1-58`):
`// @vitest-environment node` na 1ª linha, `new PGlite()`, `drizzle(client,
{schema, casing:'snake_case'})`, `migrate(base, {migrationsFolder:
'./db/migrations'})` em `beforeAll` (1x), Proxy mock de `@/lib/db`, shim
`db.batch` sequencial se necessário, `.returning({id})` + destructure para seeds.

> **Ordem de seed (FKs):** `users → matches → aiCalls → palpite_sets →
> palpites → palpite_outcomes`. Seeds de `palpite_sets` **DEVEM** popular
> `modelVersion` + `promptVersion` (são `notNull` — seed sem eles falha). O
> provider de settlement é mockado via o mesmo padrão de
> `settle-golden.pglite.test.ts` (mock de `getSportsDataProvider`/`getFixtureResult`).

**Arquivo A — `lib/db/queries/__tests__/get-palpite-sets-for-match.pglite.test.ts`**
(query de leitura). Casos:
- Escopo por `userId` (set de outro user NÃO vaza — espelha AC2 do template).
- Escopo por `matchId` (set de outro jogo do mesmo user não vaza).
- Ordem newest-first + tiebreak `desc(id)` em createdAt empatado.
- Set com `aiCallId = null` volta com `aiCall: null` (divergência nullable).
- Set com 2 linhas (1 `exact_score` settleable + 1 `red_card` não-settleable)
  volta ambas, agrupadas; outcome só na settleable quando liquidada.
- Sem palpites → `[]`.

**Arquivo B —
`lib/settlement/__tests__/settle-palpites.pglite.test.ts`** (settlement). Mockar
o provider (`getSportsDataProvider`) como em
`settle-golden.pglite.test.ts:147-160`. Casos (todos seedam match finished +
palpite exact_score settleable):
- **Hit:** palpite `2-1`, regulationScore `2-1` → outcome `won`,
  `settled=1`, `byResult.won=1`.
- **Miss:** palpite `2-1`, regulationScore `0-0` → outcome `lost`.
- **Out-of-grid 4-1 liquida:** palpite `4-1`, regulationScore `4-1` → `won`
  (prova que NÃO há limite de grade 0-3 — o caso que `correctScoreRule`
  trataria como `lost` por curto-circuito). Espelhar com `4-1` vs `4-2` → `lost`
  (placar fora da grade que NÃO bate ainda liquida como lost, não fica pending).
- **ET/pênaltis → fica PENDING:** jogo decidido na prorrogação. Mockar
  `regulationScore` = placar de 90' e o "final" diferente; **confirmar que o
  compare usa SÓ `regulationScore`** (90'), nunca ET/pens. Se `regulationScore`
  é null (split indisponível) → `skipped`, nenhum outcome
  (`settle.ts:168-171`).
- **`settleable=false` NUNCA liquida:** seedar um palpite `red_card`
  (`settleable=false`) num jogo finished → `getPendingPalpiteSettlements` não o
  retorna → `considered` não o conta, zero outcome. (Provar pelo filtro da query
  E pela ausência de row em `palpite_outcomes`.)
- **Idempotência:** rodar `settlePendingPalpites` 2x no mesmo jogo →
  2ª run `settled=0, alreadySettled=1`, e a row de outcome não muda.

> Rodar local com `pnpm test --no-file-parallelism` (flake de pglite beforeAll em
> máquina 8-core; CI 2-core não precisa). `@vitest-environment node` é
> obrigatório (pglite falha sob jsdom).

---

## 6. Landmines

1. **Renumeração concorrente de migration + worktree (sessão paralela ativa).**
   Existe sessão paralela compartilhando o worktree. Trabalhar em **worktree
   isolado** (`pnpm install --ignore-workspace` — o `pnpm-workspace.yaml` stub
   torna o install no-op contra `node_modules` stale). Se outra PR pegar o 0034
   antes: **merge main → tomar journal+snapshot deles → dropar a sua migration →
   `pnpm db:generate` pro próximo número → verificar → mergear rápido** (ritual
   de renumeração concorrente já documentado na memória do repo). NUNCA
   hand-number.
2. **`aiCallId` NULLABLE em `palpite_sets`** — divergência DELIBERADA vs
   `predictions.aiCallId` `.notNull()` (`db/schema.ts:264-266`). Não copiar o
   `.notNull()` no piloto automático. `getAiCallById(null)`/LEFT join devolvem
   `null` graciosamente; o consumidor trata.
3. **Fronteira numeric-string** — `palpites` tem **zero colunas numeric** (ADR
   0028 §1), então o gotcha drizzle-numeric-returns-string é moot AQUI. Mas a
   tentação de adicionar uma coluna de "probabilidade/odd/edge" é exatamente o
   que o ADR proíbe — **resistir**. `params` jsonb guarda inteiros
   (`{home, away}`), não strings.
4. **neon-http batch (sem `db.transaction`)** — produção (neon-http) só faz
   `db.batch` atômico de statements independentes; **não** suporta
   `db.transaction` nem `.returning()` dentro de batch. As funções de palpite
   usam inserts simples com `.onConflictDoNothing().returning()` (igual
   `prediction-outcomes.ts`), o que é compatível. Nos testes pglite, instalar o
   shim `db.batch` sequencial se alguma query o usar.
5. **NÃO reusar `correctScoreRule` nem o `REGISTRY`** — o compare de placar é uma
   função NOVA (§3.2) sem grade. Plugar no registry de valor reacoplaria os
   domínios que o ADR 0028 separa.
6. **`settleable=false` é gate duplo** — filtrado na query pending (§3.4) E
   defendido pelo `type='exact_score'`. Nunca confiar só num. Um seed/escrita
   errada (settleable=true num red_card) ainda seria barrada pelo filtro de
   `type` no cron de placar.

---

## 7. Sequência de commits pequenos

Branch a partir de `main` (não commitar em main direto).

1. **`feat(db): schema + migration 0034 do dominio de palpites`** — §1 em
   `db/schema.ts` (enum + 3 tabelas + índices + `PalpiteResultData`) **E** a
   migration na MESMA commit: editar schema → `pnpm db:generate` → **inspecionar
   o `.sql`** (§5.1) → `pnpm db:migrate` local → commitar `.sql` + journal +
   snapshot + schema **juntos**. (Schema sem o `.sql` gerado é estado
   intermediário não-deployável — `drizzle.config` `strict`; reviewers veem o
   conjunto atômico.) `pnpm typecheck`.
2. **`feat(db): getPalpiteSetsForMatch + tipos`** — §4 em
   `lib/db/queries/palpites.ts` (+ tipos exportados). `pnpm typecheck`/`lint`.
3. **`feat(settlement): regra de placar exato de palpite (compare direto, sem grade)`**
   — §3.2 `lib/settlement/rules/exact_score_palpite.ts`. Teste unitário puro
   opcional (compare hit/miss/4-1) além do pglite.
4. **`feat(settlement): pending query + write idempotente de palpite_outcomes`**
   — §3.4 (`getPendingPalpiteSettlements`, importando `SETTLEMENT_MIN_ELAPSED_MS`)
   + §3.5 (`insertPalpiteOutcomeIfAbsent` em
   `lib/db/queries/palpite-outcomes.ts`).
5. **`feat(settlement): orquestrador settlePendingPalpites + plug no cron`** —
   §3.3 (`lib/settlement/settle-palpites.ts`) + §3.6 (2ª chamada em
   `route.ts`).
6. **`test(db): pglite de getPalpiteSetsForMatch`** — §5.2 arquivo A.
7. **`test(settlement): pglite de settle-palpites (hit/miss/4-1/ET/non-settleable/idempotência)`**
   — §5.2 arquivo B.

Gate de cada PR: `pnpm typecheck && pnpm lint && pnpm test --no-file-parallelism
&& pnpm build` verdes + checks de CI (typecheck+lint+test). Fechar #314 só após
verde e migration aplicada (prod deploy é o gate real da migration).

---

## 8. Critério de saída (#314)

- [ ] `palpite_sets`/`palpites`/`palpite_outcomes` + `palpiteTypeEnum` em
      `db/schema.ts`; `aiCallId` NULLABLE; `modelVersion`/`promptVersion`
      **notNull** em `palpite_sets`; zero colunas de valor.
- [ ] Migration 0034 gerada (não hand-numbered), schema-only, aplicada.
- [ ] `getPalpiteSetsForMatch(matchId, userId)` ordena `desc(createdAt),
      desc(id)`, escopada por user+match, batch sem N+1.
- [ ] Caminho de placar exato: compare direto sem grade, idempotente, plugado no
      cron SEM tocar o loop de predictions; `settleable=false` nunca liquida.
- [ ] Testes pglite (leitura + settlement: hit/miss/4-1/ET-pending/non-settleable/idempotência)
      verdes com `--no-file-parallelism`.
- [ ] Sem geração LLM (#315) nem UI (#316) — fora de escopo.
