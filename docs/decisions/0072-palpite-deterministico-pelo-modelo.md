# ADR 0072 — Palpite determinístico: o resultado mais provável, decidido em código

## Status

Accepted (2026-11-21, #668). Emenda a ADR 0031 (síntese value-aware: sai o "crave o azarão" quando há fonte de λ) e a ADR 0069 §3 (fonte da confiança do palpite).

## Contexto

Palmeiras x Flamengo, 2026-11-21: o mesmo jogo, analisado 4 vezes com o motor `code_jev`, deu manchete e placar provável trocando de lado. Num dos runs, o "Ver raciocínio" dizia "Resultado (1X2): Casa" (a seleção de maior **edge**, não a mais provável) enquanto a manchete dava vitória do visitante por 1–2. O LLM do `palpites_v12` escolhia resultado e placar a partir da seleção de valor e da instrução de cravar o azarão; a confiança vinha de outra fonte (snapshot). Decisão do dono: **o palpite é o resultado mais provável**, decidido em código.

## Decisão

1. **Regra `most_likely_v1`** (`lib/ai/palpites/pick.ts`): o resultado de maior chance no 1X2 da matriz Dixon-Coles e, dentro dele, o placar de maior chance. Desempates: entre resultados, mandante → empate → visitante com `>` estrito; entre placares, os de `topScorelines`. O placar do 1º tempo (argmax da matriz de 1º tempo nas células ≤ o placar final) e quem marca primeiro (o vencedor; ninguém no 0–0; num empate com gols, o lado com mais chance de marcar primeiro) saem do mesmo λ.
2. **Base plugável**, constante `PALPITE_BASE_STRATEGY` (não flag: trocar em execução mistura eras):
   - `market` (escolha do dono, `market_first`): o 1X2 congelado na análise `match_result` do run, sem margem (proporcional), com λ ajustados para a matriz reproduzir o mercado (`lib/quant/market-fit.ts`, `market_fit_v1`). Por cima, os multiplicadores JEV + contexto extra da **mesma** predição (`adjusted/base` por lado) e o ρ dela.
   - `dc_jev`: `judgments.lambda.adjusted` do run, direto. Usado quando não há preço completo.
   - Sem nenhuma das duas: o cartucho `palpites_v12` roda como antes (o LLM escolhe), com a confiança da ADR 0069.
3. **Ajuste ao mercado por bisseções aninhadas**: interna, a divisão s = λh/T tal que P(H) − P(A) bata com o mercado; externa, o total T tal que P(over linha) bata com o over/under sem margem da análise `over_under` **do mesmo run** (mesmo estado JEV e criada a ≤ 5 min), ou, sem ela, tal que P(empate) bata com o 1X2. λ preso a [`LAMBDA_MIN`, `LAMBDA_MAX`]; quando o alvo do total não cabe, fica a ponta mais perto e os resíduos vão para o headline. Se a divisão não fecha (P(H) − P(A) a mais de 1 pp do mercado, `MAX_SPLIT_RESIDUAL_PP`), não há ajuste e a base é a `dc_jev`.
4. **Mesmas análises → mesmo palpite.** As odds são as congeladas na análise (já passaram pelo portão de frescor), arredondadas a 3 casas nos dois caminhos (run em memória e "Gerar só o palpite"); "Gerar só o palpite" não reconfere frescor.
5. **O LLM só escreve** (`palpites_v13`): verdict, `verdictOutcome`, narrative, citedMarkets e cardsTemperature. `probableScore`, `firstHalfScore` e `firstToScore` saem do schema e do tool (`.strict()` os rejeita). O palpite fixado vai na mensagem do usuário; system prompt e tool seguem estáticos (ADR 0071).
6. **Conferência do texto**: `verdictOutcome` ≠ resultado do palpite → veredito de template; regex de alta precisão só no veredito (cita só o outro time, placar diferente, "empate" num palpite de vitória sem citar o vencedor). Sem segunda chamada paga.
7. **Falha de texto com palpite vira template, não palpite nulo**: erro do provedor, ferramenta não chamada, Zod, linguagem de valor ou fidelidade gravam a row de `ai_calls` com o status real e o set sai com o texto de template (só nos campos que falharam, quando dá pra saber). O firewall (ADR 0030 §3) segue igual.
8. **Confiança da mesma matriz** (emenda a ADR 0069 §3): `probs[outcome]` do palpite, mesmas faixas, `confidenceSource` = `market` ou `dc_jev`. O snapshot só é lido no caminho v12.
9. **Persistência sem migration**: `headline.pick` (regra, fonte, resultado, placar, P do 1X2 em pp, λ, base, multiplicadores, ρ, ajuste e resíduos, `basePredictionId`, `predictionCreatedAt`) e `headline.templated`. A view não lê nenhum dos dois. A calibração ganha a era `modelo` (sets com `pick`).

## Consequências

- O mesmo jogo com os mesmos dados dá o mesmo palpite; dado real novo (odds, JEV) muda o palpite, e isso é correto.
- A distribuição do `exact_score` muda: mais 1–0/1–1/0–1, quase nenhum empate escolhido (raramente é o resultado mais provável antes do jogo). Eras separadas por `promptVersion` e `headline.pick`.
- Mercado + JEV pode contar o mesmo desfalque duas vezes (o preço já o reflete); os multiplicadores gravados permitem medir.
- O campo do contexto extra fica preenchido depois do run, e o "Analisar de novo" com o mesmo texto reaproveita a última extração ok da mesma pessoa no mesmo jogo (relida do `ai_calls`, sem migration): a Haiku não é determinística e duas leituras do mesmo texto podiam mexer em fatores diferentes. Texto diferente extrai de novo.
- Dois system prompts (v12/v13) = duas entradas de cache.
- Acompanhamentos: palpite ao vivo pela mesma regra (`palpites_live_v3`), tirar o "crave o azarão" do v12, medir mercado+JEV contra mercado puro.
