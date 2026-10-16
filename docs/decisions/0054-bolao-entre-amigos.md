# ADR 0054 — Bolão entre amigos: apostadores sem conta, ganhadores em código, o app não toca em dinheiro

## Status

Accepted (2026-10-13). Issue #567, pedido direto do dono. Emenda o ADR 0046 (exclusão de conta ganha um passo) e se apoia no ADR 0048 (envelope regulatório). **Decisão 3 emendada pela [ADR 0060](./0060-modo-ao-vivo-estado-do-jogo-modelo-em-jogo-registros-marcados.md)** (2026-10-15): com o modo ao vivo ligado, as apostas fecham aos 15 minutos de jogo; tirar aposta continua bloqueado a partir do apito.

## Contexto

O Palpiteiro nasceu pra aposta em casa entre amigos: o grupo se reúne, cada um faz a sua aposta num jogo, e no fim quem acertou divide o prêmio. Até aqui o app só registrava as apostas do próprio usuário ("Suas apostas", ADR 0053), avaliadas contra o modelo. Faltava o caso original: anotar a aposta de cada amigo e saber quem ganhou.

Os amigos não têm conta, e não faz sentido exigir uma pra participar de uma brincadeira de sábado. O dono também fixou (2026-10-13) que o app nunca se liga a casa de apostas.

## Decisão

1. **Modelo.** `friend_pools` (dono, jogo, nome opcional, valor por pessoa opcional em centavos, placar manual opcional) e `friend_pool_entries` (nome do apostador + aposta tipada com o mesmo `kind`/`params` das pernas de aposta). Um bolão é de um jogo. Migration 0056 com `IF NOT EXISTS` e blocos `DO` (DB de preview compartilhado).
2. **Quem anota.** Só o usuário logado, que cadastra todo mundo. Apostador é texto livre (até 40 caracteres), sem login, convite ou link público. Tudo filtrado pelo `userId` da sessão.
3. **Apostas aceitas.** Placar exato (padrão), resultado, dupla chance, os dois marcam, mais/menos de 1,5/2,5/3,5 gols. Os `params` passam pelos schemas Zod das regras de settlement, então o que entra é o que a regra sabe conferir. As apostas fecham no apito inicial (mesmo gate de pré-jogo da análise, `matchUnavailableReason`): depois disso não dá pra anotar nem tirar aposta, porque tirar quem perdeu mudaria o pote e a parte de cada ganhador. Excluir o bolão inteiro continua possível. *(Emendado pela ADR 0060: com `enable_live_mode` ligado, anotar fica aberto até 15 minutos de jogo, ou apito + 15 min de relógio sem minuto do provider; o dono pode fechar antes e o admin pode estender os próprios bolões; cada aposta ao vivo grava minuto e placar. Tirar aposta segue bloqueado a partir do apito. Atualização #601: o dono também reabre as apostas: antes do apito volta o prazo de sempre; depois dele, ficam abertas até o jogo acabar.)*
4. **Ganhadores em código.** Placar = o digitado à mão, se houver; senão o do jogo encerrado. Cada aposta é conferida pelas mesmas funções de `USER_BET_SETTLEMENT_RULES` sobre `palpiteResultDataFrom` (`lib/pools/winners.ts`): a regra de cada tipo de aposta é a mesma de "Suas apostas"; só a fonte do placar difere (ver item 5). Sem LLM, sem Odds API, sem chamada a provider: é leitura do DB. O resultado não é gravado; é derivado a cada render (barato e sempre coerente com o placar atual).
5. **Placar manual.** O sync de jogos roda a cada 6h; no fim do jogo em casa ninguém quer esperar. O usuário pode lançar o placar depois do apito e voltar pro do jogo quando quiser (override, como o CLAUDE.md pede pro settlement). O placar do jogo vem de `goals` do provider e inclui a prorrogação; a tela avisa, e o manual resolve se o grupo combinou o tempo normal.
6. **Divisão.** Pote = valor por pessoa × apostas; cada ganhador leva `floor(pote ÷ ganhadores)` e a sobra de centavos é mostrada. Ninguém acertou: a tela diz isso e deixa o pote com o grupo. Não há rateio proporcional nem acúmulo automático.
7. **Dinheiro e casas (ADR 0048).** O app não recebe, não guarda, não repassa e não cobra nada: só anota e faz a conta. Nenhum link, logo, odd ou menção a casa na tela do bolão. Aviso de risco (ADR 0048 §4) e a nota "o acerto é entre vocês" no rodapé.
8. **LGPD.** Nomes de amigos são dados de terceiros que o titular digita. A Política de Privacidade orienta usar só primeiro nome/apelido de quem topou participar. Na exclusão de conta, `DELETE FROM friend_pools WHERE user_id=$1` (cascata pras apostas) entra no batch do ADR 0046. O FK `user_id` é `restrict`, como `bet_slips`, porque o `users` vira lápide e nunca é deletado.

## Enquadramento legal

- **Lei 14.790/2023** regula aposta de quota fixa explorada por agente operador. O bolão não tem quota fixa nem operador, e o app não intermedeia nada (ADR 0048 Decisão 1 continua valendo).
- **Lei de Contravenções Penais (Decreto-Lei 3.688/1941), art. 50.** A contravenção é estabelecer ou explorar jogo de azar em lugar público ou acessível ao público. O §3º, "c", inclui as apostas sobre competição esportiva. O §4º, "a", equipara a lugar acessível ao público a casa particular onde habitualmente jogam pessoas de fora da família. O §2º multa quem é encontrado participando como apostador. O texto foi conferido em fonte secundária (legjur.com), porque o planalto.gov.br estava fora do ar. O risco, se houver, é do grupo que joga com habitualidade, não da ferramenta que só anota. O app não estabelece nem explora o jogo, não cobra entrada e não fica com parte do pote. Por isso o valor é opcional e o app não guarda dinheiro: a mesma tela serve pra um bolão valendo só a resenha. *Não verificado:* jurisprudência específica sobre bolão entre amigos sem organizador nem lucro.
- **Gatilho pra reabrir.** Qualquer função que movimente dinheiro (cobrar, guardar ou pagar o pote, Pix), torne o bolão público ou aberto a desconhecidos, ou tire uma taxa transforma o app em quem "estabelece ou explora" o jogo. Isso exige um ADR novo e revisão legal antes de implementar.

## Alternativas consideradas

1. **Aposta em texto livre** — rejeitada: o app não saberia dizer quem ganhou, que é o pedido.
2. **Conta por amigo / convite** — rejeitada por ora: atrito alto pra uma brincadeira em casa, e criaria dados pessoais de terceiros com login.
3. **Bolão de vários jogos (rodada)** — fora por ora: um jogo por bolão cobre o pedido e mantém a conferência trivial. Uma rodada pode virar um agrupador depois.
4. **Gravar o resultado (outcome rows)** — rejeitada: derivar na leitura é barato e acompanha correção de placar sem job de settlement.

## Consequências

- **(+)** O caso de uso original do app existe, sem custo de IA nem de API.
- **(+)** A mesma regra de conferência de "Suas apostas", sem duplicação.
- **(−)** O placar do jogo inclui a prorrogação. Em mata-mata decidido na prorrogação, o grupo precisa lançar o placar dos 90 minutos se foi isso que combinou.
- **(−)** Até 50 apostas por bolão, e a lista mostra os 100 bolões mais recentes.
