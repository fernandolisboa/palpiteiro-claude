# ADR 0006 — Suporte à Copa do Mundo 2026 como 3ª liga

## Status

Accepted (2026-06)

## Contexto

A issue #38 (reativação da #29) pede suporte à Copa do Mundo 2026 (`world_cup`)
como liga apostável, somando-se a Brasileirão A e Champions League. A ADR-0005
deixou um gatilho explícito de **reavaliação** ("quando adicionar uma 3ª liga,
verificar se a estratégia de mapas estáticos `team-ids.ts` ainda é tratável") —
esta ADR responde esse gatilho e documenta as decisões específicas de torneio
que a Copa força.

A Copa tem três peculiaridades em relação a ligas de clube:

1. **Sem cobertura de lesões** na API-Football para a competição.
2. **Splits home/away nulos** na classificação (campo neutro / pré-torneio).
3. **Calendário de torneio**, não de temporada contínua.

## Decisão

### 1. Copa do Mundo como 3ª liga suportada (`world_cup`)

Mudança **aditiva**. API-Football é o provider primário (league id 1, season
2026); football-data.org é o fallback (code `WC` / id 2000). A reavaliação da
ADR-0005 é respondida: **SIM, ainda tratável** — ~104 times por provider no
total (20 Brasileirão + 36 Champions + 48 seleções), muito abaixo do limiar de
>200 que justificaria a alternativa B (tabela DB). Mantemos a estratégia de
mapas estáticos `team-ids.ts` da ADR-0005 (opção A). Drift de nome entre
providers (ex.: "Czechia" vs "Czech Republic" em seleções) é reconciliado via
`TEAM_NAME_ALIASES` em `team-names.ts`, exatamente como nas ligas existentes.

### 2. Lesões indisponíveis na Copa → `SportsDataUnsupportedError`

Confirmado **estrutural**, não pré-torneio: o campo `coverage.injuries` do
endpoint `/leagues` é `false` em TODAS as edições (2010, 2014, 2018, 2022,
2026) e `/injuries?league=1` retorna 0 linhas. Ligas de clube no mesmo plano
Pro reportam `injuries=true`, então não é "torneio ainda não começou".
football-data.org free também não tem lesões.

**Decisão:** o adapter da API-Football lança `SportsDataUnsupportedError` em
`getInjuriesByFixture`/`getInjuriesByTeam` quando `league === "world_cup"`,
roteando pela máquina de capability/fallback existente (ADR-0005). Como nenhum
provider satisfaz o gate de injuries para a Copa, o erro borbulha sem cascade;
`predict.ts` o captura e define `absences_available=false` ("dados
indisponíveis"). Isso evita o caminho de lista vazia, que o modelo leria como
"elenco saudável" — uma afirmação falsa.

Lineups são diferentes: `coverage.lineups` é `true` nas Copas passadas
(2010–2022) e só `false` em 2026 no estado pré-torneio → o endpoint popula
~1h antes do jogo. Sem tratamento especial; o caminho normal de `getLineups`
serve a Copa.

### 3. PROMPT_VERSION permanece `over_under_v1.1`

Nenhuma mudança de prompt foi necessária. O branch `!absences_available`
("dados indisponíveis") já existia no prompt desde a ADR-0005; a Copa apenas o
exercita. O nome da competição já chega ao modelo via `input.match.league`, sem
ramo novo. Não há bump de versão e, portanto, nenhum commit `prompt:`.

### 4. Standings com splits null

A Copa retorna `home`/`away` splits nulos (jogos em campo neutro e estado
pré-torneio). O schema e o normalizer da API-Football toleram isso: `home`/`away`
são `NormalizedStandingSplit` **opcionais**, então `toNormalizedSplit` omite o
split quando o objeto ou qualquer campo é nulo, em vez de emitir nulls.

### 5. Odds via `soccer_fifa_world_cup`

`world_cup` mapeia para a sport key `soccer_fifa_world_cup` (The Odds API),
confirmada ativa com mercado totals/2.5 (2026-06). Para fechar a brecha de duas
fontes de verdade, as duas funções `leagueToSportKey` foram consolidadas num
único `Record<SupportedLeague, SportKey>` exaustivo em `odds-api-constants.ts`,
garantindo cobertura compile-time de toda liga suportada.

## Razão

A Copa não exige nenhuma abstração nova — só estende as fronteiras já desenhadas
na ADR-0005 (interface por nome canônico, hierarquia de erros como contrato de
cascade, capability flags). O ponto delicado é não tratar "sem dados de lesão"
como "sem lesões". `SportsDataUnsupportedError` é exatamente o sinal que a
ADR-0005 reservou para cobertura assimétrica, então reusá-lo aqui mantém o
fluxo num único lugar (a máquina de capability/fallback) em vez de espalhar
condicionais de Copa por `predict.ts`.

Manter `PROMPT_VERSION` evita poluir a rastreabilidade de prompts com um bump
vazio: a semântica de "dados indisponíveis" não mudou, só ganhou um novo
disparador.

## Alternativas consideradas

- **Lesões da Copa via lista vazia** (deixar `getInjuriesByFixture` retornar
  `{home:[],away:[]}`): rejeitada — o modelo interpretaria como elenco íntegro,
  enviesando a análise para over. `SportsDataUnsupportedError` preserva a
  distinção entre "indisponível" e "vazio".
- **Migrar para tabela DB `team_provider_ids`** (alternativa B da ADR-0005)
  agora que há 3 ligas: rejeitada — ~104 times/provider continua trivial de
  manter como mapa estático; a migration só se paga acima de ~200 times.
- **Provider dedicado de lesões para seleções**: rejeitada — fora de escopo,
  exigiria ADR própria (regra: novo provider de dados precisa de ADR) e nenhuma
  fonte free conhecida cobre lesões de Copa de forma confiável.
- **Bump de PROMPT_VERSION para `over_under_v1.2`**: rejeitada — sem mudança
  textual no prompt, o bump só adicionaria ruído ao histórico `prompt:`.

## Consequências

- (+) Copa do Mundo 2026 totalmente apostável reusando toda a infra da ADR-0005;
  custo de adicionar a liga foi quase só dados (mapas + canonical names).
- (+) `absences_available=false` na Copa dá ao modelo um sinal honesto de
  incerteza em vez de uma falsa afirmação de elenco saudável.
- (+) `SPORT_KEY_BY_LEAGUE` exaustivo: adicionar uma 4ª liga sem mapear sport
  key passa a ser erro de compilação.
- (−) Lineups da Copa só existem ~1h antes do jogo; análises rodadas cedo demais
  ficam sem escalação confirmada (degradação graciosa, não erro).
- (−) Os mapas estáticos da ADR-0005 cresceram ~48 entradas por provider;
  `scripts/generate-team-ids.ts` continua sendo o caminho idempotente de
  regeneração quando seleções renomeiam.

## Reavaliação

- Quando adicionar uma **4ª liga**, reavaliar de novo o limiar de mapas
  estáticos (alvo: alternativa B da ADR-0005 acima de ~200 times totais).
- Se a API-Football ou outro provider passar a expor lesões de seleções em
  edição futura de Copa — remover o gate `world_cup` em
  `getInjuriesBy*` e reavaliar `absences_available` (e o impacto em
  PROMPT_VERSION, hoje `over_under_v1.1`).
- Se a Copa expuser lineups confirmados antes da janela de ~1h pré-jogo,
  reavaliar a TTL de cache de lineups para a competição.
