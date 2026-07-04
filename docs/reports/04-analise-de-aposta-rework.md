# Report 04 — Rework da "análise da aposta do usuário" (o item que te incomoda)

> Redesenho da superfície que você mais odeia: analisar a **aposta do próprio usuário**.
> Aterrado nos 3 fluxos de `app/actions/predictions.ts`, no grade-my-bet v1 shipado, no
> maquinário de cartuchos/settlement, e no discovery #352. **Aterrado em `origin/main`.**

## ⚠️ Descoberta que muda o enquadramento

O **checkout local estava 15 commits atrás** de `origin/main`. O item 4 **já foi parcialmente
shipado**: o discovery **#352 está resolvido** →

- **ADR 0034** "Analise minha aposta — leitor de valor selection-pinned" (commit `5ab6820c`, PR #413)
- **Build #412** (commit `17de6d8b`, PR #425) — **MERGED + LIVE**

O que shipou (v1) é um **leitor de valor com picker estruturado**: uma aba `[Análise |
Minha aposta]` na match page com formulário `market Select → selection Select → linha → sua
odd`. Cache-first (lê a distribuição por-seleção persistida, zero LLM no HIT), dual-channel
(a odd do usuário é preço-only, o edge ancora no board deviged do app), output = leitura
sóbria template-derivada + disclaimer. Fail-closed "não avalio" pra mercado/seleção/linha não coberto.

**Ou seja: o v1 É exatamente a tediosidade "escolha um mercado, depois a IA analisa" que te
incomoda** — e não expressa nenhuma das apostas dos seus sonhos: "o mandante marca primeiro",
"X gols no 1º tempo", placar exato fora das ligas cobertas, escanteios, ou múltipla (a
combinação foi explicitamente deferida pra v2 pelo ADR 0034; nada é persistido nem liquidado).

**Este report é o design de uma v2 "Aposta livre".**

## O problema-raiz de UX: direção da tradução

Todo fluxo — incluindo o grade-my-bet v1 — faz **o USUÁRIO traduzir a aposta mental dele pra
taxonomia interna do sistema** (marketKey → selectionKey → linha) via dropdowns, e a taxonomia
só cobre o que tem cartucho de LLM + board de odds (7 descriptors, a maioria gated por liga).

Um apostador de verdade pensa *"Palmeiras 2 a 0"*, *"o mandante marca primeiro"*, *"mais de 1
gol no 1º tempo"*, *"over 9.5 escanteios"*, ou uma combinada no mesmo jogo. A ironia que
fundamenta o redesenho: **o sistema já entende quase todas essas formas de aposta no OUTRO
lado** — a síntese de palpite emite `exact_score`/`first_half_score`/`first_to_score`/`margin`/
`clean_sheet` e as **regras de settlement puras pra todas elas já rodam em produção**
(`lib/settlement/rules/palpite-dispatch.ts`), + cartões via extração web (ADR 0033/#394).

**O que falta não é compreensão nem settlement — é (1) um boundary de input que aceite a
aposta como o usuário fala, (2) um modelo de precificação pra props derivados de placar que
nenhum bookmaker cobre, e (3) persistência** pra "minha aposta" ter ciclo de vida
(graded → pendente → acertou/errou) em vez de evaporar.

## O design proposto: "Aposta livre"

**Conceito:** digite sua aposta em português na match page — o app parseia em pernas tipadas
que você confirma num toque, dá a cada perna uma probabilidade + leitura de valor sóbria na
SUA odd, e depois trackeia e liquida a aposta após o jogo, como um badge de palpite mas no
registro de valor.

### Jornada
1. Aba "Minha aposta": usuário digita texto livre — *"Palmeiras 2x0, casa marca primeiro,
   odd 8.50"* (ou toca chips de exemplo).
2. Uma call **Haiku barata** parseia → slip tipado Zod-strict; a UI ecoa de volta como **chips
   de perna editáveis** — `[Placar exato 2–0] [Mandante marca primeiro]` — cada um com badge
   de settleability ("conferimos após o jogo" / "não conferimos escanteios"). **Nada é gradeado
   até o usuário confirmar:** o slip estruturado confirmado, não o texto cru, é o contrato.
3. No confirmar, cada perna é gradeada (ver abaixo).
4. Resultado: cards por-perna com prob. de modelo, EV@odd-do-usuário, break-even, lucro-se-ganhar,
   edge onde há board ("—" onde não), leitura sóbria template-derivada, e o disclaimer §3 verbatim.
5. O slip **persiste**; após o jogo o cron de settlement marca cada perna acertou/errou/pendente;
   uma seção "Minhas apostas" mostra o histórico. Sem CTA, sem share, só autenticado.

### Input: HÍBRIDO (NL + confirmação estruturada) — recomendado
- **Por que não builder estruturado puro:** É o v1 shipado e a fonte da tediosidade — e um
  builder nunca enumera props/placares/combos sem virar uma planilha pior (o grid explode).
- **Por que não NL puro (parse→grade silencioso):** O pior modo de falha é **gradear uma aposta
  DIFERENTE da que o usuário quis** — um misparse silencioso ("over 2.5" ouvido como "under 2.5")
  produz um veredito confiante, plausível e ERRADO: exatamente o anti-padrão que o princípio
  **prefer-skip-over-silent-wrong** do repo existe pra matar.
- **Híbrido:** NL na frente + chips estruturados obrigatórios (editáveis pelo picker v1, que
  vira **editor por-chip**). O slip Zod-validado continua sendo a **única coisa que entra no
  motor de valor** (preserva o boundary fail-closed do ADR 0034 §7 — o NL é açúcar na FRENTE
  do boundary, não um buraco através dele). O confirm converte incerteza de parse em verdade
  verificada pelo usuário.

### Grading: dois caminhos, rotulados pela fonte
- **CAMINHO A — pernas cobertas por cartucho** (linhas over/under, 1X2, btts, dupla chance,
  correct_score no grid, scorer): **reusa o core cache-first do #412 verbatim** — HIT = zero
  LLM; MISS = `predict()` atrás do rate-limit; math dual-channel (EV/break-even/lucro na odd
  do usuário; edge só no board deviged do app).
- **CAMINHO B — pernas derivadas de placar** (placar exato fora do grid, margem, clean sheet,
  gols/placar 1º tempo, quem marca primeiro, totais de qualquer linha): **módulo puro novo**
  `lib/quant/scoreline-model.ts` — distribuição double-Poisson determinística, zero LLM,
  testável. λ estimados dos **mesmos agregados de form que o cartucho de palpite já computa**.
  Formas fechadas: `P(placar h–a)`, `P(margem≥k)`, `P(clean sheet)=e^−λ`, `P(over L)`, variantes
  de 1º tempo via time-share, `P(casa marca primeiro)=λh/(λh+λa)·(1−e^−(λh+λa))`. Rotulado
  **"modelo simplificado"** na UI, nunca apresentado como o número do cartucho.
- **MÚLTIPLA (o payoff elegante):** toda perna que é um predicado sobre o placar final torna a
  **probabilidade conjunta EXATAMENTE computável** somando a distribuição de placar sobre as
  células que satisfazem TODOS os predicados — capturando a **correlação do mesmo jogo** que a
  multiplicação ingênua destrói (o problema que fez o ADR 0034 deferir a múltipla **desaparece**
  pra predicados de placar final). Combos com perna dependente do tempo (quem-marca-primeiro,
  1º tempo) → grades por-perna + linha fixa "combinada não avaliada".
- **VEREDITO:** nunca uma nota/score/imperativo (ADR 0034 §10/11) — estende as strings
  `VALUE_READING` template-derivadas.

### Settlement
Persiste o slip confirmado, depois liquida **por tipo de perna** com um orquestrador novo
`settle-user-bets.ts` que **espelha `settle-palpites.ts`** e **reusa as regras puras que já
existem** (são `(params, resultData) → won|lost` sem acoplamento de tabela):
- **Derivadas do placar final** (placar exato, margem, clean sheet, 1X2, totais, btts, dupla):
  do `regulationScore` só, nunca prorrogação/pênaltis.
- **Do intervalo** (placar/gols 1º tempo): precisa `halftimeScore`; ausente → **PENDENTE visível**.
- **De evento** (quem marca primeiro, scorer): precisa `getFixtureEvents`; ausente → PENDENTE.
- **Cartões:** liquidável pela extração web shipada (#394/ADR 0033), mas **coverage-gated**
  (`CARDS_COVERED_LEAGUES` vazio hoje ⇒ inerte) — pernas de cartão liquidam só onde a cobertura
  ligar, senão pendente.
- **Escanteios:** honestamente **NÃO-liquidável** (o achado empírico de web-search-settlement:
  tabelas JS-rendered, variância ±1) — o parse ACEITA a perna mas marca "não conferimos
  escanteios" no confirm, `settleable=false` derivado do kind (nunca do LLM), nunca entra em query.

### Firewall
O firewall de linguagem de valor **NÃO se aplica aqui e NÃO deve ser enfraquecido** — essa
superfície vive no registro Análise/Recomendação onde edge/EV/stake/odd são sancionados
(ADR 0034 §9; **ZERO novos callers de `containsValueLanguage`**). O que **carrega verbatim**:
(a) disclaimer §3 completo em todo render — é a superfície de MAIOR intenção de aposta; (b)
framing "não é recomendação de aposta" — vereditos são leituras descritivas, nunca imperativas,
nunca nota/medidor verde-vermelho; (c) **nenhum campo chamado `verdict`** em schema novo (colide
com o campo guardado da manchete); (d) **NUNCA compartilhável** — grades de aposta são Análise
privada autenticada, sem caminho pra `/p/[id]` nem OG; (e) o pipeline da manchete fica **intocado**.

### Data model
Migration nova (próximo número livre ≥0041 — verificar no `db:generate`): `bet_slips`
(id, matchId, userId, rawInput, parseAiCallId nullable, createdAt); `bet_legs` (id, slipId,
kind enum, params jsonb narrowed-por-Zod, userOdd, modelProbPct, gradeSource, pinnedPredictionId,
settleable derivado-do-kind); `bet_leg_outcomes` (legId UNIQUE, result, resultData, settledAt).
**Não** mexer em predictions/ai_calls/palpites (a partição do ADR 0028 fica). Módulos puros
novos: `lib/quant/scoreline-model.ts` e `lib/ai/bet-parse/` (cartucho de parse).

### Riscos
1. **Custo** — cada grade adiciona 1 parse Haiku (barato, logado) + MISS de cartucho = `predict()`
   cheio; cobrar slots POR perna cara (como o `analyzeMarkets`), cap MAX_LEGS ~4, HIT free.
2. **Misparse → aposta errada gradeada** — mitigado pelo confirm obrigatório + Zod strict + echo + `rawInput` guardado.
3. **Overconfiança do modelo** — double-Poisson seed de 5 jogos é ruidoso; rotular "modelo
   simplificado", arredondar, usar o ciclo de settlement como loop de calibração de graça.
4. **Frustração com não-liquidável** — setar expectativa NO CONFIRM (badge), não depois do jogo.
5. **Regulatório** — aprofunda a superfície de máxima-intenção + persiste intenção de aposta;
   todo escudo do ADR 0034 carrega verbatim; re-afirmar no-share/no-CTA/no-grade também pras views de histórico.
6. **Armadilha de correlação** — nunca multiplicar probs de perna do mesmo jogo; joint-sum ou recusar.
7. **Processo** — isso emenda materialmente o ADR 0034 → **ADR-first**. E design/build contra
   `origin/main` em worktrees, nunca o checkout local stale.

## Recomendações (dimensionadas)
1. **ADR-first: "Aposta livre" — emenda o ADR 0034** (NL input + scoreline model + persistência/settlement) · M · **ADR**
2. **Tracer bullet: perna de placar-exato end-to-end** (parse → confirm → grade Poisson → persist → settle → badge) · L
3. **`lib/quant/scoreline-model.ts`** — módulo Poisson puro determinístico · M *(← MESMO módulo do Report 03)*
4. **Cartucho de parse `lib/ai/bet-parse/`** (Haiku, união Zod-strict de pernas, seam + ai_calls) · M
5. **Persistência + orquestrador `settle-user-bets.ts`** (espelha settle-palpites) · M
6. **Evolução da UI da aba "Minha aposta" + histórico "Minhas apostas"** · M
7. **Precificação de combo do mesmo jogo via joint scoreline sum** · S
8. **Loop de calibração: trackear grades Poisson vs resultados antes de promover EV de prop-leg** · S

## Relação com o discovery #352
**#352 está FECHADO e resolvido** em `origin/main` (v1 = ADR 0034 + #412). Este redesenho é uma
**v2 de uma superfície shipada**, não greenfield: preserva as decisões aceitas do ADR 0034
(dual-channel, cache-first, fail-closed, registro-Análise, escudos §10-13) enquanto relaxa
deliberadamente os três exatos itens que o ADR 0034 deferiu/excluiu — múltipla, props sem
cartucho, e persistência. Processo correto = ADR novo emendando 0034.

**Sinergia:** o `lib/quant/scoreline-model.ts` é o **mesmo** modelo Poisson do
[Report 03](./03-ia-cientifica.md). Sequenciar juntos: constrói uma vez, serve os dois itens.
