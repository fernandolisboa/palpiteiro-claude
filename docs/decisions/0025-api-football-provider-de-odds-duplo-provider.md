# ADR 0025 — api-football como segundo provider de odds (duplo-provider): correct score + props + settlement Tier 3

**Data:** 2026-06-15  
**Status:** Aceito

## Contexto

Decisão **D10** do épico do pivot multi-mercado (#183): avaliar trocar ou
complementar a **The Odds API** pela **api-football** como provider de odds
(issue #181). Dois portões do `CLAUDE.md` autorizam este ADR: (a) ligar
mercados de **Tier 3** (correct score, player props) **exige ADR**; e (b) uma
**decisão técnica relevante nova** (adotar um provider de odds novo) se propõe
via ADR antes de implementar. Este ADR cobre ambos.

A motivação original (#181) tinha duas manchetes: (a) desbloquear **Tier 3**
(corners, cartões, player props, correct score) que a The Odds API não cobre, e
(b) ganhar **casas BR-facing** nos mercados *additional* — o gap observado na
validação **#158** (per ADR 0015): nos *additional* da **Copa 2026**
retornaram Pinnacle/William Hill/1xBet/Matchbook/Codere, **nenhuma casa
BR-facing** (Betano/bet365/Betfair), e a re-checagem do **Brasileirão ficou
pendente** pela pausa da Copa. A api-football é atraente por ser o **mesmo
vendor** que já fornece os dados esportivos
(`lib/providers/sports-data/api-football`, atrás do `FallbackProvider` do ADR
0005), prometendo odds **e** resultados de eventos de bola sob uma chave só.

Estado atual relevante:

- A The Odds API é o **único** provider de odds (`lib/providers/odds-api.ts`,
  free tier 500 **créditos**/mês — custo = `markets × regions`, não "500
  requests"). O dispatch *featured* (`/sports/{sport}/odds`, batch h2h/totals)
  vs *additional* (`/events/{id}/odds`, btts/dupla chance/alternate) é
  data-driven por `descriptor.oddsSource` em `lib/odds/fetch-and-snapshot.ts`.
- **Não existe** uma abstração `OddsProvider`: `fetch-and-snapshot.ts`,
  `lib/ai/predict.ts` e `lib/odds/select-bookmaker.ts` consomem diretamente o
  formato de fio do The Odds API (`OddsApiEventOdds`/`OddsApiOutcome`), e
  `lib/odds/market-descriptor.ts` é acoplado ao vocabulário do provider
  (`providerMarketKey` `'totals'`/`'h2h'`/`'btts'`…, `resolveSelectionKey`
  recebendo `OddsApiOutcome`).
- O **settlement** (`lib/settlement/settle.ts`) já usa
  `getSportsDataProvider()` (NÃO o odds client) pra ler o resultado — ou seja,
  é **provider-agnóstico de odds** e **desacoplado** desta decisão. O
  `result_data` hoje é o jsonb `{ homeScore, awayScore, totalGoals }`
  (`lib/settlement/schemas.ts`), montado 1× por jogo do placar de 90'
  (`resultDataFromRegulationScore`). `NormalizedFixtureResult` só carrega
  `{ status, regulationScore }`.

### Validação ao vivo (chave real do projeto, liga 71 = Brasileirão Série A, 2026-06-15)

Este estudo **não** se apoiou em docs/marketing: rodou ~40 requests de validação
contra a chave de produção da api-football (negligível no plano observado;
disciplina de quota respeitada — sem loops). Os achados abaixo são primários.

**1. Cobertura de odds pro Brasileirão — estreita e forward-only.**

- **Casas (achado decisivo):** apenas **3 books** cotam a liga 71 — **Bet365
  (8), 1xBet (11), Marathonbet (2)**. Filtros server-side confirmam ausência:
  `?league=71&bookmaker=32` (Betano) → `results:0`; Betfair(3), Pinnacle(4),
  Sportingbet(23), Superbet(34) → todos `0`, `errors:[]`; controle Bet365(8) →
  `results:10` (o filtro funciona). O catálogo global `/odds/bookmakers`
  (que **inclui** Betano/Betfair) é o universo da API, **não** a cobertura por
  liga. São a **mesma classe EU/global** que a The Odds API já alcança sob
  `region=eu`. → **api-football fecha ZERO do gap de casas BR (#158).**
- **Mercados:** o catálogo global `/odds/bets` é largo, mas a realidade da liga
  71 é mais fina. Tier 1/2 presente (1X2, gols O/U, BTTS, dupla chance,
  handicap). **Corners (`bet=45`) e cards (`bet=80`) retornam `0`** pro
  Brasileirão. Já **correct/exact score (`bet=10`, 30 cotações)** e
  **artilheiro/assistência (`92`/`93`/`212`)** ESTÃO cotados — só sob **Bet365**
  (cobertura de book único, cauda longa fina).
- **Frequência:** `/odds` pré-jogo atualiza a cada ~3h (docs: "1 call every 3
  hours"). Teste em 1077 fixtures mapeados mostra uma escada de refresh perto do
  KO (66% atualizados em ≤3h do KO) — refuta "atualiza 1×/dia". **Mas essa
  evidência é cross-league e NÃO foi observada pra liga 71** (sua única rodada
  com odds é 2026-07-22, 5+ semanas à frente pela pausa do Mundial de Clubes; 0
  fixtures em 14 dias), **nem pro único book relevante (Bet365)** — cadência de
  refresh é plausivelmente por liga/book. Risco **aceito sem teste prévio**
  (decisão do dono — ver Refino): se preço estale virar problema, trata-se como
  bug então.
- **Histórico:** **indisponível em qualquer plano** — retenção de **7 dias por
  design** + `coverage.odds=false` pra 2021–2025 (true só 2026). `/odds`
  entrega 1 snapshot atual por book (1 timestamp `update`), sem série de
  movimento.

**2. Quota / custo.**

- api-football mede **por chamada HTTP** contra budget **DIÁRIO** (cada página
  paginada decrementa `x-ratelimit-requests-remaining`), **sem** multiplicador
  `markets × regions`: uma chamada `/odds?league=71` devolveu a rodada inteira
  de 10 jogos em **1 página** (`paging.total:1`), com todos os books + bets
  aninhados. A ~3h de refresh, varrer a liga toda ≈ **~8 calls/dia**.
- **Correção factual obrigatória:** a chave de **produção é Pro/7500-dia**
  (`GET /status`: `plan='Pro'`, `limit_day=7500`), **não** o free 100/dia que
  `.env.example` e o ADR 0005 assumem. Os ~8 calls/dia de odds são triviais
  contra 7500 — a pergunta real (não respondida hoje) é **quanto o consumo
  ATUAL de sports-data** (fixtures/lineups/injuries) já come desse budget
  compartilhado. Medir essa baseline é precondição (ver issues derivadas).

**3. Tier 3 — assimétrico (settlement é o ganho real; odds de bola é beco sem saída pro BR).**

- **Odds:** corners/cards **bloqueados nos DOIS providers** pro Brasileirão
  (api-football `bet=45/80`→`0`; The Odds API sem cobertura BR de corners/cards
  verificada). **Correct score** e **artilheiro** só a api-football precifica
  pro BR (The Odds API não tem correct score no futebol em lugar nenhum; player
  props só em 6 ligas não-BR).
- **Resultados (o diferencial CONFIRMADO):** `/fixtures/statistics` devolve
  corners/cartões por time não-nulos pra liga 71 (verificado ao vivo em 2 jogos
  finalizados); `/fixtures/events` dá gols/cartões por jogador/minuto.
  Cobertura **não** é season-gated (events/statistics true em 2024/2025/2026).
  Latência ~1–2h pós-FT; `VAR_CARD` suporta correção tardia. A The Odds API
  `/scores` é **só placar** → **nunca** settla Tier 3.

**4. Impacto em `result_data`.** Settlement é desacoplado de odds, então um
provider de odds novo **não toca** o settlement. Mas ligar um mercado Tier 3 é
o "novo formato de resultado" que os ADRs 0015 (D2) e 0016 (D2) **diferiram**:
exige (a) novo shape de `result_data`, (b) novo método em `SportsDataProvider`
(`getFixtureResult` hoje só dá `status+regulationScore`) lendo
`/fixtures/statistics`|`/fixtures/events`, e (c) nova regra pura no registry de
settlement. Os DADOS já existem e são não-nulos pra liga 71 — o risco é de
wiring aditivo, não de cobertura.

## Decisão

**Duplo-provider (complementar).** Distinguir explicitamente **o que sai agora
(ungated)** do **que fica enfileirado atrás de gates**:

- **AGORA, ungated:** extrair a abstração `OddsProvider` provider-neutra + DTO
  `NormalizedOdds` (análogo a `SportsDataProvider`/`NormalizedFixture` do ADR
  0005), envolvendo o cliente atual do The Odds API como **primeiro adapter**,
  byte-idêntico em comportamento; generalizar `MarketDescriptor` e
  `select-bookmaker.ts` pra mapear do DTO normalizado. **Também ungated:** o
  **wiring de settlement Tier 3 + coleta de stats** (`/fixtures/statistics`),
  cujos dados estão verificados e que é desacoplado de odds.
- **ENFILEIRADO, gateado por G2/G3:** a **perna de odds da api-football**
  (correct score + artilheiro/assistência) e a **graduação** de qualquer
  mercado Tier 3 (pela régua **D9 viva** — tracking real, **sem backtest**; ver
  Refino pós-decisão).

Sejamos honestos sobre o delta vs a alternativa "diferido": **o artefato que sai
hoje é o mesmo seam nos dois casos**. A escolha de "agora" significa apenas que
(1) **comprometemos e enfileiramos** o trabalho gateado como issues nomeadas, e
(2) **pré-aceitamos** o custo de egress — porque correct score/artilheiro são um
diferencial **exclusivo confirmado** (nenhum outro provider os precifica pro
BR) e o dono quer começar a acumular **tracking vivo (D9)** desses mercados
**nesta temporada**, não na próxima, evitando um 2º round de ADR.

Detalhamento:

1. The Odds API permanece a **fonte canônica de edge** pros mercados de Tier
   1/2 já ativos (paridade, sem regressão). api-football **não** substitui isso.
2. api-football entra como adapter de odds **complementar** só pros mercados que
   **só ela** precifica pro BR (correct score, artilheiro/assistência) + como
   fonte de **resultado** pra settlement Tier 3.
3. Reuso do ADR 0005 como **PADRÃO, não código:** o `FallbackProvider`
   implementa `SportsDataProvider` (sem método de odds), então o
   cascade/capability-gate é replicado num `OddsFallbackProvider` novo.
4. Tier 3 ligado: **avaliar correct score + artilheiro** (NÃO corners/cards —
   sem odds em nenhum provider). Cada mercado: migration
   `markets`/`market_selections` + cartucho + settlement por mercado
   (ADRs 0015/0016) + régua **D9 viva** antes de graduar — **sem backtest**
   (ver Refino pós-decisão).
5. **Backtest desescopado.** Não há backtest retroativo **grátis** em nenhum
   provider (api-football: retenção 7 dias + `coverage.odds=false` pré-2026;
   The Odds API: arquivo histórico existe mas é **pago-only**, inacessível ao
   free 500/mês) — e o dono **desescopou backtests de vez** (2026-06-15, ver
   Refino). A graduação é por **tracking D9 vivo** (apostas resolvidas reais),
   não por teste prévio. CLV segue como item próprio no #180.

### Gates e riscos

- **Risco aceito (NÃO é gate) — refresh near-KO da liga 71:** o refresh perto do
  KO foi confirmado cross-league (66% em ≤3h) mas **não** observado pra liga 71
  nem pro Bet365 (única rodada com odds 5+ semanas à frente, pausa do Mundial de
  Clubes). Se ficar coarse-refresh, preços estale dariam edges errados (gotcha #1
  do `CLAUDE.md`). **O dono optou por NÃO planejar um teste prévio** (2026-06-15,
  ver Refino): se isso virar problema quando as competições voltarem, trata-se
  como **bug** então — não como gate que segura o trabalho no board.
- **G2 — egress:** a api-football sports-data (fixtures/lineups/injuries) **já
  egressa do Vercel hoje** (crons em `app/api/cron/*`, runtime nodejs) **sem
  proxy/IP estático e sem bloqueio observado**, apesar do aviso do vendor contra
  serverless de IP compartilhado. A perna de **odds** adiciona cadência maior e
  sensibilidade de reputação de IP nos endpoints de odds — então **monitorar**
  rate-limit/bloqueio e ter **proxy static-IP como contingência**, não como
  pré-requisito cego. (Settlement Tier 3 lê dos mesmos endpoints de stats que já
  egressam hoje — mesmo risco, já em produção.)
- **G3 — viabilidade de "mercado completo" + cobertura:** `select-bookmaker.ts`
  exige **TODAS** as `selectionKeys` de **um único** book, senão descarta o
  mercado (retorna `null`). Correct score é um mercado de ~30 resultados cotado
  por **um book fino só (Bet365)**, e o edge do ADR 0018 normaliza o overround
  sobre TODAS as N seleções — overround de book único sobre 30 vias é denominador
  duvidoso. **G3 deve definir, antes de implementar:** como `selectionKeys` é
  bounded (grid top-N + bucket "OTHER/Any Other Score") pra o complete-market ser
  satisfazível de um book só, e se o overround de book único é confiável como
  denominador de edge. Se nenhum dos dois for resolvível, **correct score fica
  gated-não-entregue** e o "agora" entrega só **artilheiro/assistência** (conjunto
  de seleções menor). Confirmar também plano de produção (Pro/7500) e cobertura
  no momento do fixture.

## Alternativas consideradas

| Opção | Descarte |
|---|---|
| **Substituir** The Odds API pela api-football | Perde o arquivo histórico **pago** do The Odds API (único caminho retroativo — pago-only, hoje inacessível ao free 500/mês, mas opção futura); **zero** ganho de casa BR (mesma classe EU/global); joga fora código validado em produção. |
| **Duplo-provider DIFERIDO** (só o seam agora, gatear odds+Tier 3 depois) | Era a recomendação da pesquisa (valor sobrevivente é modesto e atrelado a mercados não-ligados). **O artefato entregue hoje é idêntico ao desta decisão** (só o seam); a diferença é puramente que aqui **comprometemos/enfileiramos** a perna gateada como issues e **pré-aceitamos** o custo de egress, pra começar correct score/artilheiro nesta temporada sem 2º ADR. |
| **Manter sem mudança** | Deixa o path de odds sem abstração (dívida técnica) e forgoes os mercados que **só** a api-football precifica pro BR. |
| Tier 3 **corners/cards** | Infactível end-to-end: **sem odds** em nenhum provider pro Brasileirão (só settlement existiria). Reabrir só se odds aparecerem (ver Reavaliação). |

## Consequências

- (+) Abre o **caminho** pra **correct score** e **artilheiro/assistência** pro
  Brasileirão — mercados que a The Odds API não precifica em lugar nenhum.
  **Entrega real condicionada a G2/G3 + graduação D9 viva** (não é entrega
  imediata, mas sem gate de teste prévio que a segure).
- (+) Habilita o **settlement Tier 3** (corners/cartões **settla-vel** via
  `/fixtures/statistics` — mesmo sem odds *bettable* hoje) como fundação
  desacoplada, reusável quando/se um book cotar (ver Reavaliação).
- (+) Paga a dívida técnica: o path de odds ganha uma abstração (`OddsProvider`),
  fechando a assimetria com o sports-data (que já tem `SportsDataProvider`).
  Esse seam **sobrevive mesmo se a perna de odds não vingar** (ver Reavaliação).
- (+) Settlement de odds intocado: a decisão de odds não mexe em `settle.ts`.
- (−) **Risco de viabilidade (correct score):** o complete-market gate de
  `select-bookmaker.ts` + book único Bet365 sobre ~30 vias pode **quebrar
  end-to-end** o mercado-manchete do "agora" — por isso virou **G3**, não rodapé.
- (−) **Egress:** a perna de odds adiciona cadência sobre o mesmo host/vendor que
  já roda sports-data no Vercel sem bloqueio — risco a **monitorar** com
  contingência de proxy, não custo certo.
- (−) **Budget compartilhado:** ~8 calls/dia de odds são triviais contra
  Pro/7500, mas o consumo atual de sports-data nesse mesmo budget é **desconhecido**
  — medir antes de assumir folga.
- (−) **Backtest desescopado:** a graduação D9 é por **tracking vivo** (apostas
  resolvidas reais), não por teste prévio nem forward-capture — sem atalho
  histórico (nenhum provider dá grátis).
- (−) **Esforço:** sem `OddsProvider` hoje; o seam + DTO + generalizar o
  `MarketDescriptor` e `select-bookmaker.ts` é trabalho de superfície ampla.
- (−) **Doc-debt factual:** `.env.example` e ADR 0005 erram o plano (free 100/dia
  vs Pro 7500/dia observado) — corrigir.

## Reavaliação

- **Quando a liga 71 voltar** (pós-pausa do Mundial de Clubes): **sem teste
  prévio planejado** (decisão do dono — ver Refino). Se preço estale na perna de
  odds da api-football virar edges errados, tratar como **bug** quando surfaçar.
- **Se a perna de odds não vingar** (preço estale / cobertura sumir): o **seam
  `OddsProvider` + DTO + generalização do descriptor (#288) ainda valem** como
  dívida técnica paga; só o **adapter de odds (#289) é engavetado**. A parte
  irreversível é o seam.
- **Corners/cards:** re-checar `/odds?league=71&bet=45/80` periodicamente; se
  algum book passar a cotar, reabrir o mercado (settlement via stats é aditivo).
- **Backtest:** desescopado hoje. Se um dia for revisitado, o único caminho
  retroativo é o arquivo histórico **pago** do The Odds API (multiplicador 10× de
  créditos, só plano pago; ordem de grandeza a confirmar) — nunca a api-football.

## Refino pós-decisão (2026-06-15)

Refino do dono ao derivar as issues de implementação, que vale como decisão
permanente:

- **Backtests desescopados de vez.** Já foram planejados e cancelados 2× no
  pivot; não se planeja mais nenhum teste desse tipo. Mercados graduam **só pela
  régua D9 viva** (tracking real de apostas resolvidas).
- **Sem testes-gate de "quando a competição voltar".** Não criar tarefas de
  acceptance test pendentes esperando o calendário; se um problema (ex.: preço
  estale) surgir quando as ligas voltarem, trata-se como **bug** então.
- **Board enxuto, tudo AFK.** Nada de issues HITL (human-in-the-loop) que ficam
  paradas no board. A cauda deste ADR são **3 issues** só (abaixo).

## Issues derivadas

Criadas a partir deste ADR (produto de #181; implementação fora do PR do ADR).
Enxutas e todas **AFK** (ver Refino). Sequência por dependência:

1. **#288** — Seam `OddsProvider` + DTO `NormalizedOdds` + generalizar
   `MarketDescriptor` + doc-fixes (`.env.example`/errata ADR 0005 do plano
   Pro 7500; revisar comentário de `odds-api-constants.ts` vs #158). Refactor
   byte-idêntico, sem adapter api-football ainda. *(ungated)*
2. **#289** — Adapter de odds da api-football (correct score + artilheiro):
   resolve **G3** inline (bounding de `selectionKeys` via grid top-N + bucket
   OTHER; overround de book único vs ADR 0018) + nota operacional de egress
   (**G2**, monitorar). Sem backtest, sem teste-gate. *(bloqueado por #288)*
3. **#290** — Ligar correct score + artilheiro end-to-end: migration
   `markets`/`market_selections` + cartuchos + settlement por mercado (correct
   score sobre o placar 90' existente; artilheiro via `/fixtures/events`) + flag
   admin-only, graduação por **D9 viva**. *(bloqueado por #289)*

O **settlement de corners/cards via `/fixtures/statistics`** (o diferencial
confirmado da api-football) **não** virou issue: esses mercados não são ligados
(sem odds em nenhum provider). Fica como fundação a construir **se/quando** um
book passar a cotá-los (ver Reavaliação).
