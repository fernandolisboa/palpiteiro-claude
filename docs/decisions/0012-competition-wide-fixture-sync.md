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
