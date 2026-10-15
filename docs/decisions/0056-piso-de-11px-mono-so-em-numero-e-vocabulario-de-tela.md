# ADR 0056 — Piso de 11px, mono só em número e vocabulário de tela

## Status

Accepted (2026-10-15). Issue #575 (linhas 2, 3, 16, 17, 18 e 26 da revisão de design de 2026-10). **Emenda a ADR 0029** na escala tipográfica e nas exceções 22/30 da #246. Camada de apresentação: não toca prompt (`lib/ai/**`), seed, `lib/view/markets/presentation.ts` nem valores do banco. Plano: `docs/plans/PLAN-575.md`.

## Contexto

A revisão de design apontou que o texto pequeno (9 e 10px, ~240 usos) é difícil de ler, que o `muted-fg-2` no tema escuro fica abaixo de 3:1 sobre o fundo, que o mono aparece em rótulos de texto (onde só pesa) e que a tela fala jargão do motor (PASS, yield, win rate, edge em `pp`, "Over 2.5"). Também há quatro jeitos de mostrar resultado (cobalto, verde/vermelho, ícone, texto cru) e cada página monta o próprio cabeçalho e gutter.

## Decisão

1. **Escala com piso de 11px.** `text-eyebrow-xs` (9) e `text-eyebrow` (10) saem; tudo que usava os dois vira `text-meta` (11). Entram `text-display-xs` (22) e `text-display-xl` (40). Escala final: `meta` 11 · `body-sm` 12 · `body` 13 · `label` 14 · `display-sm` 18 · `display-xs` 22 · `display-md` 26 · `display-lg` 32 · `display-xl` 40. **Zero `text-[Npx]`** no código (substitui a seção "Exceções registradas pela #246" da ADR 0029 quanto a 22/30: 30px vira `display-lg`). Um teste de guarda (`components/__tests__/design-scale-guard.test.ts`) impede a volta.
2. **Mono só em número.** `font-mono` fica para odd, placar, %, unidade, data/hora e contagem, sempre com `tabular-nums`. Rótulo (caixa-alta com `tracking-label`/`tracking-eyebrow`) passa a ser sans. Código cru (`<pre>`/`<code>`) continua mono.
3. **`muted-fg-2`:** escuro 0,48 → 0,62; claro 0,55 → 0,52. Só em texto ≥12px (e ícone), nunca no `text-meta`; nunca sobre preenchimento sólido `*-soft` nem `surface-3` (ali vai `muted-foreground`).

   | `--muted-fg-2` escuro | background | card | surface-2 | surface-3 | palpite-soft sólido | palpite-soft/40 sobre card |
   |---|---|---|---|---|---|---|
   | 0,48 (antes) | 2,99 | 2,80 | 2,62 | 2,34 | 2,28 | 2,63 |
   | **0,62** | **5,37** | **5,02** | **4,70** | 4,20 | 4,10 | **4,72** |

   Claro 0,52: 5,51 sobre branco, 5,05 sobre `surface-2`, 4,62 sobre `surface-3`.
4. **Vocabulário de tela na camada de view.** `lib/view/markets/display.ts` traduz os rótulos canônicos só para a tela, compondo com `with-team-labels.ts`. O que vai para o modelo continua lendo `getMarketPresentation` (`presentation.ts`), que espelha o seed. Nenhum arquivo de `lib/ai/**` importa `display.ts` diretamente.

   | Motor / banco | Tela |
   |---|---|
   | PASS | Sem aposta |
   | yield | retorno |
   | win rate | taxa de acerto |
   | pass rate | jogos sem aposta |
   | Green / Red / Push / Anulada | Acertou / Errou / Devolvida / Anulada |
   | Pendente | Em aberto |
   | edge +5.6pp | vantagem +5,6 pontos |
   | Over/Under gols · Over 2.5 | Total de gols · Mais de 2,5 · Menos de 2,5 |

   A cor de uma recomendação nunca é lida pelo texto: vem de `recommendationKind`, derivado do valor cru. Número de "taxa de acerto" (e de retorno) só aparece no desempenho privado. Em página pública vale a ADR 0048, Decisão 4: nenhuma alegação de acerto em %, nenhum número de desempenho. A definição neutra do termo no glossário compartilhado (`components/help/glossary.ts`, renderizado também em `/como-funciona`) pode aparecer em página pública, desde que siga só definição, sem número nem promessa.
5. **Selo único de resultado:** `components/result-badge.tsx` (`ResultBadge`) com as cores `form-*` e sempre com a palavra (`lib/view/result-state.ts`). Vale para `/apostas`, palpite (inclusive `/p`), bolão e desempenho.
6. **Cabeçalho e larguras:** `PageHeader` (h1 `display-md`/`lg:display-lg`, descrição sans, meta sans com `tabular-nums`, volta e ações) e `PageContainer` (`content` 1040 ou `reading` 640, gutter `px-5`/`lg:px-8`) nas telas logadas de usuário. A árvore celular de `/jogos` e `/time` (lista sangrada) usa só o `PageHeader`. A página do jogo fica para o PR 3.
7. **Escopo do admin:** recebe só as regras de token (piso de 11px, contraste do `muted-fg-2`, zero `text-[Npx]`); mantém mono, termos técnicos e o próprio `PageHeading`. Componentes compartilhados com o admin (`PredictionDetail`, `PredictionsTable`, `KpiCards`) seguem a regra de usuário.
8. **Exceção conhecida:** as iniciais do `TeamAvatar` (`components/team-avatar.tsx`, estilo inline, `aria-hidden`) ficam abaixo de 11px até a troca por escudo (PR 5 da revisão).

## Alternativas rejeitadas

- **Só redefinir os tokens para 11px:** três nomes para o mesmo tamanho convidam a reabrir 9/10.
- **Renomear e mudar o render no mesmo commit:** mistura ~240 trocas mecânicas com a mudança visual. A ordem foi redefinir (2 linhas, revisável na tela) e depois renomear (neutro).
- **Mudar `presentation.ts`/seed para o português de tela:** mudaria o texto que vai para o modelo e quebraria a paridade com o seed.

## Consequências

- Linhas densas crescem um pouco (listas, chips de odds, tabela do desempenho).
- `/como-funciona` e a landing seguem com o vocabulário antigo no corpo até o PR 6.
- Dois guardas novos: escala/mono/contraste (`design-scale-guard.test.ts`) e cabeçalho (`__tests__/page-header-coverage.test.ts`).
