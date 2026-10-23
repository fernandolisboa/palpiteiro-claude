# Marca do Palpiteiro

Arquivos pra usar **fora do app**: tela de consentimento do Google, perfil de rede social, apresentação. O app não lê nada daqui; os ícones (aba, manifest, apple-touch-icon) e os cards de compartilhamento dele são gerados em código a partir de `components/brand/brand-mark.tsx` (ADR 0067).

| Arquivo | Uso |
| :-- | :-- |
| `palpiteiro-simbolo.svg` | Símbolo com cantos arredondados, vetorial. Padrão pra qualquer lugar que aceite SVG. |
| `palpiteiro-simbolo-quadrado.svg` | Símbolo sem arredondamento, pra quem aplica a própria máscara (círculo, cantos). |
| `palpiteiro-simbolo-512.png` | Símbolo arredondado em 512×512. |
| `palpiteiro-simbolo-quadrado-512.png` | Símbolo quadrado em 512×512 (avatar de rede social, que recorta em círculo). |
| `palpiteiro-google-oauth-120.png` | Logo da tela de consentimento do Google (120×120): símbolo com o nome embaixo, fundo branco. Upload em Google Cloud → Auth → Branding. |

## Regras

- **Cores:** fundo azul `#0057c0` (no tema escuro do app, `#3177dc`, o `--primary` do escuro), trave em branco e bola em amarelo `#ffb547`. O amarelo é a segunda cor da marca; o azul continua sendo a principal.
- **Nome:** "palpiteiro", minúsculo, em Geist SemiBold, à direita do símbolo (ou embaixo, no quadrado do Google). Sem sufixo nem tagline (ADR 0059).
- **Nada de cara de casa de aposta:** sem fichas, dados, dinheiro, dourado ou neon, e nenhum nome de casa de aposta junto da marca. O amarelo da bola é cor de bola, não de ficha: chapado, sem brilho nem degradê metálico, e só na bola.

## Atualizar

Mudou o símbolo em `components/brand/`? Rode `pnpm brand:export` e versione os arquivos. O teste `scripts/__tests__/brand-assets.test.ts` falha enquanto eles estiverem diferentes do código. Ele compara byte a byte, então um upgrade do `next` que mude o renderizador (satori/resvg) também faz ele falhar com "desatualizado" sem o símbolo ter mudado: a correção é a mesma, rodar `pnpm brand:export`.
