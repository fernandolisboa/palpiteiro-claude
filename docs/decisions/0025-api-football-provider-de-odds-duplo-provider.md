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
  refresh é plausivelmente por liga/book. Precisa de gate (**G1**) antes de
  confiar.
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
- **ENFILEIRADO, gateado por G1/G2/G3:** a **perna de odds da api-football**
  (correct score + artilheiro/assistência) e a **graduação** de qualquer
  mercado Tier 3 (que ainda precisa de odds + backtest ≥20 + D9).

Sejamos honestos sobre o delta vs a alternativa "diferido": **o artefato que sai
hoje é o mesmo seam nos dois casos**. A escolha de "agora" significa apenas que
(1) **comprometemos e enfileiramos** o trabalho gateado como issues nomeadas, e
(2) **pré-aceitamos** o custo de egress — porque correct score/artilheiro são um
diferencial **exclusivo confirmado** (nenhum outro provider os precifica pro
BR) e o dono quer começar a acumular CLV/backtest desses mercados **nesta
temporada**, não na próxima, evitando um 2º round de ADR.

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
   `markets`/`market_selections` + novo `result_data` + regra de settlement
   (ADRs 0015/0016) + **backtest ≥20 jogos** e régua **D9** antes de graduar.
5. **Backtest/CLV: forward-capture.** Não há backtest retroativo **grátis** em
   nenhum provider (api-football: retenção 7 dias + `coverage.odds=false`
   pré-2026; The Odds API: arquivo histórico existe mas é **pago-only**,
   inacessível ao free 500/mês). Logo, o caminho do gate D9 é **forward-capture**
   (persistir snapshots pré-jogo no DB conforme as análises rodam, agnóstico de
   provider); o arquivo pago do The Odds API fica como **fallback explícito**
   (ver Reavaliação). Fundação do D9 e do CLV (#180).

### Acceptance gates (precondições pra ligar a perna de odds da api-football)

- **G1 — refresh near-KO da liga 71 (no book que importa):** re-rodar o teste de
  `gap(KO − update)` numa rodada **real** do Brasileirão, **especificamente nas
  linhas de correct score/artilheiro do Bet365** (o único book que cota a liga
  71) — não só no `/odds` agregado. Inobservável hoje (pausa do Mundial de
  Clubes). Se ficar coarse-refresh perto do KO → preços estale → edges
  sistematicamente errados (gotcha #1 do `CLAUDE.md`) → **não** usar pra edge.
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
  **Entrega real condicionada a G1/G2/G3 + backtest/D9** (não é entrega imediata).
- (+) Habilita o **settlement Tier 3** (corners/cartões **settla-vel** via
  `/fixtures/statistics` — mesmo sem odds *bettable* hoje) como fundação
  desacoplada, reusável quando/se um book cotar (ver Reavaliação).
- (+) Paga a dívida técnica: o path de odds ganha uma abstração (`OddsProvider`),
  fechando a assimetria com o sports-data (que já tem `SportsDataProvider`).
  Esse seam **sobrevive mesmo se G1 falhar** (ver Reavaliação).
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
- (−) **Sem backtest retroativo grátis:** o gate D9 depende de forward-capture
  acumulando ao longo das rodadas — sem atalho histórico sem pagar.
- (−) **Esforço:** sem `OddsProvider` hoje; o seam + DTO + generalizar o
  `MarketDescriptor` e `select-bookmaker.ts` é trabalho de superfície ampla.
- (−) **Doc-debt factual:** `.env.example` e ADR 0005 erram o plano (free 100/dia
  vs Pro 7500/dia observado) — corrigir.

## Reavaliação

- **Quando a liga 71 voltar** (pós-pausa do Mundial de Clubes): rodar **G1** no
  Bet365 antes de qualquer go-live de odds da api-football.
- **Se G1 falhar** (refresh coarse perto do KO na liga 71): o **seam
  `OddsProvider` + DTO + generalização do descriptor (issues 1–2) ainda valem**
  como dívida técnica paga, e o **settlement Tier 3 (issue 7) ainda sai** — mas
  o **adapter de odds da api-football é engavetado**. A parte irreversível é só o
  seam; correct score/props odds são a aposta especulativa.
- **Corners/cards:** re-checar `/odds?league=71&bet=45/80` periodicamente; se
  algum book passar a cotar, reabrir o mercado (a parte de settlement já existe).
- **Backtest:** se forward-capture for lento demais pra graduar mercados,
  reavaliar o arquivo histórico **pago** do The Odds API (multiplicador 10× de
  créditos, só plano pago; ordem de grandeza ~US$30/20K créditos **a confirmar**)
  pra um backfill único.

## Issues derivadas

A serem criadas (este ADR é o produto de #181; a implementação vive em issues
próprias, fora do PR deste ADR). **Sequência:** as issues 1–3, 5 e 7 são
ungated; a issue 6 (adapter de odds) só começa **depois de G1 passar**.

1. Extrair `OddsProvider` + DTO `NormalizedOdds`; envolver The Odds API como 1º
   adapter; refatorar `fetch-and-snapshot.ts`/`predict.ts`/`select-bookmaker.ts`
   (comportamento byte-idêntico). **Sem** adapter api-football ainda. *(ungated)*
2. Generalizar `MarketDescriptor` pra mapear do DTO normalizado (tirar o
   acoplamento `OddsApiOutcome`/`providerMarketKey`). *(ungated)*
3. Corrigir docs/comments factualmente errados: `.env.example` + ADR 0005
   (errata: plano = Pro 7500/dia supersede a premissa free 100/dia — é o que muda
   o sizing de budget); **revisar** (não corrigir cego) o comentário de
   `odds-api-constants.ts` à luz de #158 (Betano não retornou nos *additional* da
   Copa); registrar que histórico do The Odds API é pago-only. *(ungated)*
4. **G1** — acceptance test do refresh near-KO da liga 71 **no Bet365**
   (correct score/artilheiro), a rodar quando o Brasileirão voltar; **G2** —
   documentar a decisão de egress (monitorar + contingência static-IP). *(gate)*
5. Forward-capture de snapshots de odds pré-jogo no DB (backtest/CLV,
   agnóstico de provider) — fundação do gate D9 e do #180. *(ungated)*
6. **G3 + adapter de odds da api-football** (correct score + artilheiro): definir
   o bounding de `selectionKeys` (grid top-N + bucket OTHER) e validar o overround
   de book único como denominador de edge (ADR 0018) **antes** de codar; medir a
   baseline de consumo de sports-data no budget Pro/7500. **Começa só após G1.**
   *(gated por G1/G2/G3)*
7. Wiring de settlement Tier 3: novo `result_data` + método de coleta
   (`/fixtures/statistics`|`/fixtures/events`) + regra no registry — honrando
   skip-over-wrong-settle em stats nulos. *(ungated; desacoplado de odds)*
8. (condicional, por mercado) Ligar **correct score** e **artilheiro** —
   migration `markets`/`market_selections` + cartucho + backtest ≥20 jogos + D9.
   *(gated pela 6 + 7)*
