# ADR 0068 — Mascote: o papagaio palpiteiro

## Status

Accepted (2026-10-23). Na rodada 3 da proposta de logo (#637, #640), o Fernando escolheu o gol como logo e o papagaio como mascote. Complementa a ADR 0067 (símbolo) e substitui o item 6 da ADR 0065 (o robozinho do progresso).

## Contexto

O papagaio era a direção mais única da proposta (papagaio dá palpite em tudo, que nem o amigo do bolão), mas a 16px vira só um pássaro e não diz futebol. Por isso ficou de mascote, onde há espaço. O Fernando pediu o olho animado.

O progresso do "Analisar com IA" já tinha um personagem, o robozinho da ADR 0065, que existe pra o run não parecer parado. Dois personagens no app seria demais, e o papagaio cumpre o mesmo papel com a cara da marca.

## Decisão

1. **Desenho.** O papagaio de perfil, em branco, no mesmo ladrilho azul do símbolo (`--primary` do tema). O olho é amarelo (o amarelo da bola, ADR 0067), e o bico fica separado da cara por um vão na cor do fundo. Componente: `components/brand/parrot-mascot.tsx`.
2. **Animação.** Um ciclo de 8 s:
   - o olho pisca;
   - o olho vira bola;
   - a bola voa pro ângulo, enquanto o papagaio se desfaz na trave e vira o símbolo da marca;
   - o símbolo fica um tempo na tela e depois tudo volta ao papagaio.

   A bola e a trave são as do símbolo (`markBall` / `markGoal` em `brand-mark.tsx`), então o mascote e o logo nunca se desencontram. Os keyframes ficam em `app/globals.css` (`.parrot-*`), sem CSS inline, por causa da CSP.
3. **Termina no gol, não no trevo.** A proposta original fechava com um trevo de quatro folhas tomando o ícone. Saiu porque sorte é o contrário do que o app vende (palpite com o porquê), e trevo é imagem típica de casa de aposta. O Fernando pode trazer de volta; é só a última etapa dos keyframes.
4. **Acompanha o que acontece.** `beat` sobe a cada passo (etapa pronta no run, próximo passo do tour) e o papagaio dá um pulinho de 6 unidades, como o robô fazia.
5. **Onde aparece:**
   - ao lado do título do progresso do "Analisar com IA" e do "Gerar só o palpite", no lugar do robozinho (`palpite-bot.tsx` foi removido);
   - no card do tour guiado.
6. **Movimento reduzido.** O estado parado é o papagaio, e é o que fica quando a regra global zera as animações. O olho leva `palpite-calm` e só respira na opacidade, como os olhos do robô faziam.

## Alternativas rejeitadas

1. **Papagaio como logo.** Rejeitado pelos motivos da ADR 0067.
2. **Manter o robozinho e pôr o papagaio só no tour.** Rejeitado: seriam dois personagens, e o robô não tem nada da marca.
3. **Animação com CSS dentro do SVG.** Rejeitada: a CSP (ADR 0040) pede nonce em `<style>` inline, e o globals.css já é onde moram as animações do app.

## Consequências

- O DESIGN.md descreve o mascote no lugar do robô.
- O símbolo, o mascote e os ícones saem da mesma geometria. Mudar a bola ou a trave muda os três.
