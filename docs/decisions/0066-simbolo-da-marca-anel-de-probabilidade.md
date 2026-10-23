# ADR 0066 — Símbolo da marca: o "p" com o bojo de medidor de probabilidade

## Status

Superseded pela ADR 0067 (2026-10-23): o Google recusou este símbolo na verificação da marca do OAuth e ele virou a trave com a bola no ângulo. Antes: Accepted (2026-10-23). Fernando escolheu a direção A da proposta de logo (#629). Complementa a ADR 0059 (marca só "palpiteiro"): o nome continua igual, agora com o símbolo ao lado.

## Contexto

Até aqui o app tinha só o ícone de instalação (o "p" branco no azul, #616) e o nome escrito em Geist no header. Não havia símbolo de marca no app, e o fallback do card OG do `/p` e o card do palpite compartilhado mostravam só o texto.

A proposta comparou quatro direções (anel de probabilidade, balão de conversa, bola no "p", o "p" atual com pingos azuis), cada uma em aba, tela de início, header claro/escuro e de 16 a 72px. Restrições: app de apostas entre amigos, sem cara de casa de aposta (nada de fichas, dados, dinheiro, dourado ou neon), mesmo azul, legível a 16px.

## Decisão

1. **Símbolo:** o "p" do #616 com o bojo como medidor: 68% do anel cheio (de 9h, atrás da haste, até ≈ 5h, no sentido horário) e o resto com opacidade 0,38, parando antes da haste. Mesmo azul (`#0057c0` no claro; no DOM, `--primary` do tema).
2. **Uma geometria só**, em `components/brand/brand-mark.tsx` (viewBox 100×100, só atributos de SVG). O `AppIconMark` (Satori: favicon, manifest, apple-touch-icon, cards OG) e o `BrandSymbol` (DOM) desenham a partir dela. Um teste trava os traços.
3. **O `Wordmark` sempre leva o símbolo** à esquerda do nome (24px), no header do app e nas telas públicas. O símbolo é decorativo (`aria-hidden`); quem nomeia é o texto e o `aria-label` do link.
4. **Cards OG:** a landing já usava o `AppIconMark`; o fallback do `/p` e o card do palpite compartilhado passam a mostrar o símbolo antes de "palpiteiro".
5. **Fora do app:** `pnpm brand:export` grava em `docs/brand/` o símbolo em SVG (arredondado e quadrado) e em PNG (512 e o 120×120 da tela de consentimento do Google), pelo mesmo renderizador do app. O teste `scripts/__tests__/brand-assets.test.ts` falha se esses arquivos ficarem diferentes do código. O upload em Google Cloud → Auth → Branding é manual.

## Alternativas rejeitadas

1. **Balão de conversa.** Caloroso, mas é o clichê de app de chat e, abaixo de 32px, a ponta faz o "p" parecer um R.
2. **Bola no "p".** Leitura direta de futebol, mas é o símbolo de todo app de aposta, e os gomos viram ruído em tamanho pequeno.
3. **Manter o "p" e só pintar os pingos dos "i".** Zero risco, mas o símbolo seguiria sem contar nada do app.

## Consequências

- Os ícones já instalados nos celulares só trocam quando o sistema relê o manifest/apple-touch-icon (no iOS, ao adicionar de novo à tela de início).
- Abaixo de 16px o trecho atenuado some e o símbolo vira um "p" com o bojo levemente aberto; aceitável.
- Mudança de símbolo daqui pra frente mexe em `brand-mark.tsx`, no teste e em `docs/brand/` (rodar `pnpm brand:export`).
