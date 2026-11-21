# PLAN-668 — Palpite determinístico

Issue: #668. Bug de produção (Palmeiras x Flamengo, 2026-11-21): o mesmo jogo, analisado 4 vezes (motor `code_jev`), deu manchete e placar provável trocando de lado. Num dos runs, o "Ver raciocínio" dizia "Resultado (1X2): Casa" enquanto a manchete dava vitória do visitante por 1–2. Decisão do dono: **o palpite é o resultado mais provável**, decidido em código. A base de probabilidade é **plugável**; o dono escolheu (2026-11-21) **mercado + nossos ajustes** (`market_first`), com Dixon-Coles só sem preço (report 13: peso ótimo do DC = 0 no 1X2).

## Estado atual (aterrado no código)

- **Quem escolhe o resultado e o placar é o LLM.** `lib/ai/palpites/cartridges/cartridge.ts` (`palpites_v12`): `probableScore` no Zod `.strict()` e na ferramenta `submit_palpite`. O `SYSTEM_PROMPT` manda usar edge/odd e "crave o azarão" (ADR 0031). O `buildUserMessage` imprime só a seleção recomendada (`recomenda "Casa" (prob, edge, odd)`); as três chances do 1X2 nunca aparecem.
- **Orquestração.** `lib/ai/palpites/index.ts`: `generatePalpites` → `runSynthesis` (Zod, `containsValueLanguage`, fidelidade #380) → `headline` + linhas (`buildSettleablePalpiteRows`).
- **"Casa" é a escolha de valor.** `recommendedLabel` = `getMarketPresentation(...).outcomeLabel`; `analysesDetail` imprime `${marketLabel}: ${recommendedLabel}`. É a seleção de maior edge do `runCodeJevEngine`, não o resultado mais provável.
- **Confiança e resultado de fontes diferentes.** `pregameConfidenceProbs` prefere `match_model_snapshots` (ADR 0069 §3).
- **λ do run gravado.** `judgments.lambda.{base, adjusted, rho}` e `judgments.multipliers` (`adjusted = base × multipliers.applied`, JEV + contexto). Todas as análises code_jev de um run compartilham λ.
- **Odds do run gravadas** em `prediction_selection_odds.odd`, chegam em `PredictResult.selections[].odd` e `PredictionWithAiCall.selections[].odd`; `synthesis-input.ts` descarta hoje.
- **Chamadores**: `analyzeBestBet` (em memória) e `generatePalpiteFromAnalyses` (histórico); ao vivo `generateLivePalpites` (`palpites_live_v2`, LLM escolhe de `likelyFinalScores`).
- **Contexto extra**: `palpite-hero.tsx:190-199` limpa e fecha o campo depois do sucesso; a extração (Haiku) roda a cada análise.
- **Calibração**: `lib/calibration/palpite-confidence.ts` valida `confidenceSource` com enum fechado; valor novo some da calibração sem aviso.

## Decisão de desenho

1. **Resultado e placar em código.** Regra `most_likely_v1`: argmax de `p1X2(matriz)`; dentro dele, o placar mais provável. Desempate de placar como em `topScorelines`; entre resultados, ordem home → draw → away com `>` estrito.
2. **Base plugável** `{lambdaHome, lambdaAway, rho, source}` (λ antes dos fatores do jogo) × multiplicadores do run.
   - `market`: odds 1X2 congeladas da análise `match_result` do run, sem margem (proporcional), λ ajustados para a matriz (mesmo ρ) reproduzir o 1X2 (+ over da análise `over_under` como regularizador), depois os multiplicadores JEV + contexto do run.
   - `dc_jev`: `judgments.lambda.base` × multiplicadores (= `adjusted`).
   - `snapshot`: λ de `match_model_snapshots`, multiplicadores null.
   - Constante `PALPITE_BASE_STRATEGY: "market_first" | "model_only"` (não flag: trocar em execução mistura eras). `market_first`: market → dc_jev → snapshot → LLM v12. `model_only`: dc_jev → snapshot → LLM v12.
   - As odds são as congeladas na análise (já passaram pelo portão de frescor): "Gerar só o palpite" sobre as mesmas análises dá o mesmo palpite.
3. **Confiança da mesma matriz**: `probs[outcome]`, faixas do ADR 0069; `confidenceSource = pick.source`.
4. **O LLM só escreve** verdict, narrative, citedMarkets, cardsTemperature, firstHalfScore e firstToScore (conferidos contra o placar). O v13 **tira `probableScore`** do schema e da ferramenta (sobrescrever deixaria veredito escrito pra outro placar e `ai_calls` com placar não gravado). Sem fonte nenhuma, roda o v12 como está.
5. **Conferência determinística do texto**: verdict/narrative que declara vencedor o outro time, "empate" quando é vitória (e vice-versa), ou "zebra/azarão" pro escolhido → template coerente. Sem segunda chamada paga. Firewall igual.
6. **Insumo v13**: bloco "Palpite do modelo (fixado)" com resultado, placar e as três chances com nomes; a seleção de valor vira "preço", sem números de edge/odd. Sem citar a base (mercado/modelo).
7. **"Ver raciocínio"**: nomes dos times, valor como "preço", linha do palpite com a fonte.
8. **Contexto extra fica no campo** depois do sucesso.
9. **Ao vivo**: mesma regra sobre `scoreline.matrix` (`palpites_live_v3`).

## Mudança

### 1. Núcleo puro

- `lib/quant/scoreline-model.ts`: `argmaxScoreline(matrix, pred?)` (ignora p ≤ 0, desempate de `topScorelines`, null sem candidato) e `mostLikelyOutcome(probs)`. `MatchOutcome` exportado daqui.
- `lib/quant/market-fit.ts` (novo, puro): `MARKET_FIT_VERSION = "market_fit_v1"`, `fitLambdasToMarket({oneXTwo, overUnder?}, {rho?, maxIterations?}): {lambdaHome, lambdaAway, maxErrorPp, iterations} | null`. Levenberg-Marquardt em (ln λh, ln λa), Jacobiano por diferença finita, ponto de partida fixo, λ preso a [`LAMBDA_MIN`, `LAMBDA_MAX`], ≤ 100 iterações; null se o 1X2 não fecha em 1 pp ou alvos inválidos. Determinístico.
- `lib/ai/palpites/pick.ts` (novo, puro): `PALPITE_PICK_RULE`, `PALPITE_BASE_STRATEGY`, tipos `PalpiteBase`, `PalpitePick` (`rule, source, outcome, score, probs (pp), scorePct, lambda, base, multipliers`), `pickFromBase`, `pickFromMatrix(matrix, "live_matrix")`, `marketBaseFromAnalyses`, `runJudgmentsFromAnalyses` (prioridade match_result → double_chance → over_under → btts → qualquer code_jev), `snapshotBase`, `resolvePregamePick`, `reconcileFirstHalf`, `reconcileFirstToScore`. Invariante testada: dc_jev reproduz `judgments.lambda.adjusted`.
- `lib/ai/palpites/verdict-coherence.ts` (novo, puro): `teamAliases`, `checkTextCoherence` (contradição-only; narrative só presente/futuro), `templateVerdict`, `templateNarrative` (sem %, sem termo de valor).
- `lib/ai/palpites/outcome-labels.ts` (novo): `outcomeWithTeams(marketKey, selectionKey, teams)` (1X2 e dupla chance).
- `lib/ai/palpites/finalize.ts` (novo, puro): `finalizeModelPick`, `finalizeLlmPick` (v12, confiança null), `finalizeLivePick` → `{verdict, narrative, citedMarkets, probableScore, rows, confidence, headlineExtras, detailLines}`.
- `confidence.ts`: `confidenceFromPick(pick)`; `PalpiteConfidenceSource` ganha `market | dc_jev` (mantém `analysis` pra sets antigos); `pregameConfidenceProbs`/`matchResultProbsFromAnalyses` saem.

### 2. Cartucho v13 e síntese (commit `prompt:`)

- `cartridge.ts`: v12 vira `palpitesLlmPickCartridge` byte-idêntico; novo `palpitesCartridge` `palpites_v13` sem `probableScore`, `SYSTEM_PROMPT_V13` estático sem "crave o azarão" e com a regra do resultado fixado; input ganha `pick`; mensagem com o bloco fixado e "preço" nas análises, sem edge/odd.
- `registry.ts`: `getPalpiteCartridge("model_pick" | "llm_pick")`.
- `settleable-rows.ts`: recebe o tipo estrutural; portões iguais.
- `fidelity-validator.ts`: roda sobre o texto final.
- `synthesis-input.ts`: carrega `odd`; `MarketAnalysisSummary` ganha `odds`, `line`, `predictionCreatedAt`, `judgmentsModel` (não vão ao prompt) nos dois caminhos.
- `index.ts`: `SynthesisSpec.finalize`; loop Zod → finalize → guarda de valor → fidelidade; `headline.pick`, `templated`, confiança do pick; `console.warn` `palpite_text_templated`; snapshot só lido sem base do run.
- `db/schema.ts` `PalpiteHeadline` (tipo TS do jsonb): `confidenceSource` ampliado, `pick`, `templated`. A view (`lib/view/palpites-headline.ts`) não expõe `pick` nem `templated`.

### 3. "Ver raciocínio" (`details.ts`)

`analysesDetail(analyses, teams, {live?})`: "preço mais interessante em vitória do X" / "nenhum preço chamou atenção"; ao vivo mantém "sem escolha neste mercado". `synthesisDetail` ganha a linha do palpite por fonte (mercado / modelo / base do jogo / ao vivo / IA sem modelo). "preço" permitido; odds/cotação/edge/%/casa proibidos.

### 4. Ao vivo (`palpites_live_v3`)

Sai `probableScore`; input ganha `pick` de `pickFromMatrix(scoreline.matrix)`; sai o `superRefine`; `finalizeLivePick` com `buildLivePalpiteRows`.

### 5. Contexto extra

- `palpite-hero.tsx`: o texto e o painel ficam depois do sucesso; dica "O que estiver aqui vai junto em 'Analisar de novo'."
- Reaproveitamento da extração por hash do texto: ver revisão do plano (candidato a corte/acompanhamento — exige reler o `tool_use` gravado em `ai_calls` e HMAC por LGPD).

### 6. Calibração, copy e ADR

- `palpite-confidence.ts`: enum ganha `market`/`dc_jev`; eras `modelo | motor | llm`; corte por fonte. Página `/admin/motor/calibracao` com os rótulos.
- Copy: glossário ("placar provável", "confiança"), `como-funciona`, `como-usar`.
- `docs/decisions/0072-palpite-deterministico-pelo-modelo.md`: emenda ADR 0031 e ADR 0069 §3; registra regra, base plugável, escolha do dono, fit, template.

## Testes

- `scoreline-model.test.ts`: `argmaxScoreline`, `mostLikelyOutcome`.
- `market-fit.test.ts`: ida e volta de λ com ρ; over coerente e conflitante; favorito extremo; alvos inválidos → null; determinismo.
- `pick.test.ts`: prioridades nas duas estratégias; odds faltando; invariante dc_jev; snapshot; reconciliações; ao vivo nunca abaixo do placar atual. **Regressão**: `match_result` code_jev recomendando `home` por valor com odds 2.90/3.30/2.35 → `outcome === "away"`; `model_only` com adjusted (0.95, 1.55) → away; dez chamadas iguais.
- `verdict-coherence.test.ts`, `finalize.test.ts`, `cartridge.test.ts` (v13 rejeita `probableScore`; mensagem com 3 chances e "preço", sem edge/odd; system sem "azarão"; v12 intacto).
- `generate-palpites` (unit + pglite): fontes, v12 sem fonte, template, `probableScore` → `invalid_output`, **determinismo**: dois runs com textos diferentes → mesmo `exact_score` e confiança.
- Ao vivo, `synthesis-input`, `details`, `confidence`, calibração (enum), view sem `pick`, `palpite-hero` (campo continua preenchido e aberto).

## Migration

Nenhuma (jsonb + tipos).

## Riscos

- Distribuição do `exact_score` muda (mais 1–0/1–1/0–1, quase nenhum empate escolhido). Eras separadas por `promptVersion` e `headline.pick`.
- Mercado + JEV pode contar desfalque duas vezes; `multipliers` gravados permitem medir.
- /p: veredito de template passa no `unsafeForPublic`; `pick` não vai a público; o resultado reflete o contexto do dono, sem texto exposto.
- Conferência por regex: falso negativo passa; falso positivo vira template (seguro).
- Determinismo depende de JEV reaproveitado (6 h) e mesmos dados; dado real novo muda o palpite, e isso é correto.
- Dois system prompts (v12/v13) = duas entradas de cache.

## Acompanhamentos

- Medir mercado+JEV vs mercado puro (dupla contagem).
- Tirar o "crave o azarão" do v12 (sem fonte).
- Contexto em `sessionStorage`; reaproveitamento da extração se não entrar aqui.
- Base de mercado no modelo ao vivo.

## Ajustes da revisão do plano (valem sobre o texto acima)

Escolha do dono (2026-11-21): **mercado + nossos ajustes** (`market_first`). Mercado e Dixon-Coles se complementam: base do mercado sem margem, fatores JEV/contexto por cima, DC (dc_jev) quando não há preço.

**Obrigatórios**
- **M1. Fit por bisseções aninhadas, não Levenberg-Marquardt.** Interna: a divisão s = λh/T tal que pH − pA bata com o mercado sem margem. Externa: o total T tal que P(over linha) bata com o over/under sem margem da análise `over_under` **do mesmo run**, na linha dela (`pOverUnder(matrix, line)`); sem over/under do mesmo run, a externa bate o pD (solução exata 2×2). Funções monótonas (testar), reusar `bisect` de `lib/odds/implied-probability.ts`. T limitado pra cada λ ficar em [`LAMBDA_MIN`, `LAMBDA_MAX`]; sem clamp depois dos multiplicadores. ρ = `judgments.lambda.rho ?? DIXON_COLES_RHO` da mesma predição, no fit e na matriz final. Devolve os resíduos pra log em vez de null por erro do empate.
- **M2. Histórico: odds, ρ e multiplicadores da MESMA predição (`match_result`).** Over/under só se for do mesmo run (mesmo `judgments.stateHash`/`aiCallId` de JEV, ou `createdAt` a poucos minutos); senão ignora. `headline.pick` grava `basePredictionId` e `predictionCreatedAt`. Regra explícita: mesmas análises → mesmo palpite (o "Gerar só o palpite" não reconfere frescor).
- **M3. Paridade dos caminhos**: odds arredondadas a 3 casas (como `numeric(6,3)`) nos dois caminhos antes do de-vig. Sem rows de odds no histórico → cai pra dc_jev (aceito, teste documenta).
- **M4. Calibração**: o enum de `confidenceSource` ganha `market`/`dc_jev`; era nova derivada da presença de `pick` (`pick: z.unknown().optional()` no parse). Mudar o tipo `PalpiteHeadline` no mesmo commit. Sem retrabalho de eras além disso.
- **M5. Conferência estrutural**: o v13 ganha o campo obrigatório `verdictOutcome: home|draw|away` (tool + Zod); diferente de `pick.outcome` → verdict de template. Regex só no verdict e só sinais de alta precisão: cita só o alias do outro time (tirando tokens comuns aos dois e normalizando acento/caixa), placar `\d+\s*(x|×|–|-|a)\s*\d+` diferente do pick, ou "empate" quando o pick é vitória. A narrative não passa por checagem de resultado. Template só no campo que falhou. Sem regra de "zebra".
- **M6. 1º tempo e primeiro a marcar decididos em código** do mesmo λ: `firstToScore` = vencedor do pick; "none" em 0–0; empate não-zero → maior de `firstToScoreProbs`. `firstHalfScore` = argmax de `firstHalfScorelineMatrix` nas células ≤ o placar final. Saem do tool/Zod do v13; somem `reconcileFirstHalf`/`reconcileFirstToScore`. O LLM escreve só verdict, verdictOutcome, narrative, citedMarkets, cardsTemperature.

**Importantes**
- **S1. Com pick, falha de texto vira palpite de template, não palpite nulo** (vazamento de linguagem de valor, fidelidade, Zod): a row de `ai_calls` fica com o status real; texto de template. Idem em erro de provedor/prazo se simples.
- **S2. Insumo do v13 sem puxar pro lado do valor**: pra `match_result` e `double_chance`, sem "recomenda/preço" e sem o racional; passa os rótulos de mercado (pra citedMarkets), as frases de fator (`judgmentFactorPhrases`) e a palavra da confiança (baixa/média/alta) pro tom bater com o chip.
- **S3. Sem `snapshot` como base do pick.** Cadeia: market → dc_jev → v12 exatamente como hoje (inclusive `pregameConfidenceProbs` no v12).
- **S4. dc_jev usa `judgments.lambda.adjusted` direto**; pra base de mercado, multiplicadores = `adjusted/base` por lado.
- **S5. Rótulos com time**: reusar `selectionLabel` de `lib/ai/markets/_narrator/labels.ts`; sem `outcome-labels.ts`.
- **S6. O pick é calculado dos summaries antes de `buildPredictionInput`** (o parse do input tira campos desconhecidos).
- **S7. "Ver raciocínio" entra neste PR** ("preço", sem %, sem termos de valor; `run-progress.ts` descarta linha com % ou termo de valor).

**Cortes / adiados**
- Ao vivo v3: adiado (acompanhamento ~40 linhas com `pickFromMatrix`).
- Reaproveitamento da extração por hash: cortado; registrar no risco que a extração (Haiku) segue não determinística, mas o campo agora fica preenchido.
- Copy de glossário/como-funciona/como-usar: só corrigir frase que afirme que a IA escolhe o placar; o resto adiado.
- `model_only`: só um `if`, sem cadeia completa testada em dobro.
- Persistência do campo no `palpite-hero.tsx`: commit próprio.
- ADR 0072 curto.

**Detalhes**
- Ordem de desempate home → draw → away com `>` testada; gravar `|pH − pA|` no pick.
- `MatchOutcome` num lugar só (mover e reexportar).
- `pick.probs` gravado no headline (servirá à feature do azarão).

**Testes a mais**: T2 paridade dos caminhos (incl. histórico com over/under de outro run ignorado); T3 invariância à ordem das análises; T4 propriedades com λ aleatório (`scoreOutcome(score) === outcome`, confiança = `probs[outcome]`, linha `exact_score` = score, 1º tempo ≤ final, `firstToScore` coerente); T5 fit (monotonia, ida e volta, favorito 1.05, linhas 1.5/3.5, odds inválidas → null); T6 corpus da conferência ("Sem zebra: Palmeiras vence", Atlético-MG x Atlético-GO, Man City x Man United, "O Flamengo assusta, mas o Palmeiras leva" não disparam; `verdictOutcome` divergente dispara); T7 falha de texto com pick → set de template + row auditada; T8 pglite: dois runs com textos diferentes → mesmas rows `exact_score`, `first_half_score`, `first_to_score` e mesma confiança. (Sem acesso ao banco de produção: o fixture real dos 4 runs e a taxa de template sobre saídas v12 gravadas ficam como verificação pós-deploy.)

## Notas da implementação

O que saiu diferente do texto acima, e por quê:

- **Nomes**: o v13 é `palpitesModelPickCartridge` (em `cartridges/model-pick.ts`) e o v12 virou `palpitesLlmPickCartridge`; `getPalpiteCartridge("model_pick" | "llm_pick")`. O v12 continua em `cartridge.ts`, com as seções da mensagem extraídas (`pushMatchFactLines`, `pushNewsLines`) e conferido byte a byte contra o de antes.
- **Fit**: antes da bisseção externa, uma grade de 40 pontos acha o 1º trecho com troca de sinal. Perto dos limites de λ a divisão fica presa e a função do total deixa de ser monótona (o favorito de 1.05 caía no λ máximo dos dois lados).
- **Mesmo run**: `|Δ createdAt| ≤ 5 min` e, com JEV nas duas análises, o mesmo `stateHash`. O `aiCallId` do JEV não entra: num reuso ele aponta pra chamada de origem, horas antes.
- **1X2 sem julgamentos** (motor LLM) ainda dá base de mercado, sem multiplicadores e com o ρ pinado.
- **Fatores no insumo do v13**: `factorPhrases` calculado em `synthesis-input` com a mesma regra do racional (#565: sem os fatores que o contexto extra moveu; contexto ilegível → nenhum).
- **Falha de texto com pick**: prazo sem tempo pra chamada também vira template (sem row em `ai_calls`); sem chave de API segue lançando. Linguagem de valor troca só o campo que vazou; uma row de `ai_calls` por chamada (vazamento + fidelidade juntos no mesmo `errorMessage`, pra o custo não contar duas vezes).
- **Página de calibração**: tocada só no rótulo da era `modelo` e na contagem "sem confiança" (agora da era motor).
- **Copy**: o `como-funciona`, o texto do HERO vazio (pré-jogo) e a landing diziam que a IA crava o palpite; os três agora dizem que o resultado e o placar saem da conta e a IA escreve o porquê (o `como-funciona` cita o caminho v12, sem dado pra conta). O HERO ao vivo segue "a IA crava" (o ao vivo ainda é `palpites_live_v2`).
- **`finalizeLivePick`** existe, mas o ao vivo segue no `palpites_live_v2` (v3 adiado).
- **Reaproveitamento da extração** (voltou na correção do code review): sem hash nem coluna. `reuseExtraction` (`lib/ai/user-palpite/extract.ts`) procura no `ai_calls` a última row ok da mesma pessoa, jogo e versão do prompt cuja mensagem do pedido Anthropic (`input_payload->'messages'->0->>'content'`) é a mesma (texto normalizado + times) e relê o `tool_use` gravado pelas mesmas regras da extração nova. Nada novo é gravado; o texto cru já estava no pedido logado.
