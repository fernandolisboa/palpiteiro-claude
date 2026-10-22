# ADR 0055 — Contexto do usuário como afirmações a conferir ("Seu palpite")

## Status

Accepted (2026-10-13). Fase 3 da proposta "pré-previsão, bet slip e análise do seu palpite" (#564). Lê a base do jogo do ADR 0052 e o JEV do ADR 0041 sem mudar nenhum dos dois; não toca `lib/ai/predict.ts`, `lib/model-base/` nem `lib/bets/slip-model.ts`. Plano: `docs/plans/PLAN-564.md` (o §15 vale sobre o resto).

> **Emenda (#565, 2026-10-13):** o contexto extra da análise com IA passa a alimentar o
> `predict` no motor `code_jev`. Ver a seção "Emenda (#565)" no fim: ela muda o §6 e a
> frase "não toca `lib/ai/predict.ts`" do Status para esse caminho.
>
> **Emenda (#569, 2026-10-21):** "outra informação" ganha subtipos tipados
> (`user_palpite_extract_v2`) e chega ao narrador da análise como linha do código, sem
> efeito no número. Ver a seção "Emenda (#569)" no fim.
>
> **Emenda (ADR 0060, 2026-10-15):** o bloco existe durante o jogo. A leitura pelos botões
> refaz a matriz em jogo no cliente; "Analisar meu palpite" usa a base do apito e aplica a
> transformação em jogo depois da evidência do usuário. Ver [ADR 0060](./0060-modo-ao-vivo-estado-do-jogo-modelo-em-jogo-registros-marcados.md).

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
10. **Envelope legal** (ADR 0048/0053): leitura de probabilidade, sem odd, edge, stake ou valor no bloco, aviso de risco §3 verbatim e nenhum "apostar"/"cupom". *(Emendado pela ADR 0057: na página do jogo o bloco não tem aviso próprio; o §3 fica no registro de apostas, na mesma tela.)* "Adicionar às suas apostas" só preenche a lista de registro do ADR 0053, por uma ponte de contexto no cliente.
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
- **(−)** "Peso do jogo" só é verificável no Brasileirão (`LEAGUE_TABLE_CONFIG`); nas demais ligas entra como não verificável. *(Emendado pelo #617: Premier League e La Liga também têm zonas e passam a ser verificáveis.)*
- **(−)** O bloco só aparece em jogo analisável: a análise gravada some da página depois do apito. *(Emendado pela ADR 0060: com o modo ao vivo ligado, o bloco fica aberto no 1º e no 2º tempo e no intervalo.)*

## Emenda (#565): contexto extra na análise com IA

Plano: `docs/plans/PLAN-565.md` (o §13 vale sobre o resto).

- **O que é.** Campo "Contexto extra (opcional)" (até 1.000 caracteres, CRLF contado como
  1) no HERO, junto de "Analisar com IA"/"Analisar de novo". A mesma extração
  (`user_palpite_extract_v1`, sem mudança de prompt) roda pelo seam `AIProvider`, logada em
  `ai_calls`.
- **Só no motor `code_jev`.** No motor `llm` (o kill-switch do motor), com
  `enable_user_context` desligado ou sem nenhum mercado concedido decidido em código, o
  servidor descarta o texto sem chamar a Haiku e avisa. Os cartuchos que decidem por LLM
  (placar exato, artilheiro, assistência) e a síntese do palpite **não** veem o contexto:
  ali "peso pequeno" seria uma instrução sem limite pra um modelo que define
  probabilidade, e uma afirmação não verificável não pode virar fato numa manchete
  compartilhável. Como o racional do narrador cita o que a pessoa informou, a síntese
  (no run e em "Refazer só o palpite") não o recebe quando o contexto moveu algum fator:
  recebe um racional montado em código só com os fatores do JEV que o usuário não moveu
  (ou nenhum), com as probabilidades e a seleção da row (`synthesis-input.ts`).
- **Caminho até o número.** A action dispara a extração depois da cobrança do 1º slot e
  passa a Promise ao fan-out (teto de 10 s; falha ou teto = run sem contexto). O `predict`
  a espera **uma vez por run**, depois do JEV, e confere as afirmações com `checkClaims`
  sobre os dados que **ele** buscou (desfalques com o papel da escalação anterior, o mesmo
  que o JEV viu; forma; tabela) em vez de `fetchPalpiteFacts`. A evidência sai de
  `evidenceFromClaims` e entra por `combineAnswers` (máximo, pergunta a pergunta) antes do
  mesmo `applyJudgments`, com o mesmo clamp. O memo do run guarda JEV ∨ usuário, então todo
  mercado `code_jev` do run aplica a mesma coisa.
- **O que é gravado.** `predictions.judgments.answers` continua **só o JEV** (chave do reuso
  em `findReusableJudgments`: outra análise nunca herda o contexto de alguém) e `applied`
  quer dizer "o JEV entrou". `multipliers` e `lambda.adjusted` são o que gerou a decisão. As
  afirmações conferidas (sem texto livre, sem paráfrase, sem nome de jogador: só os campos
  tipados, a contagem de jogadores, os status e a evidência em código), a evidência, o id
  da extração, os avisos e as versões ficam em `judgments.userContext`, sem coluna nova. O
  `modelVersion` ganha `;user=user_evidence_v1` só quando o contexto moveu um fator, o que
  separa essas predições num grupo próprio de calibração.
- **Narrador.** Não há bloco de texto do usuário no prompt. Os fatores que o usuário moveu
  levam a origem na própria frase de fator, "(informado por você, não conferido)" ou
  "(informado por você)", com a força ("sinal forte/moderado") vinda só do valor do JEV; vale
  pro narrador LLM e pro racional templado (`narrator_v1.1`). A origem segue o **sinal**
  que moveu o fator, não o status da afirmação: "(informado por você)" só quando foi um
  sinal confirmado pelos nossos dados (fato e papel); um desfalque que está na nossa lista
  sem posição ou como meio-campista, com o papel dito pelo usuário, sai "não conferido".
- **Teto.** O mesmo do §5: cada fator de ataque/defesa move no máximo 4,2% e uma afirmação
  falsa e não verificável move até 2,4% por fator de ataque/defesa.
- **§6 deixa de valer pra este caminho.** As **regras** de gate de edge, stake, Kelly,
  modelo e odd de referência não mudam, mas os **números** podem mudar dentro do teto por
  fator: o edge pode cruzar o piso, o stake e o ranking do best bet podem mudar. Por isso a
  tag `user=` e o "· com seu contexto" no rodapé do motor.
- **Custo.** A análise de sempre mais 1 Haiku. Nenhuma unidade a mais no limite diário,
  nenhuma chamada à Odds API e nenhuma chamada extra à API-Football (a conferência usa os
  dados do `predict`).
- **Limitações aceitas.** "Outra informação" continua sem conteúdo (só "não conferimos esse
  tipo"); subtipos tipados ficam pro #569. Se o grupo `code_jev` inteiro cair no caminho
  LLM (sem λ), o contexto não entra e a página não mostra "o que você acrescentou".

## Emenda (#569): subtipos de "outra informação"

Plano: `docs/plans/PLAN-569.md`.

- **Extração `user_palpite_extract_v2`** (mesmo prefixo `user_palpite`, coberto pela linha
  1 da redação do ADR 0046). A afirmação `other` ganha `otherKind` opcional:
  `coach_change`, `derby`, `weather`, `travel_fatigue`, `crowd`, `motivation`. Só vale em
  `other` (Zod); subtipo inválido ou em outro tópico é descartado no `normalizeClaimInput`
  (perde-se o rótulo, não a afirmação). Sem subtipo que encaixe (retrospecto, arbitragem),
  fica como antes. O prompt manda o que é peso do jogo, rodízio, momento ou desfalque pros
  tópicos que movem fator: desgaste de calendário é `rotation`, título/vaga/rebaixamento é
  `stakes`.
- **Nenhum efeito numérico.** `checkClaims` segue devolvendo "não verificável" sem sinal pra
  `other`; evidência, `user_evidence_v1`, tag `user=`, gate, stake, modelo e odds intocados.
- **A linha é do código.** `otherKindLine` (`lib/user-palpite/labels.ts`) monta a frase do
  enum e do nome do time ("troca de técnico no Flamengo"; clássico e clima são do jogo).
  O narrador `code_jev` (`narrator_v1.2`) recebe essas linhas num bloco "Informado por você
  (não conferido, sem efeito nos números)", só quando há alguma (sem nota, a mensagem é a
  mesma da v1.1); a regra 4 manda citá-las uma vez como informação da pessoa, nunca como
  fato nem como motivo dos percentuais. O racional templado também as registra (uma a uma,
  as que cabem inteiras no limite), pra todo mercado do run ter a nota mesmo quando o LLM
  não narra.
- **Gravação.** `otherKind` (enum) entra em `predictions.judgments.userContext.claims` e em
  `user_palpite_analyses.claims`; sem texto livre, "Onde NÃO há PII" do ADR 0046 continua
  valendo.
- **Síntese.** Como o racional do narrador passa a citar a nota mesmo sem fator movido, a
  síntese do palpite trata "tem nota" (`hasContextNote`) como "moveu": recebe o racional
  montado em código (fatores do JEV que o usuário não moveu).
- **Aviso do HERO.** Sem fator movido e com nota: "não mudou os números; … foi passado à
  análise como informação sua, não conferida" (não promete que o texto do LLM a cite).
- **"Seu palpite".** Mesma extração (v2); a tela mostra o subtipo como tópico. O narrador do
  palpite não muda (`user_palpite_narrate_v1`/`_live_v1` byte-idênticos): ele já recebe a
  paráfrase cercada.
