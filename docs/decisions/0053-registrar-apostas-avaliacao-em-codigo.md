# ADR 0053 — Registrar apostas: grade de mercados + lista, avaliação em código

## Status

Accepted (2026-10-13). Issue #556 (Fase 2 da proposta "pré-previsão, bet slip e análise do seu palpite", decidida pelo dono como "Base primeiro"). **Substitui** o `GradeMyBet` do ADR 0034 (a avaliação avulsa sem salvar sai) e a tabela de roteamento A/B do ADR 0036 Decisão 3. **Emenda** o ADR 0036 em três pontos (edge do modelo, stake sugerido, gate de mercados) e atualiza as referências de arquivo do ADR 0048 Decisão 4. Mantém intactos: dual-channel (odd do usuário fora do Σ1/odd), boundary Zod fail-closed no registro, slip imutável, `MAX_LEGS = 4` na combinada, limiters de parse e de slips, disclaimer §3 completo e o firewall do `/p/[id]` (ADR 0034 §12–13, ADR 0036 Decisões 5 e 8). **Decisões 5 e 6 emendadas pela [ADR 0060](./0060-modo-ao-vivo-estado-do-jogo-modelo-em-jogo-registros-marcados.md)** (2026-10-15): ao vivo, sem edge do modelo e sem stake sugerido. **Alternativa 2 implementada pela [ADR 0063](./0063-explicar-com-ia-na-avaliacao-das-apostas.md)** (2026-10-21): "Explicar com IA" sob demanda na avaliação pré-jogo.

## Contexto

"Minha aposta" vivia numa aba presa à análise principal: o usuário digitava a aposta, conferia o parse e confirmava; a parte de baixo avaliava uma odd sem salvar (`GradeMyBet`). O dono pediu o fluxo das casas: todas as opções à vista, clicar no que apostou, registrar, e a avaliação vir depois, com tudo o que o app sabe (Dixon-Coles, análise da IA/JEV, quarter-Kelly).

Desde o ADR 0036 o cenário mudou: o λ vem do Dixon-Coles em produção (ADR 0051), o motor `code_jev` decide 1X2, O/U, BTTS e dupla chance em código (ADR 0041), e o `prewarm-odds` já guarda snapshots completos desses mercados. O backtest #558 (report 13) mostrou que o DC sozinho não bate as odds de fechamento.

## Decisão

