# ADR 0055 — Contexto do usuário como afirmações a conferir ("Seu palpite")

## Status

Accepted (2026-10-13). Fase 3 da proposta "pré-previsão, bet slip e análise do seu palpite" (#564). Lê a base do jogo do ADR 0052 e o JEV do ADR 0041 sem mudar nenhum dos dois; não toca `lib/ai/predict.ts`, `lib/model-base/` nem `lib/bets/slip-model.ts`. Plano: `docs/plans/PLAN-564.md` (o §15 vale sobre o resto).

## Contexto

O usuário quer dar o próprio palpite e explicar o porquê ("o Palmeiras está sem o artilheiro", "o Flamengo vem de três vitórias"). Duas coisas não podem acontecer: o texto livre virar instrução pro modelo de linguagem, e esse texto mover a probabilidade sem limite (ou contando duas vezes o que o JEV já viu). Ao mesmo tempo, a pergunta "qual a chance do meu palpite?" não precisa de IA nenhuma: é uma leitura da matriz de placares que o modelo já tem.

## Decisão

1. **Leitura grátis pelos botões, sem IA.** O servidor serializa só `{ λ mandante, λ visitante, ρ }` da leitura "sem o seu contexto" (base × JEV) e o cliente refaz a matriz com `scorelineMatrix` e lê o palpite com as mesmas funções puras que o servidor usa na análise gravada (`lib/user-palpite/reading.ts`): números idênticos, sem round-trip e sem endpoint novo. O palpite vem **sempre** dos botões (placar 0–9 × 0–9 ou resultado); o LLM não extrai palpite.
2. **Texto do usuário é dado.** Cercado no prompt (`<<<MOTIVO>>>`, com as marcas neutralizadas no texto), Zod na saída (envelope e item a item, corte em 8 afirmações com aviso), e o segundo modelo (o narrador) só vê **paráfrases validadas** (LGPD): o extrator é instruído a não pôr nome de jogador no `text` ("o jogador citado" ou a função), e o código ainda tira de todas as paráfrases os nomes que o extrator identificou como jogador em `players` (nome inteiro e cada pedaço, sem caixa nem acento, palavra inteira, o mais longo primeiro, nunca uma palavra do nome de um dos times). Nome que o extrator não pôs em `players` não é detectado pelo código. Na mensagem do narrador, cada afirmação é uma linha só: os campos do código (status, evidência, efeito) vêm antes e a paráfrase fecha a linha entre aspas, sem quebra de linha nem aspas duplas. O motivo cru nunca vai ao narrador.
3. **Afirmações tipadas e conferidas em código** (`lib/user-palpite/check-claims.ts`): desfalque, time completo, momento, rodízio, peso do jogo, outro. Cada uma sai **confirmada**, **contradita** ou **não verificável**, com evidência em PT-BR que cita o dado (desfalques por função, nunca por nome). Os dados são buscados **por tópico e só depois da extração** (zero afirmações = zero chamadas de API-Football), com disponibilidade explícita: dado indisponível nunca vira "vazio". Desfalque citado nunca é "contradito" (ausência na nossa lista não prova que o jogador joga); desfalque sem nome ("sem o artilheiro") vale quando a função vem, e fica não verificável, com o peso de não verificável; "time completo" com lista vazia nunca é confirmado (o provider devolve listas vazias quando o jogo não casa).
4. **O único caminho até o número é a evidência nos 4 fatores do JEV** (`lib/user-palpite/evidence.ts`, `user_evidence_v1`): noul 0,85 para confirmada (só quando o JEV não rodou; com JEV o fato já estava no state que ele julgou, então "já considerado pelo modelo") e 0,7 para não verificável ou papel dito pelo usuário. Combinação com o JEV por **máximo**, pergunta a pergunta (várias afirmações iguais não empilham e nada conta duas vezes), passando pelo mesmo `applyJudgments` unilateral e clamp sobre o λ **pré-JEV** da base (o JEV nunca é aplicado duas vezes). Contradita não gera sinal.
5. **Teto real.** Com os pesos atuais (`judgment_weights_v1`) o clamp de ±15% não chega a agir: o JEV sozinho vai de −10,7% a +9,2% por time. O limite efetivo é peso × (noul − 0,5) × 2 por fator. Com noul do usuário ≤ 0,85, cada fator de ataque/defesa move no máximo 4,2% (rodízio 3,5%, peso do jogo 2,1%); uma afirmação falsa e não verificável move até 2,4% por fator de ataque/defesa. Teste de propriedade: com evidência do usuário, a resposta combinada nunca passa de max(JEV, 0,85) e cada fator não se afasta de 1 mais que `factorMultiplier(f, max(JEV, 0,85))` (e um caso explícito garante máximo, não soma: JEV 0,8 + usuário 0,7 = 0,8).
6. **Nunca muda** gate, stake, modelo, odd de referência, clamp nem a base compartilhada. A leitura é por usuário e não alimenta o `predict`.
7. **Veredito em código** (`palpite_verdict_v1`); o LLM só narra. Pode discordar do **usuário** (só em afirmações contraditas, citando o dado), nunca do **código** (concordo × discordo é reprovado). Placar exato é dito por posição, sempre com o percentual ("está entre os 3 placares mais prováveis (9,1%)"). Guardas nos campos escritos pelo LLM: fidelidade de percentuais (±1 pp sobre o bloco "Leitura"), linguagem de valor (ADR 0030 §3) e imperativo de aposta. Qualquer falha (sem chave, provider, tool ausente, Zod, guarda, prazo) vira **template** em código; extração que falha pula a narração paga.
8. **Chamadas pelo seam `AIProvider`, fora do `predict.ts`** (precedente do ADR 0036 / `bet-parse`), com log em `ai_calls` (`user_palpite_extract_v1` na Haiku 4.5 pinada; `user_palpite_narrate_v1` no modelo de análise do usuário, até 2.000 tokens, `effort: "low"` em modelo adaptive). Custa 1 do limite diário de palpites (`checkPalpitesRateLimit`, fail-closed pra não-admin), cobrado só depois de todos os gates grátis, inclusive "tem modelo". Depois da cobrança o request não falha.
9. **Kill-switch `ai_config.enable_user_context`** (default ON, no `/admin/settings`). Desligado, o bloco mostra só a leitura pelos botões. A leitura pelos botões nunca é gateada.
10. **Envelope legal** (ADR 0048/0053): leitura de probabilidade, sem odd, edge, stake ou valor no bloco, aviso de risco §3 verbatim e nenhum "apostar"/"cupom". "Adicionar às suas apostas" só preenche a lista de registro do ADR 0053, por uma ponte de contexto no cliente.
11. **Persistência append-only** em `user_palpite_analyses` (migration 0057): palpite, motivo cru, afirmações conferidas, modelo (λ base/sem/com, respostas JEV, evidência, multiplicadores e todas as versões), leituras e narração; FKs `restrict` em usuário e jogo, `set null` nas `ai_calls`. Coberta pela exclusão de conta (emenda ao ADR 0046: DELETE por usuário e redação de `ai_calls` com `prompt_version LIKE 'user_palpite%'`).

## Alternativas rejeitadas

- **LLM estimar a probabilidade a partir do motivo:** não auditável e injetável.
- **Somar a evidência do usuário ao JEV:** conta duas vezes o que o JEV já julgou.
- **Aplicar afirmações não verificáveis com peso cheio:** uma frase falsa moveria o número como um fato.
- **Mandar o motivo cru ao narrador:** reabre a injeção e leva nomes ao segundo modelo.
- **Buscar a escalação anterior pra saber a função do desfalcado:** custo de API-Football por uso e cópia de código privado do `predict.ts`; a função vem do `enrichAbsences` e, sem ela, da afirmação, com o peso de não verificável.

## Consequências

- **(+)** A pergunta mais comum ("qual a chance do meu palpite?") é respondida de graça e na hora.
- **(+)** O que o usuário sabe e o modelo não sabia entra, limitado e auditável (cada análise grava as versões e a evidência).
- **(−)** Até 2 chamadas de LLM por uso (centavos mesmo no Opus) e até 4 de API-Football, em geral do cache.
- **(−)** "Peso do jogo" só é verificável no Brasileirão (`LEAGUE_TABLE_CONFIG`); nas demais ligas entra como não verificável.
- **(−)** O bloco só aparece em jogo analisável: a análise gravada some da página depois do apito.
