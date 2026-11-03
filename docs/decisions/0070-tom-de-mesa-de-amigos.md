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
7. **Etiquetas com dado (#656)** são regra em código, nunca texto do LLM, e cada uma tem teste (`lib/view/match-tags.ts`):
   - **reta final**: ao vivo, 2º tempo, do minuto 80 em diante, só com o estado ao vivo fresco.
   - **deu zebra**: jogo encerrado cujo resultado (casa, empate ou fora) tinha menos de 20% na base do modelo conferida até 24h antes do apito. No bolão sem ganhador, "Deu zebra: ninguém acertou." pela mesma regra, só com o jogo encerrado (o placar lançado à mão pode vir no meio do jogo ou num jogo cancelado).
   - **chocolate**: vitória por 3 gols ou mais.
   - **azarão**: antes do jogo, o lado com menos de 20% de vitória na base fresca.
   - **Freguesia**: nos confrontos diretos listados (até 5, no mínimo 4 com placar), um time venceu 4 ou mais.
   - **cravou o placar**: ao lado do selo Acertou do palpite da IA (só dentro do app, não na /p), e na linha do placar exato acertado em Suas apostas e no bolão.
   - **Ficou na trave.**: placar exato errado por um gol só, depois do jogo, em Suas apostas e no bolão (no bolão, também só com o jogo encerrado).

   As etiquetas de linha ficam no /jogos (as quatro) e no /time (reta final e chocolate, que não usam a base do modelo); o cabeçalho do jogo não leva nenhuma (firewall da ADR 0030, como a linha do modelo). Zebra e chocolate usam o placar sincronizado, que inclui prorrogação.

## Consequências

- (+) O app fica com cara de mesa de amigos sem mexer nos prompts, na liquidação nem no firewall regulatório.
- (+) A lista Fora é verificada por teste, não só por revisão.
- (−) O teste olha só as superfícies listadas. Tela nova com tom precisa entrar na lista (as pastas de bolão e apostas entram sozinhas).
- (−) "Na trave" é um "quase acertou". Ficou liberado por decisão do Fernando (é tudo de brincadeira), mas só depois do jogo e nunca junto de um convite pra apostar de novo.

## Alternativas rejeitadas

1. **Suas apostas neutro, só o bolão brincando.** Rejeitada pelo Fernando: Suas apostas é registro, não dinheiro real.
2. **Deixar "fezinha" de fora** por soar como minimizar o risco. Rejeitada pelo Fernando.
3. **Tom só de poker.** O poker foi um exemplo; a gíria de futebol e de turfe encaixa melhor no app.