1. **Superfície.** Seção "registrar apostas" na página do jogo, fora das abas da análise: grade com resultado, dupla chance, ambas marcam, total 1.5/2.5/3.5 e placar exato (os 6 mais prováveis + "outro placar"). Cada seleção mostra a odd de referência quando há snapshot completo; senão a odd justa do modelo em cinza. Lista "Suas apostas" à direita no desktop, barra fixa + sheet no celular. Odd editável, pré-preenchida só com a de referência (nunca com a justa); stake opcional. Modo Simples (um slip por seleção) ou Combinada (um slip, conjunta da matriz). O atalho "ou digite sua aposta" (parse do ADR 0036) só **preenche** a lista; nada é salvo sem "Registrar apostas".
2. **Avaliação em código, na hora do registro.** `evaluateSlip` (`lib/bets/evaluate-slip.ts`) é puro: sem LLM, sem limite diário de análises, sem chamada nova à Odds API (referências vêm do DB, `lib/db/queries/reference-odds.ts`, até 48h). O modelo do jogo vem de UMA porta, `resolveSlipModel` (`lib/bets/slip-model.ts`); a Fase 1 (ADR 0052) troca o corpo pela base por jogo, com fallback.
3. **Probabilidade: análise primeiro, modelo depois.** Se o usuário já tem análise daquele mercado/linha, vale a probabilidade dela (`gradeSource = 'cartridge'`, `pinnedPredictionId`), que no `code_jev` já inclui DC + ajustes JEV. Senão, a matriz do modelo (`gradeSource = 'scoreline_model'`). O motor do placar (`dixon_coles` | `heuristic`) é gravado por perna em `bet_legs.model_source` (migration 0054), fechando o gap de calibração que impedia separar DC de heurístico.
4. **Gate de mercados.** Todo mercado da grade vale em toda liga e pra todo usuário: a avaliação é código determinístico, sem custo, e a matriz já precificava esses predicados na combinada. Some a tabela A/B do ADR 0036 Decisão 3; cartões e escanteios seguem aceitos sem avaliação.
5. **Edge do modelo (emenda o ADR 0036 Decisão 3).** O ADR 0036 proibia edge nas pernas do modelo porque não havia board completo pra de-vigar. Agora, quando há snapshot **completo** do mercado da perna, o edge é `modelProb − implied` com a implícita de-vigada pelo `computeMarketScenarios` (overround do mercado inteiro, `impliedSumTarget` da dupla chance = 2). Continua proibido derivar implícita de `1/userOdd`. Placar exato nunca tem edge (não há board completo). O rótulo é "edge do modelo" e a avaliação sempre traz o aviso do backtest #558. *(Emendado pela ADR 0060: ao vivo não há edge do modelo, porque a referência é pré-jogo; a probabilidade vem sempre do modelo em jogo calculado na hora, não de uma análise salva.)*
6. **Stake sugerido.** Só com odd informada e EV > 0 na odd do usuário. **Bandas do motor** (`computeStakeUnits`, 1–3u) são a regra oficial; **quarter-Kelly é informativo**, simples por perna ou **conjunto** em Simples com 2+ pernas na matriz (`lib/quant/simultaneous-kelly.ts`: maximiza E[log riqueza] sobre os padrões de resultado da matriz, Σf ≤ 0,99). Soma do registro limitada a 3u (redução proporcional em degraus de 0,5u, devolvendo o arredondamento às pernas de maior resto; não soma registros anteriores do mesmo jogo). Na combinada o stake sugerido é só o da combinada; as pernas não ganham stake nem odd própria. Promover o Kelly a oficial fica com a decisão pendente do dono sobre o quarter-Kelly (gate de CLV do ADR 0039 Decisão 3). *(Emendado pela ADR 0060: ao vivo não há stake sugerido, nem banda nem Kelly; o modelo em jogo não tem calibração.)*
7. **Envelope legal (ADR 0048).** Botão "Registrar apostas", nunca "Apostar". O ADR 0048 Decisão 2 veda "cupom" como objeto ligado a casa; o rótulo na tela é "Suas apostas" pra não ler como cupom de casa. Nome de casa só como fonte da odd de referência, sem link. Disclaimer §3 completo, como constante local `RISK_DISCLAIMER_PT_BR` em `components/bet-slip.tsx` (e em `app/(app)/apostas/page.tsx`), renderizado junto da lista e da avaliação (substitui `components/free-bet.tsx` e `components/grade-my-bet.tsx`, citados no ADR 0048 Decisão 4). Leitura do valor é template a partir do sinal do EV; sem nota, sem medidor. Nada de `bet_slips`/`bet_legs` chega ao `/p/[id]` nem ao OG.

## Alternativas consideradas

1. **Manter o `GradeMyBet` (avaliar sem salvar)** — rejeitado: o dono quer registrar e então avaliar; a avaliação na hora do registro cobre o caso e mantém um único caminho.
2. **Avaliar com LLM ao registrar** — rejeitado: custo e limite diário por clique; a probabilidade já existe em código (DC) ou na análise salva. Uma explicação com IA, sob demanda e via `lib/ai/predict.ts`, fica pra depois da Fase 1.
3. **Kelly como stake oficial já** — rejeitado por ora: o gate de CLV (ADR 0038) não liberou e o DC sozinho não bate o fechamento (#558).
4. **Melhor preço entre casas** — fora deste ADR: pede snapshots por casa na grade e cuidado com o ADR 0048; issue de follow-up.

## Consequências

- **(+)** Registrar uma aposta é tocar e confirmar; avaliação imediata, grátis, com o motor gravado por perna.
- **(+)** Uma porta só pro modelo: a Fase 1 troca a fonte sem tocar avaliação nem UI.
- **(−)** O edge do modelo ainda é a opinião do DC, que perde pro fechamento; o aviso fica na tela até o blend com o mercado (calibração) entrar.
- **(−)** Pernas fora da matriz (escanteios, cartões) seguem sem avaliação.
- **(−)** Simples com N seleções consome N do limite diário de slips (`RATE_LIMIT_BET_SLIPS_PER_DAY`).
