# ADR 0067 — Símbolo da marca: gol no ângulo

## Status

Accepted (2026-10-23). Substitui a ADR 0066 (o "p" com o anel de probabilidade). Fernando escolheu na rodada 3 da proposta de logo (#637): o gol como logo e o papagaio como mascote. O mascote fica fora desta ADR e vira uma issue própria.

## Contexto

O símbolo da ADR 0066 foi recusado na verificação da marca do OAuth do Google: "Your logo does not uniquely identify your brand". O Fernando também achou o "p" simples demais. A verificação não cobra qualidade, cobra que o logo identifique o app sozinho, e um "p" branco num quadrado azul é genérico.

A rodada 2 trouxe quatro símbolos que não são uma letra sozinha: trave com a bola no ângulo, papagaio, bola com rabinho de balão e medidor de chance. Na rodada 3, o Fernando pediu um meio-termo entre a trave e o medidor:

- cantos arredondados, sem perder a cara de trave;
- a bola no ângulo;
- a trave direita esmaecida, como o "não preenchido" do medidor;
- um pouco de cor;
- sem rede.

## Decisão

1. **Símbolo:**
   - Trave de frente, com cantos em curva: a esquerda e o travessão num traço branco.
   - Trave direita em branco com opacidade 0,32.
   - Bola amarela (`#ffb547`) entrando no ângulo, com três traços de rastro do chute, também a 0,32.
   - O fundo continua no mesmo azul (`#0057c0` no claro; no DOM, o `--primary` do tema).
2. **O amarelo da bola é a segunda cor da marca.** O azul continua sendo a principal.
3. **Mesma fronteira de código da 0066.**
   - A geometria fica só em `components/brand/brand-mark.tsx` (viewBox 100×100, só atributos de SVG).
   - `markGlyph(cut)` recebe a cor do fundo pros gomos da bola: o Satori passa hex e o DOM passa `currentColor`, com `text-primary` no `<svg>`.
   - Os gomos da borda são lentes calculadas (interseção de dois círculos), sem `clipPath`. Assim o Satori e o navegador desenham igual, e não há id duplicado quando o símbolo aparece duas vezes na página.
4. **PNG do Google com o nome.** O `pnpm brand:export` grava o 120×120 do Google com o símbolo e "palpiteiro" embaixo, em Geist SemiBold, dentro da área que sobra no recorte em círculo. A fonte vai junto em `scripts/fonts/` (licença OFL), porque o next/og só traz a Noto Sans. Só o script lê esse arquivo.

## Alternativas rejeitadas

1. **Papagaio como logo.** É o mais único, mas a 16px vira só um pássaro e não diz futebol. Fica como mascote animado.
2. **Bola com rabinho de balão.** Bola é o símbolo mais comum de app de futebol e de aposta.
3. **Medidor sozinho.** Lembra painel de carro e teste de velocidade de internet; a ideia dele sobrevive na trave esmaecida.
4. **Rede no fundo do gol.** Detalhe demais; a 32px parecia um calendário.

## Consequências

- Abaixo de 32px o rastro e a trave esmaecida quase somem. Na aba, o símbolo é um arco branco com um ponto amarelo, o que é aceitável.
- Os ícones já instalados nos celulares só trocam quando o sistema relê o manifest ou o apple-touch-icon (no iOS, ao adicionar de novo à tela de início).
- Depois do merge, o Fernando sobe `docs/brand/palpiteiro-google-oauth-120.png` em Google Cloud → Auth → Branding e escolhe "I have fixed the issues".
