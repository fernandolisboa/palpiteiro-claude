# ADR 0070 — Tom de mesa de amigos

## Status

Accepted (2026-11-03). Pedido do Fernando no thread da landing, depois da passada de copy do #654. Proposta: [Tom de mesa de amigos no Palpiteiro](https://claude.ai/artifact/LWGUHazZNHRP6RMc66yMbs). Issues #655 (copy e firewall) e #656 (etiquetas com dado).

## Contexto

O app é pra apostar entre amigos, mas o texto estava seco ("Nenhum bolão ainda", "Ganhou: Ana", "Fechar apostas"). O Fernando quer mais diversão, com gíria de quem aposta na resenha. Poker foi só um exemplo; vale futebol, turfe e mesa de bar.

Ele também fixou um fato do produto: **Suas apostas não significa dinheiro de verdade.** O app só registra; ele mesmo nunca apostou um centavo. Então Suas apostas pode brincar igual ao bolão.

O limite vem da ADR 0048 §4, que adotou de forma voluntária as regras de conteúdo dos arts. 16 e 17 da Lei 14.790: sem promessa de acerto ou lucro e sem apresentar aposta como renda.

## Decisão

1. **Regra do tom: comemorar o palpite e a resenha, nunca o ato de apostar.** A gíria fala do jogo e da turma, não do dinheiro. Nada convida a apostar mais, de novo ou pra recuperar.
2. **Onde brinca:** bolão, Suas apostas, telas vazias, etiquetas de jogo (#656) e a landing.
3. **Onde fica neutro:** o palpite da IA (segue "É palpite, não recomendação de aposta"), avisos de risco, 18+, jogo responsável, Termos, Privacidade, mensagens de erro e as etapas do progresso da análise (ADR 0064). Os selos Acertou, Errou e Devolvida são dado de liquidação e não mudam.
4. **Glossário liberado:** cravar, zebra, azarão, foto de chegada, reta final, chocolate/lavada, freguês/freguesia, fezinha, chute, galera/turma, resenha, palpiteiro do bolão, secar, na trave (só depois do jogo), mesa. Zona cinzenta: blefe. A fonte viva é a tabela da proposta.
5. **Fora, sempre:** "bet" (inglês e marca das casas `.bet.br`); barbada, certeza, garantido (promessa); bora recuperar, revanche, dobrar a aposta, all-in, forrar (convite a apostar mais). O teste `__tests__/voice-firewall.test.ts` barra essa lista no texto de tela das superfícies do item 2, menos "certeza", que aparece legítima em confirmações ("tem certeza?") e fica pra revisão.
6. **Grafia:** "fezinha", sem acento, como "cafezinho".
7. **Etiquetas com dado (#656)** são regra em código, nunca texto do LLM, e cada uma tem teste.

## Consequências

- (+) O app fica com cara de mesa de amigos sem mexer nos prompts, na liquidação nem no firewall regulatório.
- (+) A lista Fora é verificada por teste, não só por revisão.
- (−) O teste olha só as superfícies listadas. Tela nova com tom precisa entrar na lista (as pastas de bolão e apostas entram sozinhas).
- (−) "Na trave" é um "quase acertou". Ficou liberado por decisão do Fernando (é tudo de brincadeira), mas só depois do jogo e nunca junto de um convite pra apostar de novo.

## Alternativas rejeitadas

1. **Suas apostas neutro, só o bolão brincando.** Rejeitada pelo Fernando: Suas apostas é registro, não dinheiro real.
2. **Deixar "fezinha" de fora** por soar como minimizar o risco. Rejeitada pelo Fernando.
3. **Tom só de poker.** O poker foi um exemplo; a gíria de futebol e de turfe encaixa melhor no app.
