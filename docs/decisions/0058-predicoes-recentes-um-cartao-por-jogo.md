# ADR 0058 — Suas predições recentes: um cartão por jogo

## Status

Accepted (2026-10-15). Issue #577 (linha 22 da revisão de design de 2026-10). **Emenda a ADR 0020 Decisão 4** (a lista de recentes deixa de ser um feed sem dedup). **Não muda** a ADR 0020 Decisões 1 a 3 nem a emenda da chave composta: KPIs, histórico e settlement continuam como estão. Camada de leitura e apresentação: não toca prompt, seed, schema nem valores do banco. Plano: `docs/plans/PLAN-577.md` (a "Revisão do plano" vale sobre o resto).

## Contexto

A ADR 0020 Decisão 4 fixou "Suas predições recentes" (`/jogos`) como **feed de atividade**: `getRecentPredictionsByUser` lista as 5 predições mais recentes do usuário, sem deduplicar por jogo, e a alternativa "deduplicar também a lista de recentes" foi rejeitada porque "colapsaria reanálises do mesmo jogo".

Depois do fan-out por mercado (#178), uma análise grava uma predição **por mercado** do jogo. Com 5 itens e um cartão por predição, uma análise só enche a lista com cinco cartões do mesmo jogo (um por mercado), e uma reanálise empurra para fora tudo o que veio antes. A revisão de design de 2026-10 (linha 22) apontou isso como o problema da seção, e o dono aprovou mudar: a seção passa a responder "quais jogos analisei por último e o que a IA disse em cada mercado", não "quantas vezes rodei a análise".

## Decisão

1. **Um cartão por jogo.** A seção mostra os **5 jogos** analisados mais recentemente pelo usuário (ordem pela análise mais recente de cada jogo). Query nova `getRecentPredictedMatchesByUser(userId, matchLimit = 5)` em `lib/db/queries/predictions.ts`: primeiro os jogos (`group by matchId`, `max(createdAt)`), depois as predições do usuário nesses jogos.
2. **Por mercado, a análise mais recente.** Dentro do cartão, cada mercado aparece uma vez, com a predição de maior `createdAt` daquele mercado: a mesma chave da dedup dos KPIs (`marketKey`, ADR 0020 Decisão 2 e emenda do #178; over/under multi-linha divide um slot). O cartão mostra até duas apostas e conta os mercados sem aposta.
3. **A reanálise continua visível onde ela importa:** no detalhe do jogo (análises anteriores, `getPredictionHistoryForMatch`, ADR 0020 Decisão 1) e no Desempenho. Nenhuma predição é apagada nem mutada; a dedup é só de leitura.
4. **KPIs não mudam** (ADR 0020 Decisão 2): a contagem já era por `(matchId, marketKey)`. Com esta emenda, recentes e KPIs passam a usar a mesma regra de "mais recente vence"; a divergência que a 0020 documentava deixa de existir.

## Alternativas rejeitadas

- **Manter o feed sem dedup e só agrupar visualmente.** Cinco predições do mesmo jogo continuariam ocupando os cinco lugares; o agrupamento mostraria um cartão só e a lista ficaria com um jogo. É o problema que a revisão aponta.
- **Aumentar o limite do feed (ex.: 25 predições) e agrupar no cliente.** O número de jogos visíveis passaria a depender de quantos mercados cada análise tem (1 a 7), e um usuário que reanalisa muito veria menos jogos. A query por jogo dá sempre até 5 jogos.

## Consequências

- **(+)** A seção mostra 5 jogos distintos com o que a IA recomendou em cada mercado; uma análise não esconde as anteriores.
- **(+)** Recentes e KPIs usam a mesma regra de "mais recente por mercado".
- **(−)** A atividade de reanálise deixa de aparecer na `/jogos`; quem quer ver as reanálises abre o jogo (análises anteriores) ou o Desempenho.
- **(−)** Duas idas ao banco em vez de uma para a seção (jogos, depois predições deles); custo desprezível na escala atual.
- `getRecentPredictionsByUser` fica sem uso de produção; sai junto com o comentário que citava a Decisão 4 antiga.
