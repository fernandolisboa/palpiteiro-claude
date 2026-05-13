# ADR 0005 — Abstração de Sports Data Providers com Fallback Automático

## Status

Accepted (2026-05)

## Contexto

Até a issue #24, `lib/providers/api-football.ts` era a única fonte de jogos,
escalações, lesões, H2H e classificação. Dois riscos materializados:

1. **Single point of failure**: a conta API-Football foi suspensa por
   burst-detection durante o teste manual da issue #7. Quando isso acontece, o
   app inteiro trava — não há ninguém pra servir dados de jogo.
2. **Sem capacidade de combinar free tiers**: API-Football tem 100 req/dia;
   football-data.org tem 10 req/min sem cap diário. Usar os dois multiplicaria
   a janela operacional.

Era preciso (a) introduzir uma abstração que permitisse swap entre providers,
(b) adicionar um segundo provider real (football-data.org), e (c) compor os
dois com fallback automático em caso de falha do primário.

## Decisão

Adotar três design choices independentes:

### 1. Interface agnóstica de IDs nativos

`SportsDataProvider` em `lib/providers/sports-data/types.ts` recebe times por
**nome canônico** + `SupportedLeague`. Fixtures são identificadas por
**composite key** `${league}:${kickoffAtISO}:${home}:${away}`. Nenhum método
da interface expõe IDs nativos de provider. Cada adapter mantém um mapa
interno `canonical-name → provider-native team-id` em seu `team-ids.ts`.

### 2. Hierarquia de erros como contrato de cascade

Três classes de erro em `types.ts` definem o que o `FallbackProvider` decide
fazer ao recebê-las do adapter atual:

- `SportsDataTransientError` → cascade pro próximo adapter (5xx pós-retry,
  429 pós-retry, timeout, network error, schema drift, envelope error como
  "account suspended").
- `SportsDataNotFoundError` → NÃO cascade; bubble up (4xx ≠ 429: erro de input,
  o fallback não conseguiria atender também).
- `SportsDataUnsupportedError` → handled via capability gate; nunca alcança um
  adapter sem a capability.

Cada adapter mapeia seus erros internos (`ApiFootball*Error`,
`FootballDataOrg*Error`) pra esse contrato.

### 3. Capability flags para cobertura assimétrica

`ProviderCapabilities = { name, supportsInjuries, supportsLineups, supportedLeagues }`.
`FallbackProvider.capabilities` é a união:
- `name = fallback(<primary>,<fallback>)`
- `supportsInjuries`/`supportsLineups` = OR dos dois
- `supportedLeagues` = união

Métodos do `FallbackProvider` passam um `capabilityGate` que filtra os
candidatos. Para `getInjuriesByFixture`/`getInjuriesByTeam`, gateia em
`supportsInjuries`; pra `getLineups`, em `supportsLineups`; pra todos, em
`supportedLeagues`. Quando nenhum provider satisfaz o gate, lança
`SportsDataUnsupportedError`.

## Razão

### IDs canônicos via nome (em vez de tabela de mapeamento ou IDs primários)

Três opções foram consideradas:

- **(A) Nome canônico + liga** (adotada): cada adapter mapeia `canonical →
  native id` no seu próprio `team-ids.ts`. NormalizedFixture usa string pra
  homeTeam/awayTeam. Composite fixture key elimina IDs cross-provider.
  - Pro: interface limpa, zero acoplamento; sem migration de DB; fallback
    transparente (não traduz nada entre adapters).
  - Con: name drift entre providers requer maps por-adapter (custo: 2-3 dias
    de manutenção/ano por mudança raríssima).
- **(B) Tabela DB `team_provider_ids`**: mapeia canônico → IDs de cada provider.
  - Con: exige migration + seeding manual ou lazy; complexidade de manutenção
    desnecessária pra MVP de 2 ligas / ~50 times.
- **(C) IDs do primário viram canônicos + lookup-by-name no fallback**: fallback
  consome `{ home, away, kickoffAt }` da DB pra re-resolver.
  - Con: poluição de interface (hint param só em getFixtureById); problema de
    IDs mistos quando fallback ativa per-method (standings vem do primary mas
    H2H vem do fallback com IDs diferentes).

