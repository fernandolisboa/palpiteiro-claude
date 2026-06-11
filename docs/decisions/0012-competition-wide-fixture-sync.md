# ADR 0012 — Fetch de fixtures por competição+temporada inteira

## Status

Accepted (2026-06)

## Contexto

A issue #96 abre a sequência de date-range (issues #94–#99) que vai permitir o
usuário ver não só os jogos das próximas 24–48h, mas também jogos passados (com
placar) e janelas custom. Hoje a única porta de entrada pra listar jogos é
`getFixturesByDate(date, league)` — um fetch por dia. O sync
(`lib/sync/sync-upcoming-fixtures.ts`) itera `SYNC_HORIZON_DAYS` dias × ligas
ativas, fazendo N chamadas por liga pra cobrir a janela.

Esse modelo day-by-day acopla o **escopo de sincronização** à **janela de
exibição**: pra mostrar jogos de um intervalo maior, o sync precisaria iterar
mais dias, multiplicando chamadas a provider. Os free tiers são apertados
(API-Football 100 req/dia de baseline; football-data.org 10 req/min) — a chave
deste projeto opera num limite bem mais folgado (na casa de milhares/dia), mas
o princípio de não multiplicar chamadas à toa vale igual. Cada dia extra de
horizonte custava uma chamada por liga.

