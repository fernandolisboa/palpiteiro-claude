# ADR 0057 — Avisos de responsabilidade na página do jogo: um por tela

## Status

Accepted (2026-10-15). Issue #576 (linha 19 da revisão de design de 2026-10). **Emenda a ADR 0055 Decisão 10** (o "Seu palpite" deixa de ter aviso de risco próprio). **Reafirma, sem emendar:** ADR 0031 §5 (`PALPITE_DISCLAIMER` na manchete), ADR 0034 §12 (o §3 completo e verbatim na tela de registro/avaliação, carregado pelo ADR 0036 Decisão 7), ADR 0053 item 7 (o §3 como constante local `RISK_DISCLAIMER_PT_BR` em `components/bet-slip.tsx`, junto da lista e da avaliação) e ADR 0048 Decisão 4 (avisos de risco na análise e no registro). Camada de apresentação: não toca prompt, seed nem valores do banco. Plano: `docs/plans/PLAN-576.md` (a "Revisão do plano" vale sobre o resto).

## Contexto

Numa tela de jogo analisado o celular mostrava até seis avisos de responsabilidade: o `PALPITE_DISCLAIMER` no fim do Palpite da IA, uma linha `ANALYSIS_RISK_DISCLAIMER` no rodapé de cada cartão de análise (até 7), o §3 completo no fim do "Seu palpite", o §3 completo abaixo da grade de registro (só no celular), o §3 completo no painel Suas apostas e o rodapé global. Repetido assim, o aviso vira ruído e ninguém lê.

A revisão de design propôs levar o §3 para o rodapé e deixar só uma linha curta no painel. A ADR 0048 (Decisão 1) diz que o art. 17 da Lei 14.790 e a Portaria 1.231 não se aplicam ao Palpiteiro, mas a Decisão 4 adota o núcleo deles voluntariamente, e a ADR 0053 item 7 atualizou as referências: o "aviso de risco na aposta" é o §3 completo do registro de apostas. A ADR 0034 §12 chama esse §3 de inegociável na tela de máxima intenção de apostar (`docs/ops/05-legal-compliance.md:117`). O que pode sair sem tocar no que a 0048 marca é só a repetição.

## Decisão

1. **§3 uma vez por tela visível, onde se registra aposta.** Na página do jogo, o §3 completo e verbatim (`docs/ops/05-legal-compliance.md:102-105`) aparece no painel Suas apostas (ao lado da grade no desktop, na folha que sobe do rodapé no celular) e, no celular, também logo abaixo da grade de registro: a folha é modal e cobre a página, então o painel e a grade nunca ficam à vista juntos. No desktop a linha abaixo da grade não aparece (o painel com o §3 está ao lado). Só existe quando o jogo aceita registro.
2. **O "Seu palpite" deixa de ter aviso próprio** (emenda a ADR 0055 Decisão 10). O resto da Decisão 10 continua: leitura de probabilidade, sem odd, edge, stake ou valor no bloco e nenhum "apostar"/"cupom" (guardas em `components/__tests__/seu-palpite-guards.test.ts`). O bloco fica na mesma tela do registro, com o §3.
3. **Uma linha de risco por análise aberta.** O detalhe da análise ("Ler análise completa") traz **uma** linha `ANALYSIS_RISK_DISCLAIMER` (`lib/view/analysis.ts`), logo antes do primeiro mercado: perto da recomendação (compliance §3) e à vista assim que abre. Nenhuma por mercado nem nas análises anteriores (o precedente é o fan-out, que já mostra uma linha só).
4. **`PALPITE_DISCLAIMER` fica na manchete** (ADR 0031 §5; o mesmo texto do `/p`). É rótulo da natureza do conteúdo ("é só um palpite"), não aviso de responsabilidade.
5. **O rodapé global não muda:** 18+, "Aposte com responsabilidade. Aposta não é investimento.", CVV 188, Jogadores Anônimos e "não é casa de apostas".
6. **Fora desta ADR:** `/p/[id]` não muda (ADR 0035). `/apostas`, bolão e landing ficam para os PRs seguintes da revisão de design, com a mesma regra (o §3 uma vez onde se registra ou lista aposta).

## Alternativas rejeitadas

- **A proposta da revisão de design (§3 no rodapé de todas as telas e uma linha curta no painel).** Tiraria "nunca para recuperar perdas" e "procure ajuda" da tela de máxima intenção; no celular a folha modal esconde o rodapé justo na hora de registrar; exigiria emendar 0034 §12, 0053 item 7 e as referências da 0048 Decisão 4 por um ganho de ~60px; e mudaria o rodapé de todas as telas (landing e `/signin` incluídas). Reabrir só com ADR nova, se o dono quiser.
- **Manter tudo como está.** Seis avisos numa tela não protegem mais que dois: a repetição ensina a pular.

## Consequências

- **(+)** Celular: −1 §3 (o do "Seu palpite") e até −6 linhas de análise numa tela de jogo analisado; o texto que a 0048/0053 marca continua inteiro onde se registra aposta.
- **(+)** Guardas de fonte travam a regra: `app/(app)/match/[id]/__tests__/one-notice.test.ts` (o §3 só sai do registro de apostas; a linha de análise sai uma vez, no detalhe) e `components/__tests__/seu-palpite-guards.test.ts`.
- **(−)** Quem só usa o "Seu palpite" no desktop vê o §3 no painel ao lado, não dentro do bloco.
- **(−)** Quando o registro sair de `components/bet-slip.tsx` (painel em arquivo próprio), a referência de arquivo da ADR 0053 item 7 muda; atualizar aqui, sem reabrir a 0053.
