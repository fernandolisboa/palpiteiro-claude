# DISCOVERY — Palpites mid-game (ao vivo): live-odds + estado ao vivo + emenda ADR 0012

> Resolve o **#386** (discovery, não-build). Aterrado no código real (investigação multi-agente,
> 2026-06-21) + pesquisa de vendors verificada contra fontes primárias. **Não é spec** — é o mapa
> do terreno + a recomendação. A premissa do #386 ("verificado no código 2026-06-19") foi
> **re-verificada e está parcialmente desatualizada** — ver §0.

## TL;DR (recomendação)

**NÃO construir o "palpite ao vivo settle-able" agora.** A premissa do #386 (faltava vendor de
live-odds e isso travava tudo) **caiu**: dado ao vivo custa **~$0–40/mo via vendors que já usamos**.
Mas a investigação expôs dois bloqueios mais fundos que o #386 subestimou:

1. **Settlement de mid-game NÃO é reusável** pra o caso interessante. O settlement atual liquida no
   placar final de 90' — pra um palpite criado aos 60' com 2-0, "over 2.5" já bateu (os gols já
   aconteceram): liquidar no jogo-inteiro é trivial e **enganoso**. O palpite mid-game CRÍVEL é
   **rest-of-match** (resto do jogo / próximo gol), que exige **mercado novo + dado de settlement
   novo** — capability nova, não reuso. (O #386 supôs "provavelmente reusável" — está **errado**.)
2. **Credibilidade do modelo.** O cartucho é **pré-jogo por construção** (`buildUserMessage(input,
   { daysToKickoff })`), sem placar/minuto/eventos no input. Mid-game precisa de cartucho novo, e
   **não há trilho de validação** (backtests desescopados) — lançaria só no D9 ao vivo, num cenário
   em que errar é mais visível e a variância é maior. É exatamente "furar a credibilidade do motor"
   que o próprio #386 temia.

E o **firewall regulatório** (ADR 0030/0031: manchete pública sem odds/EV/edge) significa que todo o
trabalho caro de **live-odds → edge** entrega **zero** ao que o usuário vê. O valor do live-odds é só
interno.

→ **Parquear como "palpite ao vivo".** Se a vontade for *engajamento durante o jogo*, existe um MVP
**barato e sem nenhum dos bloqueios acima** (uma "leitura ao vivo" NÃO-apostável; §8 Opção B) — mas é
uma feature **diferente** da que o #386 pede. Decisão do dono em §8.

---

## §0 Correção da premissa (o #386 vs a realidade verificada 2026-06-21)

| Premissa do #386 (2026-06-19) | Realidade verificada (fontes primárias 2026-06-21) |
|---|---|
| "A Odds API **não tem feed in-play** (só pré-jogo)" | **Parcialmente falso.** O endpoint `/v4/sports/{sport}/odds` que já usamos retorna jogos *upcoming E ao vivo* no mesmo lugar (in-play detectado por `commence_time < now`). Não há produto in-play separado — é **custo de crédito**, não de vendor. (free 500/mo estoura; piso realista p/ polling = tier $30/mo.) |
| "a análise não recebe placar/minuto ao vivo (zero estado de jogo)" | **Verdadeiro.** `predict.ts` gateia `status !== "scheduled"` ANTES de buscar dado; `matches.homeScore/awayScore` existem no schema mas **nunca são lidos** na predição. |
| "ADR 0012 congela as odds pré-jogo" | **Verdadeiro** (decisão #3: `oddAtRecommendation`/`prediction_selection_odds.odd` congelados na criação; "nunca preencher buracos com o snapshot vivo"). |
| (implícito) "precisa de vendor novo caro de live-odds" | **Falso.** Live-state e live-odds saem de **vendors que já temos** (API-Football, The Odds API) por ~$0–40/mo. Betfair Exchange seria a opção "barata real-time" mas **desativou o acesso de API para clientes no Brasil em 01/01/2025** → fora. |

**Conclusão do §0:** o vendor deixou de ser o gargalo. Os gargalos reais são **settlement, credibilidade
do modelo e a reversão de gates deliberados** (§5).

## §1 O que o motor faz hoje (aterrado no código)

- **Gate "analyzable = scheduled only" (#399), em 4 lugares deliberados:** `lib/ai/predict.ts:203`
  (`if (match.status !== "scheduled") throw`), `app/actions/predictions.ts:98–110`
  (`notAnalyzableMessage` → "Jogo em andamento — a análise fica disponível só antes do apito inicial"),
  `lib/ai/palpites/index.ts:86` (barra finished/cancelled). Propósito: **escudo de custo** (não gastar
  LLM em jogo não-apostável) + credibilidade.
- **Input 100% pré-jogo:** `predict.ts:244–272` busca form(5)/h2h(5)/standings/lineups/injuries. Zero
  estado de jogo. O cartucho de síntese (`lib/ai/palpites/cartridges/cartridge.ts`, `PalpitesInput`)
  é pré-jogo (`match/analyses/homeForm/awayForm/h2h/standing/news`), e o prompt é enquadrado por
  **`daysToKickoff`** — um palpite mid-game quebra esse frame estruturalmente.
- **Odds congeladas na criação** (ADR 0012 #3) — `predict.ts` deriva implied uma vez do bundle e
  persiste; `selection_odds_snapshots` assume uma captura congelada por (match, selection, book).
- **Settlement** (`lib/settlement/settle.ts`, cron diário **09:00 UTC**) liquida só no **placar final
  de 90'** (`regulationScore`), **ortogonal ao momento de criação**. `getFixtureResult` só entrega o
  resultado final; a normalização **dropa** `status.elapsed` (o minuto ao vivo existe no raw da
  API-Football mas não é exposto na `SportsDataProvider`).

## §2 Os DOIS produtos escondidos em "palpite mid-game"

| | **Produto A — palpite ao vivo "value" (o que o #386 pede)** | **Produto B — leitura ao vivo (engajamento, NÃO-apostável)** |
|---|---|---|
| O que é | Predição settle-able durante o jogo (com edge interno) | Narrativa/leitura do jogo ("Brasil controla, deve segurar") — comentário, **não** aposta |
| Live-odds | Sim (interno, p/ edge) — mas o **firewall esconde** da manchete | Não |
| Settlement | **Rest-of-match** (capability nova) | **Nenhum** (não é aposta) |
| Gate reversal | Sim (os 4) + emenda ADR 0012 + cartucho novo | Fora do motor de predição (superfície separada) |
| Bloqueios | Todos do §5 | Praticamente nenhum |
| Custo | ~$19–40/mo dado + LLM/jogo | ~$19/mo live-state + LLM/jogo (light) |

O #386 pede o **A**. O **B** é o caminho barato/seguro se o objetivo verdadeiro for "engajar durante o
jogo" (origem da ideia B1/B2; B1 = destaque in-progress, já feito no #385).

## §3 Live-STATE (placar + minuto + eventos) — vendors

Verificado contra docs primárias 2026-06-21. **Capability não é o problema; a quota do free tier é.**

| Vendor | Já usamos? | Capability live | Custo p/ polling | Veredito |
|---|---|---|---|---|
| **API-Football** (api-sports v3) | **Sim** | `/fixtures?live=all` → placar+`status.elapsed`+status; `/fixtures/events` → gols/cartões/subs. **Mesmo produto, params diferentes** | Free 100 req/**dia** estoura num jogo (1/min ≈ 120 req). **Pro ~$19/mo** = 7.500/dia @ 300/min | ✅ **Caminho recomendado** se algo for construído |
| football-data.org | Sim | status IN_PLAY/PAUSED + `minute` + timeline | Free ~10 req/min (compartilhado) — frescor do free tier **duvidoso** (fonte 2026 sugere scores atrasados no free) | ⚠️ só p/ "placar atual" de 1 jogo, baixa cadência |
| SportMonks | Não | `/livescores/inplay` dedicado (10-15s, stats, tracking) | €29–249/mo, sem free | ❌ vendor+cliente novos; só se precisar de tracking fino |

→ **API-Football Pro (~$19/mo)** cobre live-state com polling adaptativo (só fixtures IN_PLAY). É
extensão do incumbente, não vendor novo.

## §4 Live-ODDS — vendors (e por que o firewall torna isso quase irrelevante)

| Vendor | Produto in-play | Custo | Brasil | Veredito |
|---|---|---|---|---|
| **The Odds API** | **Mesmo `/odds`** (in-play via `commence_time < now`); polling, sem stream | Free 500/mo estoura; **$30/mo** (20K) piso p/ polling | OK (agregador) | Opção default se live-odds for preciso |
| **API-Football** | **`/odds/live` (BETA, grátis/não-contado durante o beta)** | $0 hoje (beta), depois plano pago | OK | ✅ menor-risco p/ *experimentar* edge ao vivo |
| Betfair Exchange | back/lay real-time | Live key ~GBP 499 | ❌ **API desativada p/ BR em 01/01/2025** | ❌ fora |
| GoalServe | websocket 1s | $500/mo | OK | ❌ caro p/ solo |
| OpticOdds / Sportradar / Genius | enterprise | $5k–10k+/mo, sales-gated | n/a | ❌ fora |

**O ponto que muda tudo:** a manchete pública **não mostra odds/EV/edge** (firewall ADR 0030/0031). O
live-odds só alimentaria o **edge interno** (ADR 0018). Ou seja: o trabalho mais caro/complexo
(live-odds + emenda ADR 0012 + rest-of-match odds) entrega **zero ao usuário** e serve só a um número
interno num produto sem backtest. **Mau ROI.**

## §5 Os bloqueios REAIS (em ordem de dor)

1. **Settlement rest-of-match (o killer).** Liquidar mid-game no jogo-inteiro double-conta gols já
   feitos (over 2.5 aos 60' com 2-0 = trivialmente "over"). O palpite crível é **resto-do-jogo**, que
   exige: (a) **mercado novo** (rest-of-match O/U, próximo gol, próximo a marcar) — os providers podem
   não expor limpo; (b) **dado de settlement novo** (delta de placar do minuto-de-criação até 90') — o
   schema/lógica de hoje **não tem** isso. **Resposta ao AC "settlement atual cobre?": NÃO** para
   mercados críveis; só cobre o caso degenerado (jogo-inteiro), que é um produto ruim.
2. **Credibilidade do modelo.** Cartucho pré-jogo (`daysToKickoff`, input sem game-state) → cartucho
   **novo** + threading de placar/minuto/eventos. **Sem validação** (backtests desescopados) → D9 ao
   vivo only, com variância maior e erro mais visível.
3. **Reversão dos 4 gates (#399) + emenda ADR 0012.** Fork/parametrização (`liveMode`), não tweak. Os
   gates eram deliberados (escudo de custo + credibilidade). Precisa de **cost-guard de polling** novo
   + **TTL de cache sub-minuto** (o `cache-ttl.ts` só conhece janelas pré-jogo/finished).
4. **Custo operacional novo (gerenciável).** ~$19–40/mo de dado + N chamadas LLM concorrentes por jogo
   ao vivo (Haiku ~$0.0056/call). Mitigável: polling só de fixtures IN_PLAY, cadência adaptativa,
   rate-limit por-jogo, escopo de poucas ligas. Lembrar: o "custo NÃO é o gargalo" (discovery de
   perf/custo) era sobre **LLM**, não sobre **assinatura de dado** recorrente.
5. **Regulatório.** Mesmo firewall + disclaimer; "palpite ao vivo" pode atrair mais escrutínio, mas o
   padrão de firewall (sem linguagem de valor) já existe. Gerenciável.

## §6 Emenda ao ADR 0012 (só se Produto A) — esboço

ADR 0012 #3 congela odds na criação. Mid-game exigiria: **ou** (a) snapshots versionados durante o
jogo (`captured_at` múltiplos por selection) com a predição apontando pro snapshot-de-criação; **ou**
(b) redefinir o congelamento como "congela no instante da criação do palpite mid-game" (o mais simples,
mas exige rest-of-match odds pra fazer sentido). Não-trivial, e — repetindo — **invisível ao usuário**
por causa do firewall.

## §7 Respostas diretas aos Acceptance Criteria do #386

- **Vendor de live-odds (custo/quota/contrato):** §4. Não precisa de vendor novo; The Odds API
  (mesmo endpoint, $30/mo) ou API-Football beta (grátis hoje). Betfair fora (BR).
- **Estado ao vivo:** §3. API-Football `/fixtures?live=all` + `/fixtures/events`, ~$19/mo Pro p/ quota.
- **Gap do modelo:** §5.2. Cartucho novo (game-state no input), sem trilho de validação.
- **Emenda ADR 0012:** §6. Necessária só pro Produto A; não-trivial e invisível ao usuário.
- **Settlement cobre mid-game?** §5.1. **NÃO** pra mercados críveis (rest-of-match = capability nova);
  só cobre o caso jogo-inteiro degenerado.
- **Vale a pena?** §8.

## §8 Recomendação + opções (decisão do dono)

**Recomendação: parquear o Produto A (palpite ao vivo settle-able) — sem código, sem ADR, sem
backlog.** O custo de vendor caiu, mas (1) o mercado crível (rest-of-match) é capability nova de
settlement+odds, (2) o modelo lançaria sem validação num cenário de alta variância (risco de
credibilidade), e (3) o firewall faz todo o trabalho caro de edge ao vivo ser **invisível** ao usuário.
Alto esforço, baixo retorno-visível, alto risco-de-credibilidade.

Opções pro dono:

- **A — Parquear (recomendado):** fechar o #386 com este doc como registro do "por quê não". Revisitar
  só se (i) houver demanda real de usuário por palpite ao vivo E (ii) existir um trilho de validação.
- **B — MVP barato de engajamento (leitura ao vivo, NÃO-apostável):** uma superfície de "leitura ao
  vivo" na página do jogo (placar+minuto+eventos via API-Football Pro $19/mo + um read leve do LLM),
  enquadrada como **comentário, não palpite** — sem settlement, sem odds, sem reverter o gate de
  predição, sem risco de credibilidade-de-aposta. Extensão natural do #385 (B1). **É outra feature**
  que não a do #386, mas escratcha a coceira de "engajar durante o jogo". Se o dono quiser, isso vira
  `/to-issues` (tracer-bullet: live-state seam → superfície read-only → cartucho de comentário).
- **C — Construir o Produto A mesmo assim:** só se o dono aceitar o risco. Ordem tracer-bullet:
  (1) live-state seam (`SportsDataProvider.getLiveState`, `supportsLiveData`) + API-Football Pro;
  (2) **resolver settlement rest-of-match PRIMEIRO** (mercado + dado) — é o gargalo, validar antes;
  (3) cartucho mid-game + threading de game-state; (4) emenda ADR 0012; (5) fork dos gates + cost-guard
  de polling. Cada passo atrás de ADR. **Não recomendado sem validação.**
