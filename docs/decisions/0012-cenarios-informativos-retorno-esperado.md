# ADR 0012 — Cenários informativos e retorno esperado na análise

## Status

Accepted (2026-06)

## Contexto

Implementação das issues #103 (frase clara da aposta + retorno esperado) e
#104 (cenários over/under lado a lado). O card de análise
(`components/analysis-result.tsx`) mostrava OVER/UNDER em mono 36px,
confidence/edge e o racional técnico, mas nunca dizia em linguagem simples qual
é a aposta nem qual o retorno esperado — feedback do dono do produto: "tá muito
técnico e nem dá pra entender 100% qual é a aposta recomendada".

Tudo que a feature precisa é matematicamente derivável dos dados já congelados
na predição (`confidencePct`, `oddAtRecommendation`, `minimumOdd`,
`impliedProbPct`, `edgePct`) mais um par de odds a congelar na issue de
cenários. O LLM, o schema Zod e o prompt ficam intactos.

Cada decisão abaixo carrega um marcador de status de implementação. Com o PR
da #104 mergeado, todas as decisões estão implementadas — o marcador indica em
qual issue cada parte entrou.

## Decisão

1. **Cenário duplo é informação, não recomendação.** O bloco de cenários
   mostra os dois lados, mas a postura do produto não muda: recomendação só
   com edge ≥ 5pp, pass rate alvo 30-60% intacto, e o tracking de Yield
   continua medindo só o lado recomendado (settlement intocado).
   *Status: implementada (#104) — bloco de cenários entregue com o lado
   alternativo informativo, sem peso visual de recomendação.*

2. **Terminologia e copy.** Label leigo **"retorno esperado"** — "EV" nunca
   aparece na UI (internamente o código chama `evPerUnit`). Legenda
   obrigatória com **"ganho médio"** e **"longo prazo"** + premissa de
   calibração ("se a estimativa de X% do modelo estiver certa") — sem essas
   palavras, numa aposta binária (desfecho real: +92% ou −100%) o número
   induz a leitura "vou ganhar 11.4% nesta aposta". `confidencePct` será
   rotulado "prob. do modelo" no bloco de cenários. **"vale a pena" é
   reservado** ao critério de odd mínima do lado recomendado (margem de
   5pp); o lado alternativo usa linguagem de break-even ("só sai do zero").
   Copy temporal de valores congelados usa "na análise", nunca
   "hoje"/"agora". *Status: implementada (#103; rótulo "prob. do modelo" e
   linguagem de break-even do lado alternativo entregues na #104 — o label
   "confidence" saiu do card junto com o grid de stats).*

3. **Congelamento do par de odds na predição.** Colunas aditivas nullable
   `overOddAtPrediction`/`underOddAtPrediction` em `predictions`, preenchidas
   pelo `predict.ts` a partir do `oddsBundle` pra toda recomendação,
   inclusive pass; `bookmaker` passa a ser persistido também em pass.
   Consequência aceita: o dashboard passa a exibir bookmaker em predições
   pass novas (semântica: bookmaker = fonte das odds analisadas). Nunca
   preencher buracos com o snapshot vivo — odds atuais já têm casa no
   OddsCard. *Status: implementada (#104).*

4. **Naming `AtPrediction` (≠ `oddAtRecommendation`).** O par novo é gravado
   inclusive em pass, onde não existe recomendação — "AtRecommendation" seria
   semanticamente errado pra essas rows. *Status: implementada (#104).*

5. **Sem backfill de históricas.** Imutabilidade de predições (regra do
   repo); parsear `ai_calls.inputPayload` seria frágil. A UI degrada campos
   ausentes com "—". *Status: implementada (#103:
   `oddAtRecommendation`/`bookmaker` null degradam no view-mapper; #104: par
   congelado null degrada as células dos cenários pra "—" com nota
   explícita).*

6. **Ponto de equilíbrio = `1/odd` CRU por design.** `breakEvenProbPct =
   100/odd` é a probabilidade real mínima pra EV ≥ 0 na odd dada — conceito
   distinto da probabilidade implícita normalizada (não viola a regra do
   overround do CLAUDE.md: o payout bruto é o que paga o apostador). A odd de
   equilíbrio do modelo = `100/modelProbPct` é distinta da `minimum_odd` do
   LLM (que embute margem de 5pp). O mesmo raciocínio vale pro
   `computeEvPerUnit` desta issue: o EV é pago na odd crua. *Status:
   implementada (EV na odd crua na #103; `computeBreakEvenProbPct`,
   `computeModelBreakEvenOdd` e `computeScenarios` na #104).*

7. **Edge e retorno esperado são eixos diferentes e podem discordar.** Edge
   compara `confidencePct` com a implied NORMALIZADA; o retorno esperado é
   pago na odd CRUA. Perto do threshold os sinais podem divergir nas duas
   direções: retorno negativo em recomendação (ex.: overround 11%, conf 55%,
   odd 1.802 → EV −0.9% com edge exatamente 5pp) e retorno positivo em PASS
   (ex.: odds 1.92/1.92, conf 53 → edge +3pp → pass, mas EV over +1.8%).
   Ambos são estados legítimos, exibidos com valor honesto, tom neutro e
   copy específica. *Status: implementada (retorno negativo em recomendação
   na #103; copy de margem de erro do EV positivo em PASS na #104).*

8. **`minimum_odd` vem do LLM sem recheck no código.** O Zod só valida
   `minimum_odd` como positivo e — ao contrário do que
   `docs/specs/over-under-prompt-design.md` (linha 70) afirma — não existe
   recheck de 5pp nem validação `minimum_odd ≤ oddAtRecommendation` em
   `predict.ts` (drift de spec registrado; correção do texto fica pra issue
   do prompt v1.3). A UI trata `minimum_odd > oddAtRecommendation` com aviso
   e tom neutro, sem invalidar a predição — endurecer o Zod jogaria fora
   recomendações válidas. *Status: implementada (#103).*

## Razão

- Deriva tudo em código puro e testado (`lib/odds/scenario.ts`,
  view-mapper): zero custo de token, zero risco de regressão de prompt, e a
  comparabilidade de calibração entre versões de prompt é preservada.
- A legenda pinada em teste impede que o número de retorno esperado vire
  promessa de ganho por aposta.
- Os estados de contradição (decisões 7 e 8) são exatamente a forma de
  confusão que motivou a feature — tratá-los com copy explícita evita que o
  card se contradiga ("vale a pena se odd ≥ 2.05" ao lado de "retorno
  +11.4%" na odd 1.92).

## Alternativas consideradas

- **Pedir os números novos ao LLM (campo no schema/tool):** rejeitado —
  custo de bump de versão + migration + risco de `invalid_output`, pra obter
  números deriváveis deterministicamente em código (ver D2 do plano).
- **Snapshot vivo pra preencher odds ausentes:** rejeitado — contradiz o
  congelamento (valores da análise) e o OddsCard já mostra as odds atuais.
- **Backfill de históricas via `ai_calls.inputPayload`:** rejeitado — é
  texto de prompt dentro do request (parsing frágil) e viola a imutabilidade
  de predições.
- **Invalidar predições com `minimum_odd > oddAtRecommendation` no Zod:**
  rejeitado — jogaria fora recomendações válidas; a UI avisa sem invalidar.

## Consequências

- (+) Card responde "qual é a aposta e quanto rende" em linguagem leiga, com
  ancoragem temporal ("na análise") e condição de odd mínima por último.
- (+) `MIN_EDGE_PP` exposto de `lib/odds/scenario.ts` (nunca de
  `lib/ai/prompts/` — importável por client component sem vazar o
  SYSTEM_PROMPT no bundle), com teste de sincronia contra o prompt.
- (−) Predições históricas sem `oddAtRecommendation` mostram "—" no retorno
  esperado (aceito; decisão 5); históricas sem o par congelado degradam a
  coluna alternativa pra "—" com nota explícita.
- (±) Com o bookmaker persistido em pass (#104), o dashboard passa a exibir
  um bookmaker real em predições pass novas — mudança aceita (decisão 3).

## Referências

- Issues #103 (frase clara + retorno esperado) e #104 (cenários +
  congelamento do par de odds) — ambas implementadas.
- ADR 0003 (mercado único over/under 2.5) — a premissa binária
  (`100 − x` pro lado oposto) vale porque a linha 2.5 nunca dá push.
- `docs/specs/over-under-prompt-design.md` — drift da linha 70 registrado na
  decisão 8.