Opção A foi escolhida porque o scope do MVP (Brasileirão A + Champions
League, ~50 times totais) torna o custo de manter dois mapas estáticos
trivial, e a interface fica fundamentalmente mais limpa que B ou C.

### Cascade per-method (em vez de per-batch)

`FallbackProvider.withFallback` é per-method: cada chamada é dispatchada
primary-first com cascade se transient. Não há "trocar todo o batch quando
qualquer chamada falha".

Alternativa rejeitada (batch-level cascade): mais simples de raciocinar mas
trataria 1 falha intermitente como falha completa do primary — desnecessário.
A opção A (nome canônico) elimina o problema de IDs mistos que motivaria
batch-level, então per-method é a escolha natural.

### `SportsDataTransientError` em team-id-resolution failures

Quando o mapa estático do adapter não cobre um nome canônico (ex.:
`API_FOOTBALL_TEAM_IDS` vazio enquanto a conta tá suspensa), o método lança
**`SportsDataTransientError`** — não `SportsDataNotFoundError`. Justificativa:
da perspectiva do caller, um nome não mapeado é equivalente a um outage de
provider. Cascade pro fallback permite o sistema continuar operando enquanto
o map é populado.

Tradeoff: abuso semântico do tipo "transient". Mitigação: comentário explícito
no código em `resolveApiFootballTeamId` e este ADR.

### Cache key inclui prefix do provider

Toda key gerada por adapter tem o formato
`sports-data:<provider>:<endpoint>:<sorted-params>`. Evita colisões no shared
`InMemoryCacheStore` entre dados normalizados de fontes diferentes. Bônus:
`getH2H` e `getTeamForm` do football-data-org compartilham cache key
(`sports-data:football-data-org:teams:{id}:matches:limit:50:status:FINISHED`)
porque ambos batem no mesmo endpoint — segunda chamada é hit.

## Alternativas consideradas

- **Coordenador de fallback fora da interface** (helper que envolve calls do
  caller): rejeitada porque distribui a lógica de cascade entre múltiplos
  callers. Centralizar no `FallbackProvider` mantém um único lugar pra
  raciocinar sobre cascade.
- **Capability runtime checks** (perguntar pro provider "você suporta X?" antes
  de cada call): rejeitada por overhead — capability flags estáticas no
  `capabilities` são O(1) e nunca mudam pós-construção.
- **Auto-discovery de canonical names via fuzzy match em runtime**: rejeitada;
  mapas estáticos (`team-ids.ts`) são previsíveis, testáveis (regression test
  em `canonical-teams.test.ts`), e fáceis de auditar via diff.
- **Logging de fallback via `logCall` do quota-logger**: rejeitada;
  `fallback_activated` é um evento diferente (não tem `quota`, `endpoint`,
  `cache_hit`). Reusar a forma JSON mas como evento próprio.

## Consequências

- (+) Operação resiliente: app continua funcional quando primary falha
  transientemente.
- (+) Custo de adicionar um terceiro provider amanhã é só "implementar
  `SportsDataProvider`" + adicionar ao factory — interface é estável.
- (+) Cache compartilhado entre `getH2H` e `getTeamForm` no
  football-data-org reduz quota usage em pares de chamadas pra mesmo time.
- (−) Doublão de manutenção: o mapa `team-ids.ts` precisa ser regenerado
  quando providers renomeiam times. Mitigação: `scripts/generate-team-ids.ts`
  é idempotente; rodar quando warning aparece em `canonical-teams.test.ts`.
- (−) `SportsDataTransientError` é "abusado" pra config gaps em
  resolução de IDs. Risco baixo (sempre comentado, sempre detectável via
  log + monitoring de `fallback_activated` events).
- (−) `predict.ts` agora depende de canonical-team naming consistency. Drift
  raro mas possível; coberto por test de regressão.

## Reavaliação

- Quando adicionar uma 3ª liga (Premier League, Libertadores, etc.) — verificar
  se a estratégia de mapas estáticos ainda é tratável (>200 times pode justificar
  alternativa B).
- Se `fallback_activated` events virarem ruído (>10/dia em produção), avaliar
  promoção do fallback a primary até que o issue do primary seja resolvido.
- Se algum provider expor cobertura de injuries via plano pago — re-avaliar o
  flag `absences_available` e o impacto no PROMPT_VERSION (atualmente
  `over_under_v1.1`).
