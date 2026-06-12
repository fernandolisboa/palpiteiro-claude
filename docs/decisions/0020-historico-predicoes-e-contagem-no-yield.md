# ADR 0020 — Histórico de predições: latest derivado de `createdAt` e contagem no yield

## Status

Accepted (2026-06-12)

## Contexto

Quando um usuário reanalisa um jogo, o código grava uma **nova** predição: a
escrita em `lib/ai/predict.ts` é um `INSERT` puro (sem `where`/`onConflictDoUpdate`/
`update`), e não há unique constraint em `(matchId, userId)` nem coluna de versão/
parent em `db/schema.ts`. Ou seja, as predições **já são rows imutáveis** — uma por
(re)análise — alinhado ao CLAUDE.md ("nunca mutar predições passadas; sempre criar
nova predição com referência à anterior se for revisão").

Esse acúmulo expôs duas perguntas em aberto, que este ADR fecha:

1. **Como representar o "histórico" e a "referência à anterior"** sem inflar o
   schema? (motivada pela query de histórico do #114).
2. **Como o dashboard deve contar reanálises** no yield/winRate/passRate/bankroll?
   Hoje cada predição é contada, então reanalisar um jogo **double-conta** a mesma
   partida (bug latente pré-existente, corrigido pelo #116).

Não há decisão de produto ou técnica registrada pra nenhuma das duas — daí este ADR.

## Decisão

1. **Histórico imutável derivado de `createdAt`, sem coluna nova.** Como as predições
   já são rows imutáveis inseridas a cada reanálise, o **histórico linear** por
   `(jogo, usuário)` é simplesmente as rows ordenadas por `createdAt DESC`. Essa
   ordenação **já é** a "referência à anterior" exigida pelo CLAUDE.md: a predição
   imediatamente anterior é a próxima na ordem. **Não** se introduz coluna de versão,
   flag de "atual", nem ponteiro de parent.

2. **Yield/winRate/passRate/bankroll contam só a predição mais recente por
   `(matchId, userId)`.** Uma reanálise **substitui** a anterior no cálculo — a mesma
   partida nunca conta duas vezes. A "mais recente" é a de maior `createdAt`. A dedup
   acontece **no read-path** (derivada do estado atual a cada leitura), não no
   write-path. Este ADR **não prescreve o mecanismo** (in-memory ou SQL) nem colunas
   de schema — isso fica a cargo da issue que implementa (#116).

3. **Settlement não muda.** Continua idempotente via `UNIQUE(predictionId)` em
   `prediction_outcomes` e settla **toda** predição pendente (inclusive as
   superseded). As predições antigas e seus `prediction_outcomes` **permanecem no
   banco como histórico** — só ficam **fora** dos KPIs. "Override manual vence"
   segue intocado: uma row em `prediction_outcomes` exclui a predição do cron via
   o filtro `IS NULL` de `getPendingSettlementPredictions` (settlement do #47).

4. **A lista de "recentes" do dashboard lista cada reanálise — exceção documentada.**
   `getRecentPredictionsByUser` **não** deduplica por jogo: ela é um **feed de
   atividade** (o que o usuário analisou recentemente), não um resumo de performance
   por partida. Mostrar cada reanálise reflete a atividade real. Os KPIs deduplicam
   porque medem performance por aposta/jogo; a lista de recentes não mede performance,
   então a divergência é **intencional** e fica reconciliada por esta decisão: número
   (KPI, deduplicado) e feed (recentes, completo) respondem perguntas diferentes.

## Razão

- **Stateless e race-free**: derivar o "atual" de `createdAt` a cada leitura não tem
  estado pra driftar. Reanálise é só um `INSERT`; o read-path sempre reflete o estado
  corrente sem reconciliação.
- **Sem migration, sem backfill**: a decisão é puramente de leitura. Zero risco de
  schema/dados.
- **Fiel ao CLAUDE.md**: predições continuam imutáveis; a "referência à anterior" é o
  vizinho em `createdAt DESC`, sem peso de schema.
- **Contagem correta do yield**: medir performance por `(jogo, usuário)` (não por
  predição) é o que o usuário espera — reanalisar não infla o histórico de apostas.
- **Recentes como feed**: separar "atividade recente" (lista tudo) de "performance"
  (deduplica) evita esconder do usuário que ele reanalisou um jogo.

## Alternativas consideradas

A escolhida foi **(a)** — derivar o "atual" de `createdAt` no read-path (stateless,
sem migration, sem estado denormalizado a reconciliar). As rejeitadas:

- **(b) Flag `isLatest` denormalizada**: rejeitado — precisaria virar `false` na row
  antiga e `true` na nova **atomicamente**; o driver `neon-http` não suporta transação
  interativa real (ver `lib/ai/predict.ts`), então a flag driftaria sob concorrência, e
  exigiria um backfill arriscado nas rows existentes. Estado denormalizado sem ganho.
- **(c) Cadeia `prevPredictionId` (ponteiro de parent)**: rejeitado — peso de schema
  (coluna + FK + migration) sem consumidor concreto além da **letra** da convenção do
  CLAUDE.md. O histórico linear já é referenciável por `createdAt DESC`; um ponteiro
  explícito só agrega valor se/quando existir ramificação de revisão (não é o caso).
- **Deduplicar também a lista de recentes**: rejeitado — colapsaria reanálises do
  mesmo jogo, escondendo atividade real do feed. Recentes e KPIs respondem perguntas
  diferentes (atividade vs performance); a reconciliação é documentar a divergência,
  não forçar a mesma regra nos dois.
- **Contar todas as predições no yield (status quo)**: rejeitado — é o próprio bug:
  reanalisar double-conta a partida, inflando yield/winRate/bankroll.

## Consequências

- (+) Reanálise é só um `INSERT`; KPIs e histórico derivam do estado atual, sem
  migration, backfill ou estado a manter.
- (+) Histórico preservado integralmente: predições antigas e seus outcomes continuam
  no banco, acessíveis (ex.: pela query do #114).
- (+) Settlement intocado e idempotente; "override manual vence" preservado.
- (−) O read-path do dashboard busca **todas** as predições do usuário (incluindo as
  superseded) e descarta as antigas na leitura — custo desprezível na escala atual
  (uso pessoal), mas cresce com o nº de reanálises.
- (−) "A mais recente vence" é **incondicional**: reanalisar um jogo já settled passa
  a contar a predição nova (possivelmente ainda pendente) e tira o resultado antigo dos
  KPIs até resettlar. É consequência direta da regra "latest por `(matchId, userId)`";
  na prática reanálise ocorre **antes** do jogo, então o caso é raro.
- (−) Lista de recentes e KPIs **divergem por design** (recentes lista cada reanálise);
  a reconciliação é conceitual (feed de atividade vs performance), não numérica.

## Referências

- Registra as decisões pedidas no #115; a contagem é implementada no **#116** (dedup
  no read-path, keyed por `(matchId)`, extensível a `(matchId, market)` no #171).
- A query de histórico que materializa a decisão (1) é o **#114**
  (`getPredictionHistoryForMatch`).
- CLAUDE.md — "nunca mutar predições passadas; sempre criar nova predição com
  referência à anterior".
- Relaciona com o **#171** (dashboard segmentado por mercado), que estende a chave de
  dedup com o mercado.