A API-Football já tinha uma função livre `getFixturesByLeague(leagueId, season)`
que devolve a competição inteira numa só chamada — ela só não estava exposta na
interface `SportsDataProvider`. Esta ADR registra a decisão de promover essa
capacidade pra interface (em ambos os providers) como passo preparatório; a
reescrita do sync pra usá-la é uma issue separada (#97).

## Decisão

### 1. Novo método de interface `getFixturesBySeason(league, season?)`

Adicionar à `SportsDataProvider` (em `lib/providers/sports-data/types.ts`):

```ts
getFixturesBySeason(
  league: SupportedLeague,
  season?: number,
): Promise<NormalizedFixture[]>;
```

Busca a competição+temporada **inteira numa única chamada** ao provider, em vez
de iterar dia a dia como `getFixturesByDate`. Quando `season` é omitido, o
adapter resolve a temporada corrente via `currentSeason` (leagues.ts) — a mesma
fonte de verdade que o resto do código usa. O output passa pelo **mesmo caminho
de normalização** (`toNormalizedFixture`) que `getFixturesByDate`, então ambas
as portas emitem fixtures idênticas.

### 2. Implementação por adapter

- **api-football**: envolve a função livre já existente
  `getFixturesByLeague(API_FOOTBALL_LEAGUE_IDS[league], season ?? currentSeason(league))`
  e normaliza com `toNormalizedFixture`. Zero duplicação — reusa o que o fetch
  por data já usava.
- **football-data.org**: usa o filtro `season` do v4 em
  `GET /v4/competitions/{code}/matches?season=YYYY` (ver verificação abaixo).
  Adicionado um helper interno `listCompetitionMatchesBySeason(league, season)`
  irmão do `listCompetitionMatches(league, dateFrom, dateTo)` já presente — a
  key de cache difere naturalmente porque o param `season` substitui
  `dateFrom`/`dateTo`, então leituras season-wide e day-window nunca colidem.
- **FallbackProvider**: delega seguindo o padrão idêntico dos outros métodos —
  `withFallback("getFixturesBySeason", gate por supportedLeagues, invoke)`.

### 3. football-data.org: filtro `season` vs janela de datas larga

**Verificado** na doc oficial do v4
(<https://docs.football-data.org/general/v4/competition.html>): o subrecurso
`GET /v4/competitions/{id}/matches` aceita o filtro `season` ("An integer, like
`[\d]{4}`", exemplo `/?season=2021`; "by default the current season is used").
São aceitos também `dateFrom`, `dateTo`, `stage`, `status`, `matchday`. Como o
`season` foi confirmado, adotamos ele (um inteiro de 4 dígitos = ano de início
da temporada, consistente com `currentSeason` em leagues.ts e com o param
`season` que `getStandings` já passava). Não foi preciso recorrer à alternativa
de uma janela `dateFrom`/`dateTo` larga cobrindo a temporada.

### 4. TTL do fetch season-wide

`listCompetitionMatchesBySeason` usa `ONE_HOUR` (espelhando `getStandings`), e
o api-football reusa o `ONE_HOUR` da função livre `getFixturesByLeague`. O
heurístico per-fixture de TTL curto (imminent/live) que `getFixturesByDate`
aplica **não** se aplica aqui: um payload de competição inteira mistura jogos
finished e futuros, então não há um TTL coletivo curto que faça sentido pro
bulk. O ajuste fino de janela imminent/live continua no caminho day-by-day.

## Escopo

Esta fatia **só faz o método existir e ser testado**. NÃO altera
`lib/sync/sync-upcoming-fixtures.ts` nem `lib/config/active-leagues.ts` — o sync
segue usando `getFixturesByDate`. A troca do sync pro fetch season-wide é a
issue #97.

Mudança **aditiva**, consistente com a ADR-0005: não adiciona market, liga nem
provider novo — só amplia a capacidade da interface estável. (A ADR-0005 já
previa que "o custo de adicionar capacidade amanhã é estável" desde que a
interface não exponha IDs nativos; `getFixturesBySeason` respeita isso —
recebe `SupportedLeague` + season, devolve `NormalizedFixture[]`.)

## Consequências

- (+) Uma chamada cobre a competição inteira, desacoplando o **escopo de sync**
  da **janela de exibição**: a #97 pode trocar N chamadas/dia por 1 chamada/liga
  reduzindo drasticamente o consumo de quota dos free tiers.
- (+) Habilita as issues de date-range (#98/#99 — janelas custom e jogos
  passados com placar) sem inflar o número de chamadas a provider.
- (−) A reescrita futura do sync (#97) vai **abandonar o fetch day-by-day** pra
  o caminho de sincronização — `getFixturesByDate` permanece pra lookups
  pontuais (getFixtureByMatch, lineups, settlement), mas deixa de ser o motor de
  sync.
- (−) **Limitação conhecida**: o lock in-memory de 1h do on-demand sync passará a
  guardar um fetch único mais pesado (a competição inteira) em vez de N fetches
  pequenos. Esse lock é process-scoped (vive no `InMemoryCacheStore` singleton) e
  **se perde em cold start** — dois cold starts concorrentes podem disparar dois
  fetches season-wide. O custo unitário é maior que no modelo antigo, mas ainda
  é 1 chamada/liga, e o cache de `ONE_HOUR` absorve o segundo. Promover o lock
  pra um store distribuído (Vercel KV) fica pra quando/se cold-start concorrência
  virar problema observável.

## Reavaliação

- Quando a #97 reescrever o sync: confirmar que o lock de 1h + cache `ONE_HOUR`
  são suficientes ou se o lock precisa migrar pra KV (cold-start concurrency).
- Se algum provider passar a paginar `/matches` por temporada (payloads grandes
  de temporada completa), revisitar a suposição de "1 chamada = competição
  inteira".

### Atualização — #124 (trigger do sync na home)

A home (`app/page.tsx`) disparava o sync só quando a query **filtrada** do range
retornava zero rows (`dbMatches.length === 0`). Com ~3 jogos da Copa já no DB,
esse length nunca era 0 → `ensureUpcomingFixturesSynced` nunca rodava → o
schedule completo da WC 2026 nunca carregava (todo preset mostrava os mesmos 3
jogos). A #124 removeu esse guard: o sync agora roda em **todo request** (sempre
`await`, best-effort com try/catch), deduplicado pelo lock processo-local de 1h
já existente — não pelo estado da query. A lógica vive num helper extraído
`lib/db/queries/load-range-matches.ts` (`loadRangeMatches`), testável por
module-mock sem importar o RSC.

A migração do lock per-instance → lock durável em KV + Vercel cron continua
sendo o follow-up **deferido** (mesma limitação de cold-start concurrency
registrada acima); a #124 não a endereça.

### Atualização — #126 (lock durável + sync fora do request path)

A #124 acertou a correção (72 jogos em vez de 3) mas o `await` em todo request
bloqueava a home ~45s em cada instância serverless fria — o lock in-memory se
perdia no cold start, então a instância re-rodava o fetch season-wide (o ~45s é
o caminho do PROVIDER, não o upsert, que já é um único insert multi-row em
batch). A #126 fecha o follow-up deferido acima:

- **Lock migrado pra KV durável** (`lib/sync/lock.ts`): `SET key stamp NX EX
  ttl` no Vercel KV (Upstash). `acquireSyncLock({ ttlMs, force })` → "OK" quando
  vence a corrida (`true`), `null` quando o NX falha (`false`); `force: true`
  dropa o `nx` e sempre sobrescreve (`true`). `releaseSyncLock` → `DEL`.
  **Fail-open** quando KV_REST_API_URL/KV_REST_API_TOKEN não estão setados
  (dev/test): cai no lock in-memory antigo, mesma semântica. Resolve a
  cold-start concurrency: o lock agora é compartilhado entre instâncias.
- **Sync fora do caminho do request**: a home (`load-range-matches.ts`) não dá
  mais `await` no sync — agenda via Next `after()` (pós-resposta, sem `force` →
  no-op enquanto o lock está segurado), então a query do DB retorna na hora. Um
  cron novo (`/api/cron/sync-fixtures`, `schedule "0 */6 * * *"`,
  `maxDuration=60`, auth Bearer `CRON_SECRET`) `force`-roda o sync a cada 6h e é
  o único caminho que come os ~45s do fetch.
- **TTL ≥ cadência do cron**: `SYNC_LOCK_TTL_MS = 7h` > os 6h do cron, então o
  lock fica continuamente segurado entre rodadas (cada cron `force`-refresca o
  TTL). Como o `force` bypassa qualquer lock, um TTL longo nunca causa deadlock.
- **Warm-up no deploy**: como o cron só roda a cada 6h, um deploy num DB fresco
  pode mostrar a home vazia até a primeira rodada. Disparar manualmente:
  `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/sync-fixtures`.

Sem novos secrets — reusa `KV_REST_API_URL`/`KV_REST_API_TOKEN`/`CRON_SECRET`.
