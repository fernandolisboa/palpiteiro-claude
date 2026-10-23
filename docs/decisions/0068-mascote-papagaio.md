# ADR 0068 — Mascote: o papagaio palpiteiro

## Status

Accepted (2026-10-23). Na rodada 3 da proposta de logo (#637, #640), o Fernando escolheu o gol como logo e o papagaio como mascote. Esta ADR complementa a ADR 0067 (o símbolo) e emenda a ADR 0065 (o personagem do progresso e o movimento reduzido).

## Contexto

O papagaio era a direção mais única da proposta: papagaio dá palpite em tudo, que nem o amigo do bolão. Só que a 16px ele vira apenas um pássaro e não diz futebol, então ficou como mascote, nos lugares onde há espaço. O Fernando pediu o olho animado, terminando num trevo verde.

O progresso do "Analisar com IA" já tem um personagem, o robozinho da ADR 0065. O Fernando prefere o robô ali, mas quer ver o papagaio ao vivo e decidir. Então a escolha virou uma configuração.

Ele também achou que o ícone da etapa em andamento parecia travado. O motivo: no computador dele, "Efeitos de animação" está desligado, e a regra global de movimento reduzido para tudo. O spinner só respirava, e um círculo com seta parado parece travado.

## Decisão

1. **Desenho.** O papagaio de perfil, em branco, no mesmo ladrilho azul do símbolo (`--primary` do tema). O olho é amarelo, o mesmo amarelo da bola (ADR 0067). O bico fica separado da cara por um vão na cor do fundo. Componente: `components/brand/parrot-mascot.tsx`.
2. **Animação, em ciclo de 8 s:**
   - o olho pisca;
   - o olho ganha os gomos da bola (a mesma bola do símbolo, via `markBall`);
   - a bola vira um trevo de quatro folhas;
   - o trevo cresce até tomar o ícone, e depois tudo volta.

   O trevo é de um verde claro (`#6fcb60`), com luz e saturação parecidas com as do amarelo da bola, sem neon. Os keyframes ficam em `app/globals.css` (`.parrot-*`), sem CSS inline, por causa da CSP.
3. **Personagem do progresso: configuração.** A flag enum `progressMascot` em /admin/ia aceita "Robozinho" (padrão) ou "Papagaio". Ela é a coluna `ai_config.progress_mascot`, criada na migration 0064 com `IF NOT EXISTS`. A página do jogo lê o valor e passa ao HERO e ao `PalpiteProgress`. O personagem dá um pulinho a cada etapa pronta.
4. **O papagaio fica sempre em três lugares:**
   - no card do tour guiado, com um pulinho a cada passo;
   - no chamado do tour do /como-usar;
   - nos estados vazios de página (`EmptyState mascot`), que são a lista de jogos, apostas, bolão e desempenho.

   Os vazios de seção (forma, confrontos, tabela) e os do admin ficam como estão.
5. **Movimento reduzido.**
   - O estado parado do papagaio é o próprio papagaio (bola e trevo escondidos).
   - ~~O olho leva `palpite-calm` e só respira, igual aos olhos do robô.~~ _(Emenda de 2026-10-23, pedido do Fernando: os dois personagens animam por completo mesmo com movimento reduzido. A classe `mascot-motion` na raiz do SVG tira o robô e o papagaio da regra global, e a respiração `palpite-calm` saiu. O resto do app continua respeitando a preferência do sistema.)_
   - **Emenda da ADR 0065:** o spinner da etapa em andamento (`palpite-spin`) gira também com movimento reduzido, um pouco mais devagar (1,4 s por volta). É o indicador de que algo está carregando, e parado ele parece erro.

## Alternativas rejeitadas

1. **O papagaio substituindo o robô no progresso.** Rejeitada pelo Fernando: ele prefere o robô ali. A configuração deixa comparar os dois ao vivo.
2. **Terminar a animação com a bola entrando no gol (o logo).** Rejeitada pelo Fernando: a ideia era o trevo. A ressalva de que trevo é imagem de sorte fica registrada, mas a decisão é dele.
3. **Animação com CSS dentro do SVG.** Rejeitada: a CSP (ADR 0040) pede nonce em `<style>` inline, e o globals.css já é onde moram as animações do app.

## Consequências

- O DESIGN.md descreve os dois personagens e a configuração.
- A bola do olho é a do símbolo: mudar a bola em `brand-mark.tsx` muda também o mascote.
- O papagaio nos estados vazios anima o tempo todo, inclusive numa lista vazia. Se incomodar, a solução é uma variante parada.
