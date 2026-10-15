# PLAN-575: sistema visual (linhas 2, 3, 16, 17, 18 e 26 da revisão de design)

Rascunho anterior à implementação (ver `docs/plans/README.md`). Referências conferidas no código em `c31a4b4` (main, com o PR #581 / #574 já mergeado) e **revisadas por um segundo leitor** (ver "Revisão do plano" no fim). As 10 decisões em aberto foram **resolvidas pelo dono** com o padrão recomendado (seção "Decisões").
Regras herdadas do PLAN-574: mudanças pequenas e mecânicas; nenhum nome, link ou logo de casa de apostas; **não mexer em texto de prompt nem em valores do banco** (`lib/view/markets/presentation.ts` espelha o seed e alimenta `lib/ai/predict.ts:54,2155` e `lib/ai/palpites/synthesis-input.ts:7,105`); manter os alvos `data-tour` (`lib/tour/steps.ts`) e os testes de rótulo de `/como-usar`. **Este PR não reestrutura a página do jogo** (isso é o PR 3: linhas 1, 19 e 24). Na página do jogo só entram trocas de classe e de texto.
Fronteiras de escopo: **listas** (agrupar por dia, filtros em chips, resumo de `/apostas`, desempenho simples, CLV/no-vig/`n=`) são o PR 4; **telas públicas** (`/`, `/como-funciona`, `/signin`, `/termos`, `/privacidade`) são o PR 6 e aqui só recebem as trocas mecânicas de classe dos codemods (piso de 11px, mono, `muted-fg-2`), nunca texto nem estrutura; **admin** recebe só as regras de token (piso de 11px, contraste, zero `text-[Npx]`) e mantém mono, termos técnicos e o `PageHeading` próprio (decisão 3).

## Ordem sugerida (commits)

1. `docs:` ADR 0056 (emenda da ADR 0029: piso de 11px, tokens de display, mono só em número, vocabulário de tela) + DESIGN.md. A decisão vem antes do código.
2. Linha 2a: valor do token `--muted-fg-2` (só `app/globals.css`).
3. Linha 3a: redefinir `--text-eyebrow-xs`/`--text-eyebrow` para 11px (muda o render; diff de 2 linhas, fácil de revisar na tela).
4. Linha 3b: codemod `text-eyebrow(-xs)` → `text-meta` e remoção dos dois tokens (não muda o render; diff grande e mecânico).
5. Linha 2b: regra "muted-fg-2 só em texto ≥12px" (codemod nas linhas de 11px) + teste de guarda.
6. Linha 26: `PageHeader` + `PageContainer` nas telas logadas de usuário (menos a do jogo e o admin). Vem antes do mono porque já troca os subtítulos `font-mono text-meta` das páginas.
7. Linha 3c: mono só em número (codemod dos rótulos + revisão manual do resto).
8. Linha 3d: zerar `text-[Npx]` (tokens `display-xs`/`display-xl`) + guarda.
9. Linha 18: `ResultBadge` e adoção (antes do glossário, porque o filtro do desempenho reaproveita as palavras do selo).
10. Linha 16: glossário de tela (módulo de display + views + cópia + `components/help/glossary.ts` + `/como-usar` + tour).
11. Linha 17: um nome por coisa (menu, `/apostas`, painel, "Palpite da IA") + tour + `/como-usar`.
12. Conferência final: `pnpm test && pnpm lint && pnpm typecheck && pnpm build` e a revisão visual (fim deste arquivo).

Cada commit deixa `pnpm test`, `pnpm lint` e `pnpm typecheck` verdes. Os goldens (`components/__tests__/odds-card-parity.golden.test.tsx`) são regenerados com `vitest -u` **só no commit que causa a mudança**, e o diff é revisado à mão.

---

## Linha 2: contraste de `--muted-fg-2` no tema escuro

### Contas (WCAG 2.x, a partir dos valores OKLCH de `app/globals.css`)

Script: OKLCH → sRGB linear → luminância relativa → razão `(L1+0,05)/(L2+0,05)`. Os valores de hoje batem com os da revisão (2,99 / 2,80 / 2,28), o que valida a conta. "Fundo do palpite" é `--palpite-soft` sólido; o cartão do palpite de verdade usa `bg-palpite-soft/40` sobre `--card` (mistura calculada em sRGB, como o browser faz).

| `--muted-fg-2` (escuro) | background 0,155 | card 0,195 | surface-2 / muted 0,225 | surface-3 0,265 | palpite-soft sólido | palpite-soft/40 sobre card | accent-soft | edge-soft | warn-soft |
|---|---|---|---|---|---|---|---|---|---|
| 0,48 (hoje) | 2,99 | 2,80 | 2,62 | 2,34 | 2,28 | 2,63 | 2,31 | 2,19 | 2,27 |
| 0,60 | 4,95 | 4,63 | 4,33 | 3,88 | 3,78 | — | 3,83 | 3,62 | 3,77 |
| **0,62 (proposto)** | **5,37** | **5,02** | **4,70** | **4,20** | **4,10** | **4,72** | **4,15** | **3,93** | **4,08** |
| 0,64 | 5,81 | 5,44 | 5,08 | 4,55 | 4,44 | 5,11 | 4,50 | 4,25 | 4,42 |
| 0,66 (= `muted-foreground`) | 6,28 | 5,88 | 5,50 | 4,92 | 4,80 | — | 4,86 | 4,60 | 4,78 |

Leitura: com 0,62 passa AA (4,5:1) sobre fundo, cartão, `surface-2` e o cartão real do palpite (4,72). **Não passa** sobre preenchimento sólido `*-soft` nem `surface-3` (3,9 a 4,2). Por isso a regra do DESIGN.md também proíbe `muted-fg-2` sobre preenchimento sólido `*-soft`/`surface-3` (ali vai `muted-foreground`, que passa: 4,6 a 4,9).
Referência: `form-*-fg` sobre `form-*-bg` passam com folga nos dois temas (escuro: vitória 6,98, derrota 6,15, empate 5,70; claro: 7,97 / 6,23 / 7,49), o que importa para o selo da linha 18.

Tema claro (decisão 1: entra): `--muted-fg-2` 0,55 dá 4,85 sobre branco, **4,45 sobre `surface-2`** e 4,07 sobre `surface-3`. Com 0,52: 5,51 / 5,05 / 4,62 (e 4,69 sobre `palpite-soft`). Conferido: para cinza puro, luminância = L³ (0,52 sobre 0,97 → 5,05; 0,62 sobre 0,195 → 5,02).

### 2a. Token (commit 2)
- `app/globals.css:214` (`.dark`): `--muted-fg-2: oklch(0.48 0 0)` → `oklch(0.62 0 0)`. Comentário curto com as razões (5,4 fundo / 5,0 cartão).
- `app/globals.css:135` (`:root`, decisão 1): `--muted-fg-2: oklch(0.55 0 0)` → `oklch(0.52 0 0)`.

### 2b. Regra "muted-fg-2 só em texto ≥12px" (commit 5, depois do 3b)
Medição: `muted-fg-2` aparece em 130 linhas (45 arquivos); 98 delas estão numa className com `text-eyebrow`/`text-eyebrow-xs`/`text-meta`, ou seja, texto de 9 a 11px. Depois do piso de 11px todas viram `text-meta`.
- Codemod (só linhas que já têm `text-meta` **e** `text-muted-fg-2` na mesma string): `perl -pi -e 's/(?<![\w:-])text-muted-fg-2\b/text-muted-foreground/g if /\btext-meta\b/ && /\btext-muted-fg-2\b/'` sobre `app components lib` (sem `__tests__` e sem `*.test.*`: o golden tem as duas classes na mesma linha gigante e é regenerado com `-u`). O lookbehind `(?<![\w:-])` deixa de fora qualquer variante (`placeholder:`, `marker:`, `hover:`); hoje nenhuma das três linhas com variante (`admin/users/page.tsx:45`, `palpite-hero.tsx:585`, `como-usar-content.tsx:63`) tem `text-meta`, mas o regex não deve depender disso. Inclui admin e telas públicas (regra de contraste, não de estilo).
- Revisão manual das ~21 linhas onde o tamanho vem de outro lugar (lista: `grep -rnE 'muted-fg-2' app components lib | grep -vE 'text-(meta|body|label|display)'`). Ícones (`size-*`) e texto ≥12px ficam. Casos conhecidos: `components/site-footer.tsx:28` (**trocar**: o `<footer>` põe `text-muted-fg-2` na raiz e os filhos `:30` e `:70` são `text-meta`, 11px; a raiz vira `text-muted-foreground`), `components/dashboard/predictions-table.tsx:26,29,142` (status/lucro; o status sai para o `ResultBadge` na linha 18), `components/upcoming-matches-desktop.tsx:127,131`, `components/match-row.tsx:157`, `components/bet-slip.tsx:563,680`, `components/match-collapsible.tsx:29`, `app/(app)/bolao/[id]/page.tsx:150,173` (ícones; o `:150` some com o `ResultBadge`).
- Arquivos com `muted-fg-2` dentro de preenchimento sólido `*-soft` para conferir à mão: `components/desktop-status-cell.tsx`, `components/analysis-scenarios.tsx`, `components/palpites/{palpite-hero,public-palpite}.tsx`, `app/(app)/como-usar/como-usar-content.tsx`, `app/como-funciona/como-funciona-content.tsx`.

**Testes.**
- Novo `components/__tests__/design-scale-guard.test.ts` (mesmo molde de `no-bookmaker-copy.test.ts`: varre `app`, `components`, `lib/view`, ignora `__tests__`, `*.test.*` e linhas de comentário). Caso 1 deste commit: nenhuma linha com `text-muted-fg-2` junto de `text-meta` (sem prefixo de variante).
- Os testes que fixam classe (`components/__tests__/upcoming-matches.test.tsx:124,127`) mudam para `text-muted-foreground`.

**Riscos.** A hierarquia de cinza no texto de 11px some (tudo vira `muted-foreground`, 0,66). É o que a regra aprovada pede; a diferença passa a vir do tamanho. `muted-fg-2` (0,62) e `muted-foreground` (0,66) ficam próximos no escuro; aceitável, porque `muted-fg-2` sobra quase só para ícone e texto ≥12px.

---

## Linha 3: piso de 11px, mono só em número, zero `text-[Npx]`

### Medição (em `c31a4b4`, fora de testes; recontada na revisão)
- `text-eyebrow-xs` (9px): 52 ocorrências em 22 arquivos. `text-eyebrow` (10px, sem o `-xs`): 187 ocorrências em 71 arquivos. Juntas: 239 em 76 arquivos (a "cerca de 280" da revisão de design). `text-meta` (11px): 99 em 43 arquivos.
- Testes que citam as classes: `components/__tests__/odds-card-parity.golden.test.tsx` (snapshots inline), `components/__tests__/upcoming-matches.test.tsx:124,127`, `lib/utils.test.ts:12-13,33-35`.
- Combinação responsiva: só `components/match-hero.tsx:81` (`text-eyebrow … lg:text-meta`).
- Classe montada fora de string literal: nenhuma (só o comentário de `lib/utils.ts:5`).
- `font-mono`: 315 linhas. A) com `uppercase` e sem `tabular-nums`: 155 (114 fora do admin). B) `uppercase` + `tabular-nums`: 0. C) `tabular-nums` sem `uppercase`: 81 (número; ficam). D) nem um nem outro: 79 (66 fora do admin).
- `text-[Npx]`: 12 usos de classe em 9 arquivos (mais 3 comentários: `admin/users/[userId]/page.tsx:81`, `dashboard/prediction-detail.tsx:74`, `components/ui/badge.tsx:23`): 28px (`dashboard/page.tsx:67`, `admin/users/[userId]/page.tsx:82`), 16px (`admin/costs/page.tsx:175`), 22px (`odds-card.tsx:97`, `match-hero.tsx:48,110`, `dashboard/prediction-detail.tsx:75`), 30px (`match-hero.tsx:96,104`), 40px (`palpites/palpite-hero.tsx:299`, `palpites/public-palpite.tsx:73`), 10.5px (`match-sections-auxiliary.tsx:174`).
- Fonte abaixo de 11px **fora de classe**: `components/team-avatar.tsx:54` (`fontSize: size * 0.36`, 7,9px no avatar de 22px). É decorativo (`aria-hidden`) e o PR 5 troca as iniciais pelo escudo; fica fora deste PR e vira exceção explícita no critério de saída. Gráficos (`bankroll-line-chart.tsx:66,73`) já usam 11.

### Estratégia: redefinir o token primeiro, renomear depois
Os dois caminhos dão o mesmo render (11px). O risco está no render, não no nome. Separar isola cada coisa:
- **3a (muda o render, diff mínimo):** `@theme` `--text-eyebrow-xs: 11px; --text-eyebrow: 11px;`. Um commit de 2 linhas. A conferência visual acontece aqui; se algo estourar, o revert é trivial.
- **3b (não muda o render, diff grande):** com os três tokens valendo 11px, trocar o nome é provadamente neutro. Codemod: `git ls-files 'app/**' 'components/**' 'lib/**' | grep -E '\.(ts|tsx)$' | xargs perl -pi -e 's/\btext-eyebrow-xs\b/text-meta/g; s/\btext-eyebrow\b(?!-)/text-meta/g'` (inclui os testes; não toca `tracking-eyebrow`; o `\b` depois de `:` cobre `lg:text-eyebrow`). Como o codemod reescreve também os snapshots inline do golden, o golden continua verde **sem** `-u` neste commit. Não existe outra classe `text-meta*` no código, então não há colisão de nome. Linhas que ficam com `text-meta` duplicado (ex.: `text-eyebrow-xs … sm:text-eyebrow`) só são simplificadas; `cn()` deduplica de qualquer forma. Depois: apagar os dois tokens do `@theme`, tirar `"eyebrow-xs"`/`"eyebrow"` de `lib/utils.ts` (twMerge) e de `lib/utils.test.ts` (o caso das linhas 33-35 passa a usar `text-meta`), simplificar `match-hero.tsx:81` para só `text-meta`, e atualizar os comentários de `components/ui/badge.tsx`. Conferência: `grep -rn 'text-eyebrow' app components lib` sem resultado; `pnpm build` verde.

Por que não só redefinir: deixaria três nomes para o mesmo 11px e convidaria a "reabrir" o 9/10. Por que não só codemod: misturaria a mudança de render com 290 trocas de nome no mesmo diff.

**Alturas fixas que recebem texto maior (ajustar no 3a):**
- `components/ui/badge.tsx` `size.xs`: `h-[18px]` fica; `size.sm`: `h-5` fica. Conferir os badges com `text-xs` de base: a utility de token não tem line-height, então herda; 11px cabe em 18px.
- `components/odds-card.tsx:64`: `h-[17px]` → `h-[18px]`.
- `components/h2h-section.tsx:41-42`: `h-[18px]` fica.
- `components/help-hint.tsx:40`: `size-[15px]` com "?" de 11px; conferir na tela, subir para `size-4` se encostar.
- `components/form-dot.tsx:25`: `h-5 w-5` com letra de 11px; cabe.

### 3c. Mono só em número (commit 7)
- Grupo A (rótulo: `font-mono` + `uppercase`, sem `tabular-nums`): codemod só nos arquivos de fonte fora do admin e fora dos testes, com regex que não pega variante nem depende de espaço depois da classe:
  `git ls-files 'app/**' 'components/**' | grep -E '\.tsx?$' | grep -vE '(__tests__|\.test\.|^app/\(app\)/admin/)' | xargs perl -pi -e 's/(?<![\w:-])font-mono(?:\s+|(?=["\x27\x60]))//g if /\buppercase\b/ && !/tabular-nums/'`
  (114 linhas). O lookbehind protege `marker:font-mono` (`como-usar-content.tsx:63`), que é número de lista e fica; o lookahead cobre `font-mono` no fim da string. Mantém `uppercase` e `tracking-label`/`tracking-eyebrow` (decisão 4). `components/section-label.tsx:11` e o `Kicker` de `palpite-hero.tsx:688`/`public-palpite.tsx:146` caem aqui. Inclui as telas públicas (landing, como-funciona, signin, termos, privacidade, `not-found-content`): só a classe muda, o texto é do PR 6.
  Conferir no diff os rótulos do grupo A cujo **conteúdo é número ou data**: `app/(app)/apostas/page.tsx:147` (liga · data) e `components/site-footer.tsx:31` ("18+") são texto misto e ficam sans; `components/match-sections-auxiliary.tsx:174` sai no 3d.
- Grupo D (66 linhas fora do admin, nem `uppercase` nem `tabular-nums`): revisão manual, arquivo por arquivo. Regra: se o conteúdo é número (odd, placar, %, unidade, data/hora, contagem) fica `font-mono` **e ganha `tabular-nums`**; se é texto, sai o `font-mono`. Exemplos: `components/match-row.tsx:115,120,153` ("—"/legenda → sans), `components/seu-palpite.tsx:210,496,567` (texto → sans), `components/standings-section.tsx:46,55-57` (número → `tabular-nums`), `components/form-dot.tsx:25` (letra V/E/D → sans), `components/help-hint.tsx:40` ("?" → sans), `components/match-hero.tsx:118` (`liveScore.caption`, texto → sans), `app/(app)/apostas/page.tsx:143` (nomes dos times → sans), `components/dashboard/prediction-detail.tsx:39` (`<pre>` com JSON cru → fica mono, é código).
- Grupo C (81 linhas com `tabular-nums`) **não é todo número**: passada rápida pelos que têm texto, que saem do mono (e perdem o `tabular-nums`): `components/analysis-result.tsx:43` (o "PASS" grande, que vira "Sem aposta" na linha 16), `components/recent-pred-card.tsx:31` (times "A vs B"), `components/dashboard/market-segments.tsx:35` ("graduando"). Texto com número no meio (`kpi-cards.tsx:112,117`, `market-segments.tsx:150`, `seu-palpite.tsx:361`) fica mono. Os subtítulos `font-mono text-meta` de página (`apostas`, `bolao`, `perfil`, `bolao/[id]`) já saem no commit 6 (`PageHeader`).
- Classes quebradas em várias linhas (`cn(...)`/`cva`, ex.: `analysis-scenarios.tsx:217`, `bet-slip.tsx:826`, `predictions-table.tsx:79`, `standings-section.tsx:23`, `wordmark.tsx:27`) escapam do codemod por linha: no fim, `grep -rn 'font-mono' app components | grep -v tabular-nums | grep -v 'app/(app)/admin/'` e revisar o que sobrar.
- Admin fica de fora do mono (decisão 3). Componentes compartilhados com o admin (`PredictionDetail`, `PredictionsTable`, `KpiCards`) seguem a regra de usuário.
- Golden: o codemod não toca os testes; `vitest -u` no golden neste commit e revisar que o diff é só remoção de `font-mono`.

### 3d. Zerar `text-[Npx]` (commit 8)
A ADR 0029 deixou 22/30 como exceção comentada. A issue pede zero. Decisão 9 (registrada na ADR 0056):
- Novos tokens no `@theme`: `--text-display-xs: 22px` e `--text-display-xl: 40px`; incluir os dois no twMerge (`lib/utils.ts`, senão `cn("text-display-xs", "text-foreground")` descarta o tamanho, o bug do #333) e na lista `FONT_SIZE_TOKENS` de `lib/utils.test.ts`.
- `odds-card.tsx:97`, `match-hero.tsx:48` (`lg:text-[22px]`), `match-hero.tsx:110` → `display-xs`. `match-hero.tsx:96,104` (`lg:text-[30px]`) → `lg:text-display-lg` (32, +2px no placar do desktop). `palpite-hero.tsx:299` e `public-palpite.tsx:73` (`lg:text-[40px]`) → `lg:text-display-xl`. `admin/costs/page.tsx:175` (16px) → `text-display-sm`. `match-sections-auxiliary.tsx:174` (`font-mono text-[10.5px] uppercase tracking-[0.14em]`) → `text-meta uppercase tracking-label` (sai o mono e o tracking cru, é rótulo).
- 28px de `dashboard/page.tsx:67` e 22px de `prediction-detail.tsx:75` somem no commit 6 (viram `PageHeader`). `admin/users/[userId]/page.tsx:82` **não** ganha `PageHeader` (decisão 3): só troca `text-[28px]` por `text-display-md` (mesmo degrau do `PageHeader`: 26 / `lg:` 32). Os comentários de "outlier sancionado" (`:81`, `prediction-detail.tsx:74`) saem junto, e o de `components/ui/badge.tsx:23` é reescrito sem `text-[…]`.
- Guarda (caso 2 do `design-scale-guard.test.ts`): nenhuma ocorrência de `/text-\[\d/` e nenhuma de `text-eyebrow` em `app`, `components`, `lib` (fora de comentário). Caso 3 (recomendado): toda linha com `font-mono` sem prefixo de variante tem `tabular-nums`, exceto `app/(app)/admin/**` e linhas com `<pre`/`<code` (o `marker:font-mono` de `/como-usar` fica de fora pelo prefixo). Pega só classes numa linha; o grep final do 3c cobre o resto.

**Testes (linha 3 inteira).** `lib/utils.test.ts`; `upcoming-matches.test.tsx`. O golden compara HTML (classes), então não muda no 3a; muda no 3b (nome, reescrito pelo próprio codemod), no 2b (`text-muted-fg-2` → `text-muted-foreground` na linha "odd de mercado"), no 3c (sem `font-mono`) e no 3d (`text-[22px]` → `text-display-xs`). Revisar que cada diff do golden é só a troca daquele commit. Sem teste de componente do bolão hoje: a mudança de layout do 3a se confere na tela.

**Riscos.**
- Linhas densas crescem: `match-row` (celular), `upcoming-matches-desktop` (colunas fixas), tabela do desempenho, chips de odds. Conferir truncamento e quebra em 390px e 1440px.
- O PR 3 mexe nos mesmos arquivos da página do jogo (`bet-slip`, `odds-card`, `palpite-hero`, `match-hero`). Este PR entra antes; o PR 3 faz rebase.
- Rótulo em sans com `uppercase` e `tracking-label` (0,14em) ocupa menos largura que em mono (sans é mais estreita). Não há estouro esperado.

---

## Linha 16: glossário em português nas telas de usuário

### Princípio
`presentation.ts` não muda (espelha o seed, pinada por `presentation-seed-parity.pglite.test.ts`, e alimenta o modelo). Nada em `lib/ai/**` muda. O vocabulário de tela entra **só na camada de view**, no mesmo molde do `with-team-labels.ts` do PR 1. Telas de admin mantêm termo técnico (decisão 3), mas componentes compartilhados com o admin (`PredictionDetail`, `PredictionsTable`, `KpiCards`) passam a mostrar o português também; é aceitável.
Conferido: o que vai para o modelo lê `getMarketPresentation` direto (`lib/ai/predict.ts:2155`, `lib/ai/palpites/synthesis-input.ts:105`). `lib/ai/best-bet.ts:2` importa `computeBestBetRank` de `lib/view/best-bet.ts`, então `display.ts` entra **transitivamente** no grafo de `lib/ai`; isso é inofensivo porque `computeBestBetRank` só usa números (nenhum rótulo), mas o guarda de fronteira tem que ser sobre import **direto** e o `display.ts` tem que manter a mesma pureza de bundle do `presentation.ts` (sem `@/lib/ai*`, `@/lib/db`, `market-descriptor`). `lib/model-base/reading.ts` usa `toMatchModelReadingView` só para a página do jogo; `lib/user-palpite/check-claims.ts` usa só `toFormView`.

| Hoje | Tela |
|---|---|
| PASS | Sem aposta |
| yield | retorno |
| win rate | taxa de acerto |
| pass rate | jogos sem aposta |
| Green / Red / Push / Anulada | Acertou / Errou / Devolvida / Anulada |
| Pendente(s) | Em aberto |
| edge +5.6pp | vantagem +5,6 pontos ("vantagem de 5,6 pontos" em frase) |
| Over/Under gols · Over 2.5 · OVER | Total de gols · Mais de 2,5 · Menos de 2,5 |

### 16a. Módulo de display (mercados)
- Novo `lib/view/markets/display.ts`, puro (importa só `presentation`, `with-team-labels` e `@/lib/format-number`):
  - `withScreenLabels(p: MarketPresentation): MarketPresentation`: só `over_under` muda. `marketLabel` "Total de gols"; `selectionLabel` over/under → "Mais de"/"Menos de"; `outcomeLabel(k, line)` → `Mais de ${formatLine(line)}` (sem linha: "Mais de"); `scenarioLabel` → `mais de ${formatLine(line)} gols`; `betSummary.market` → `Mais de ${formatLine(line)} gols` (o `plain` fica); `framingLabel` passa direto. Isso também resolve o ponto que o PLAN-574 deixou ("Over 2.5" com ponto).
  - `getDisplayPresentation(marketKey, teams?)` = `withTeamLabels(withScreenLabels(getMarketPresentation(k)), teams)`; `findDisplayPresentation` (variante que não lança).
  - `displayMarketLabel(marketKey: string, fallback: string)`: para rótulo que vem do banco (`markets.label`, ex.: `row.marketLabel` do dashboard e do feed de recentes). `over_under` → "Total de gols"; resto → `fallback`.
- Trocar `getMarketPresentation`/`findMarketPresentation` por `getDisplayPresentation`/`findDisplayPresentation` **só em `lib/view`**: `analysis.ts:311-312,554,590`, `best-bet.ts:110,115,158`, `dashboard.ts:311`, `odds.ts:17,90,129` (inclui `LIVE_*_LABEL`/`LIVE_*_SHORT`: o chip da lista passa a usar `outcomeLabel` com a linha padrão, "Mais de 2,5", em vez de "Over"), `match-model.ts:23,30,77-80`, `recent-prediction.ts:72`, `recommendation.ts:33`. `with-team-labels.ts` continua igual e é composto por dentro.
- **Não trocar:** `lib/ai/**`, `lib/view/markets/public-category.ts` (normaliza a saída do modelo contra `MARKET_CATEGORY_LABELS`; o tripwire de allowlist continua sobre os rótulos canônicos). Na página pública `/p` (`components/palpites/public-palpite.tsx:49`) a categoria canônica passa por `displayMarketLabel` só na renderização, depois do normalizador (o rótulo de tela não tem dígito, então a garantia de "nenhuma linha vaza" não muda).
- Rótulos vindos do banco, aplicados **dentro dos mappers de view** (a página não muda): `lib/view/dashboard.ts:199` (`marketContextLabel(row.marketLabel,…)`), `:156` (`marketLabel` dos segmentos), `:347` (`detail.marketLabel` do detalhe), `lib/view/recent-prediction.ts:70-72` (feed de recentes; cobre o `app/(app)/jogos/page.tsx:216`, que só repassa o campo) e `lib/dashboard/derive-view.ts:133` (`availableMarkets`, rótulo do filtro de mercado) → `displayMarketLabel(marketKey, label)`.
- `lib/view/sections.ts:115` (resumo do H2H): `over ${x}% · média …` → `mais de 2,5 em ${x}% · média …`. Conferido: `lib/user-palpite/check-claims.ts` usa só `toFormView`, não o resumo do H2H.

### 16b. Recomendação (tokens OVER/UNDER/PASS)
`lib/view/recommendation.ts:7-11` pina "OVER"/"UNDER"/"PASS", e `components/dashboard/predictions-table.tsx:33-41` (`REC_CLASS`, usado em `:118`) e `components/recent-pred-card.tsx:17` (`p.rec === "PASS"`) leem a cor **pelo texto**. Trocar o texto quebraria a cor em silêncio (conferido: são os dois únicos leitores; `prediction-detail.tsx:85` só exibe o texto). Fora da view, tudo compara o valor cru `"pass"` (`lib/dashboard/kpis.ts`, `lib/settlement/compute.ts`), que não muda.
- `recommendationLabel(rec, marketKey, selectionLabel, teams?, line?)`: over/under → `outcomeLabel` de display com a linha ("Mais de 2,5"); pass → `PASS_LABEL = "Sem aposta"` (exportado). Novo `recommendationKind(rec): "over" | "under" | "pass" | "other"` no mesmo arquivo, derivado do valor cru (`row.recommendation`), nunca do rótulo.
- `PredictionRowView` (`lib/view/dashboard.ts:166`) e `RecentPredictionView` (`lib/view/types.ts:262`) ganham `recKind`. `predictions-table.tsx` e `recent-pred-card.tsx` passam a ler a cor/estado por `recKind`. `lib/view/types.ts:10,14` (comentário do tipo `Recommendation`) atualizado. `PredictionDetailView` (`dashboard.ts:226`) não precisa de `recKind`.
- `marketContextLabel`: com a linha já no `rec`, o contexto de over/under vira só "Total de gols"; mantém a linha quando o `rec` é "Sem aposta" ("Total de gols 2,5"). Chamadas: `dashboard.ts:195/199` (linha da tabela), `:337/346` (detalhe), `recent-prediction.ts:64/70`.

### 16c. Vantagem em pontos
- `lib/format-number.ts`: `formatEdgePoints(v)` → `"+5,6 pontos"` (null → null), reaproveitando `formatEdge`. Mantém o sinal ASCII (os componentes testam `startsWith("+")`/`("-")`).
- Views que hoje montam `${edge}pp`: `lib/view/analysis.ts:124,468` (`minEdgeLabel` → `${n} pontos`), `:199` (frase de framing: "abaixo de N pontos"), `lib/view/bet-slip.ts:334` (`edge`), `:432` (`edge do modelo …pp` → `vantagem do modelo … pontos`), `:337` ("piso de edge do motor" → "piso de vantagem do motor"). Também `lib/view/dashboard.ts` e `recent-prediction.ts`: o campo `edge` passa a sair com a unidade, e os componentes param de concatenar `pp` (`recent-pred-card.tsx:50`, `predictions-table.tsx:130`, `prediction-detail.tsx:89`).
- Rótulos "edge" na tela → "vantagem": `components/analysis-scenarios.tsx:260` (+ blurb de 267: "… em pontos. O app só recomenda com pelo menos N pontos."), `:237` (blurb "pra medir o edge" → "pra medir a vantagem"), `:173` ("vantagem ≥ Npp" → "vantagem de pelo menos N pontos"), `components/bet-slip.tsx:891`, `components/dashboard/prediction-detail.tsx:88`, cabeçalho da tabela `predictions-table.tsx:70` **e** o `includes(h)` de alinhamento à direita em `:80` ("edge" → "vantagem" nos dois, senão a coluna perde o alinhamento).
- CLV/no-vig (`market-segments.tsx:98,102`, `prediction-detail.tsx:97-114`, `lib/view/dashboard.ts:89` com `" pp"`) e os `n=` ficam para o PR 4 (linha 21, "detalhe técnico"; decisão 5).

### 16d. Cópia das telas
- `components/analysis-result.tsx:25-31,44`: eyebrow "sem edge claro" → "sem vantagem clara"; `HelpHint label="Sem aposta"`, blurb "Sem aposta = nenhuma seleção com vantagem suficiente; é disciplina, não erro. Ter muitos jogos sem aposta (30–60%) é bom."; o "PASS" grande → "Sem aposta".
- `components/dashboard/kpi-cards.tsx:69-92,121-123`: rótulos "retorno", "taxa de acerto", "jogos sem aposta"; blurbs sem "yield/win rate/pass rate"; `HelpHint label` igual ao rótulo; contadores "· N sem aposta", "· N em aberto".
- `components/dashboard/market-segments.tsx:52,112,157`: "retorno {v}", "retorno por banda de stake", "… e o retorno por banda aparecem…".
- `components/dashboard/dashboard-filters.tsx:44-51`: "Todas / Em aberto / Acertou / Errou / Anulada / Devolvida" (valores da URL `won/lost/void/push` não mudam). As palavras vêm do módulo da linha 18.
- `app/(app)/dashboard/page.tsx:71,81`: "Suas análises por mercado: retorno, racional e resultados."; "… pra começar a acompanhar seu retorno."
- `app/(app)/admin/users/[userId]/page.tsx:86`: **fica** (decisão 3: admin mantém termo técnico).
- `lib/view/bet-slip.ts:429`: `retorno …` (EV da perna) → `retorno esperado …`, para não colidir com "retorno" = yield. (O enxugamento dessa linha de detalhes é o PR 4, linha 20; aqui só o vocabulário.)
### 16e. Glossário de ajuda (`components/help/glossary.ts`)
A regra do arquivo é "`term` lidera com o texto que aparece na tela". **Anchors não mudam** (são o contrato dos `HelpHint` e dos `#hash`).
- `term`: "yield" → "retorno (yield)"; "win rate" → "taxa de acerto (win rate)"; "pass rate" → "jogos sem aposta (pass rate)"; "over / under / PASS" → "mais de / menos de / sem aposta"; "push / devolução" → "devolvida (push)"; "edge" → "vantagem (edge)"; "over/under 2.5 gols" → "total de gols (mais de / menos de 2,5)"; "O Palpite (a manchete)" → "Palpite da IA (a manchete)" (linha 17).
- `term` também: "pendente vs liquidada" (`:255`) → "em aberto vs liquidada (pendente)", para casar com o `ResultBadge`.
- `meaning`: trocar PASS/yield/win rate/pass rate/pp/over/under pelo vocabulário novo, inclusive `${MIN_EDGE_PP}pp` → `${MIN_EDGE_PP} pontos` (linhas 203, 216) e "aguardando placar" → "em aberto" (linha 82). Os `markets.over_under` das entradas também (o `glossary.test.ts` só exige que existam).
- `components/help/__tests__/glossary.test.ts:32,38`: esperar `${MIN_EDGE_PP} pontos`.
- `components/__tests__/help-hint.test.tsx:14-20,51-62`: as chaves de `PLACEMENT_ANCHORS` são os rótulos de tela ("retorno", "taxa de acerto", "jogos sem aposta", "vantagem", "Sem aposta"); os valores (anchors) não mudam.

### 16f. `/como-usar`, tour e telas fora do escopo
- `app/(app)/como-usar/como-usar-content.tsx`: `:82` "(edge, PASS, odd, stake)" → "(vantagem, sem aposta, odd, stake)"; `:226` "sai como PASS" → "sai como Sem aposta"; `:346` "com yield, taxa de acerto, pass rate" → "com retorno, taxa de acerto, jogos sem aposta"; `:356` "Acertou, Errou ou Pendente" → "Acertou, Errou ou Em aberto".
- `lib/tour/steps.ts:79`: "(odd, edge, stake ou PASS)" → "(odd, vantagem, stake ou sem aposta)".
- **Fora:** `app/como-funciona/**` e `app/landing-content.tsx`/`app/page.tsx` (reescritos no PR 6; decisão 6; `components/__tests__/como-funciona-page.test.tsx` fixa "PASS", "+8pp" etc. no corpo e não muda); `app/termos/page.tsx:74` ("yield", texto legal, ADR 0048: só anotar follow-up no PR); texto livre do modelo (`palpite-hero.tsx:318`, "a partir de: {citedMarkets}") fica como está, é saída do LLM.
- **Dentro, pequeno:** `app/actions/predictions.ts:147-148` (mensagem de erro com "over/under 2.5" e "bookmaker") → "Nenhuma odd de mais/menos de 2,5 gols para este jogo." É tela; conferir `app/actions/__tests__/predictions*.test.ts`.
- ADR 0048, Decisão 4 ("sem '% de acerto'/ROI de marketing"): "taxa de acerto" só aparece no desempenho privado do usuário, como histórico. Não levar para `/p`, OG, landing ou e-mail.

**Testes (linha 16).**
- Novo `lib/view/markets/__tests__/display.test.ts` (ao lado de `with-team-labels.test.ts`): over/under ("Total de gols", "Mais de 2,5", "mais de 2,5 gols", `betSummary.market` "Mais de 2,5 gols", sem linha), 1X2 composto com `teams`, btts/dupla chance sem mudança fora dos times, a presentation do registry intacta depois da chamada, `displayMarketLabel`, e o guarda de pureza de bundle no molde de `presentation.test.ts:176` (sem `@/lib/ai*`, `@/lib/db`, `market-descriptor`).
- Guarda de fronteira: nenhum arquivo de `lib/ai/**` importa **diretamente** `@/lib/view/markets/display` (o import transitivo via `lib/view/best-bet` é esperado, ver Princípio); e `lib/ai/predict.ts`/`lib/ai/palpites/synthesis-input.ts` continuam importando `getMarketPresentation` de `presentation`. O `presentation-seed-parity.pglite.test.ts` não muda e tem que continuar verde.
- `lib/view/__tests__/recommendation.test.ts:12` ("PASS" → "Sem aposta") + casos de `recommendationKind` e de over/under com linha.
- `lib/format-number.test.ts` (fica na raiz de `lib/`, não em `lib/__tests__`): `formatEdgePoints`.
- Atualizar expectativas: `lib/view/{analysis,dashboard,sections}.test.ts` (`sections.test.ts:38` fixa "over 67% · média 2,7 gols"), `lib/view/__tests__/{odds,match-model,recent-prediction,bet-slip,best-bet}.test.ts` e `lib/view/__tests__/match.test.tsx`, `lib/dashboard/__tests__/derive-view*.test.ts` (rótulo do filtro de mercado), `components/__tests__/{analysis-result,analysis-scenarios,market-analysis-section,match-model-reading,market-segments,dashboard-filters-bar,predictions-table,upcoming-matches,match-odds-cards}.test.tsx`, `components/palpites/__tests__/public-palpite.test.tsx`, `app/actions/__tests__/predictions*.test.ts` (o que comparar texto de view). Golden de odds-card regenerado e revisado.
- `/como-usar`: o teste de rótulos procura cada rótulo no HTML **e** no código `.tsx` de `app`/`components` (`uiSource` ignora `.ts`). Rótulo novo citado no guia ("Sem aposta", "Palpite da IA", "mercados", "Em aberto") tem que existir literal num `.tsx`; "Em aberto" vive em `lib/view/result-state.ts`, então ou não entra na lista do teste ou o `ResultBadge` declara as palavras no `.tsx`.
- Asserções negativas: `grep -rnE 'not\.toContain\("(PASS|Over|yield|edge)' components lib app` e conferir que cada uma ainda testa algo.
- `lib/ai/**` com "Over"/"PASS" nos testes **não muda** (prompt).

**Riscos.**
- Muitos testes de view mudam. Fazer em commit próprio e rodar `pnpm test` antes do próximo.
- Chip "Mais de 2,5 1,85" é mais largo que "Over 1,85" na coluna da lista (~160px). Conferir em 390px; se estourar, rótulo curto "+2,5"/"−2,5" só no chip (decisão 7). Não usar `selectionLabel` sozinho ("Mais de 1,85" sem a linha é ambíguo).
- "+5,6 pontos" é mais largo que "+5.6pp" na coluna "vantagem" da tabela do desempenho e no cartão de recentes (`max-w-[240px]`). Conferir em 390px; se apertar, a célula mostra só o número e a unidade vai no cabeçalho ("vantagem (pontos)").
- Cor da recomendação no desempenho depende de `recKind`; um teste de componente cobre cada cor.
- `/como-funciona` continua com PASS/yield/pp até o PR 6 (janela de inconsistência).

---

## Linha 17: um nome por coisa

### Suas apostas
- `lib/nav/menu.ts:25`: `label: "apostas"` → `"suas apostas"` (minúsculo como os outros itens).
- `app/(app)/apostas/page.tsx:76-80`: título "Minhas apostas" → "Suas apostas" (via `PageHeader`, linha 26); subtítulo "suas apostas registradas · privado, só você vê" → "Registradas por você. Privado, só você vê." Comentário da linha 27 também.
- Painel do jogo: `components/bet-slip.tsx:629` ("suas apostas (N)"), `:365`, `:372` já usam o nome. A seção da grade `components/bet-slip.tsx:390` ("registrar apostas") deixa de competir com o painel: vira "mercados" (decisão 2), o nome que a revisão dá para a tabela única do PR 3. O botão de enviar `:774` "Registrar apostas" é verbo e fica.
- `lib/tour/steps.ts`: `:51` "jogos, apostas, bolão e desempenho" → "jogos, suas apostas, bolão e desempenho"; `:88` título "Registrar apostas" → "Suas apostas"; `:89` "a aposta vai pra Apostas" → "a aposta vai pra Suas apostas"; `:103` "em apostas" → "em suas apostas". `target` não muda.
- `app/(app)/como-usar/como-usar-content.tsx`: `:129` `<Ui>apostas</Ui>` → `<Ui>suas apostas</Ui>`; `:286` "a parte <Ui>registrar apostas</Ui>" → "a parte <Ui>mercados</Ui>"; `:313` e `:353` (texto do link) "Apostas" → "Suas apostas".
- `app/actions/bet-slip.ts:106` ("Faça login para registrar apostas.") é verbo; fica.

### Palpite da IA e Seu palpite
- `components/palpites/palpite-hero.tsx:685-689` (`Kicker`): "O Palpite" → "Palpite da IA" (e o comentário "O PALPITE").
- `components/palpites/public-palpite.tsx:147`: mesmo kicker em `/p` → "Palpite da IA".
- `lib/tour/steps.ts:78`: título "O Palpite" → "Palpite da IA".
- `app/(app)/como-usar/como-usar-content.tsx:172,216`: `<Strong>O Palpite</Strong>` → `<Strong>Palpite da IA</Strong>`.
- `components/help/glossary.ts:51` (já citado em 16e).
- "Seu palpite": `components/seu-palpite.tsx:228` ("seu palpite") e o tour `:83` já usam. Sem mudança.
- `app/como-funciona/**` ("O Palpite" em `:30,461,466`) fica para o PR 6 (decisão 6).

**Testes.**
- `lib/nav/__tests__/menu.test.ts:14-17`: `["suas apostas", "/apostas"]`.
- `components/__tests__/mobile-nav.test.tsx:17` compara hrefs; sem mudança. Não há teste de `desktop-nav` que fixe o texto "apostas".
- `components/tour/__tests__/guided-tour.test.tsx:209`: "O Palpite" → "Palpite da IA".
- `app/(app)/como-usar/__tests__/como-usar-content.test.tsx:41-65`: tirar "registrar apostas" (minúsculo) e acrescentar "mercados" e "Palpite da IA". "Registrar apostas" (botão) e "Suas apostas" continuam.
- `lib/tour/__tests__/steps.test.ts`: o contrato de `data-tour` não muda.
- `components/__tests__/palpite-hero.test.tsx` e `public-palpite.test.tsx`: se fixarem "O Palpite".
- `__tests__/app-shell-coverage.test.ts`: não olha rótulo; não muda.

**Riscos.** Baixos. "mercados" como título da grade antes de o PR 3 existir pode soar solto; a frase de apoio logo abaixo (`bet-slip.tsx:392-396`) explica.

---

## Linha 18: um selo de resultado

Hoje: cobalto (`Badge variant="default"`) para "Acertou" em `/apostas` (`apostas/page.tsx:40-55,190-205`); verde/vermelho `form-*` no palpite (`palpites/palpite-badges.tsx:18-47`, usado em `palpite-hero.tsx:289,801` e em `/p`, `public-palpite.tsx:64,244`); ✓/✗ de ícone no bolão (`bolao/[id]/page.tsx:141-154`); texto "green/red" colorido na tabela do desempenho (`dashboard/predictions-table.tsx:19-30`, renderizado em `:135-136`) e "won/lost" cru no detalhe (`dashboard/prediction-detail.tsx:63-68,132`).

### Mudança
- Novo `lib/view/result-state.ts` (puro): `type ResultState = "won" | "lost" | "push" | "void" | "pending"` e `RESULT_LABEL = { won: "Acertou", lost: "Errou", push: "Devolvida", void: "Anulada", pending: "Em aberto" }`. Os quatro estados da issue mais "Anulada", que o glossário mantém.
- Novo `components/result-badge.tsx`: `ResultBadge({ result, size = "xs", className })` sobre o `Badge` (`variant="outline"`):
  - won: `border-transparent bg-form-win-bg text-form-win-fg`
  - lost: `border-transparent bg-form-loss-bg text-form-loss-fg`
  - push / void: `border-transparent bg-form-draw-bg text-form-draw-fg`
  - pending: `border-border bg-transparent text-muted-foreground`
  - Sempre com a palavra (a cor nunca é o único sinal). `data-result={result}` para teste.
- Adoção:
  - `/apostas`: o badge do slip (`:152`) e o da perna (`:214`) viram `ResultBadge`. Mapa `SlipStatus` → `ResultState` (`acertou→won`, `errou→lost`, `pendente→pending`). `nao_conferida` e a perna não liquidável ("não conferimos") **não são resultado**: ficam como `Badge variant="outline"` neutro com a palavra atual. Sai `statusVariant` e o `STATUS_LABEL` local (`:40-45`). A perna lê `leg.outcome?.result` como `string` (`lib/db/queries/user-bets.ts:241`); o mapa trata só `won`/`lost` e o resto como hoje (pendente/não conferimos). A duplicação de status (slip + perna, linha 20 da revisão) é do PR 4.
  - Palpite: `SettleableBadge` (`palpite-badges.tsx`) passa a renderizar `ResultBadge` (`pending` → "Em aberto" no lugar de "aguardando placar"; `won`/`lost`). Vale também para `/p` (mesmo componente). `NonSettleableTag` ("só por diversão") fica. O selo de palpite liquidado com placar ao lado ("1º tempo 1-0 · acertou"), que a revisão manda manter, continua com a mesma estrutura; só a palavra/caixa vem do selo.
  - Bolão `[id]`: some a coluna fixa do ✓ (`<span className="w-5 shrink-0">`, também resolve o "empurra os nomes" da revisão). Depois de liquidado, `ResultBadge` won/lost no fim da linha; antes, nada. O resto do bolão (palpite em duas linhas, selo "apostas abertas", estado vazio) fica para o PR 4.
  - Desempenho: coluna de status da tabela (`predictions-table.tsx:135-136`) com `ResultBadge`; `STATUS_META` sai. `prediction-detail.tsx:132` mostra `ResultBadge` no lugar do texto cru (e some o `resultClass` de `:63-68`); o "Ainda pendente" (`:155`) vira "Em aberto: o resultado aparece depois que o jogo for apurado."
  - Filtro de status (`dashboard-filters.tsx:44-51`) usa `RESULT_LABEL` (ver 16d).
- `/como-usar:356` e `:219-220` (acertou/errou do palpite): conferir que as palavras citadas existem na tela.
- DESIGN.md: o exemplar de "settled state" passa a ser `components/result-badge.tsx` (o `FormDot` continua para forma V/E/D).

**Testes.**
- Novo `components/__tests__/result-badge.test.tsx`: os cinco estados com a palavra e a classe `form-*` certa; pending sem `form-*`.
- `components/__tests__/predictions-table.test.tsx`, `palpite-hero.test.tsx`, `components/palpites/__tests__/*` (onde fixarem "aguardando placar"/"acertou" minúsculo), testes do bolão (se houver; senão um teste de render da linha liquidada), `dashboard-filters-bar.test.tsx:89` (">Green<" → ">Acertou<").
- `lib/db/queries/__tests__/user-bet-slips-page.pglite.test.ts` não muda (o status derivado é o mesmo).

**Riscos.** A palavra muda de caixa no palpite ("acertou" → "Acertou"). `lost` em `/apostas` deixa de ser `destructive` cheio e vira `form-loss`, mais calmo; é o pedido.

---

## Linha 26: um cabeçalho de página e duas larguras

### Situação
As larguras já são duas (`max-w-content` 1040 e `max-w-reading` 640), mas cada página monta o próprio wrapper (`px-5`/`px-6`/`px-8`, `pt-6`/`pt-8`/`pt-10`) e o próprio título: `display-md` na maioria, `display-lg` no desktop de `/jogos`, `text-[28px]` + `lg:display-lg` no desempenho e no admin de usuário, `display-sm` no celular de `/time`, `text-[22px]` no detalhe da predição, e `components/admin/page-heading.tsx` só no admin. Subtítulos ora sans `text-body`, ora mono `text-meta`.

### Mudança
- Novo `components/page-container.tsx`: `PageContainer({ width: "content" | "reading", className?, children })` → `mx-auto w-full px-5 pt-6 pb-16 lg:px-8 lg:pt-10` + `max-w-content`/`max-w-reading`.
  - `content`: a árvore **desktop** de `/jogos` e de `/time/[team]`, e `/dashboard`.
  - `reading`: `/apostas`, `/bolao`, `/bolao/[id]`, `/perfil`, `/como-usar` (o wrapper está em `como-usar/page.tsx:22`), `/dashboard/[predictionId]` e `/admin/users/[userId]/[predictionId]` (via `PredictionDetail`, compartilhado).
  - **Fica de fora:** a árvore **celular** de `/jogos` e de `/time` (lista sangrada, sem `max-w`, com `px-5` em cada bloco e no `SectionLabel`; embrulhar em `PageContainer` dobraria o gutter). Ali só o bloco do cabeçalho troca para `PageHeader` dentro de um `px-5 pt-6`; a lista é do PR 4. Também fora: `/match/[id]` (PR 3) e o admin (decisão 3).
- Novo `components/page-header.tsx`: `PageHeader({ title, description?, meta?, back?, actions? })`.
  - `back` → `BackLink` (o componente atual, `components/back-link.tsx`).
  - h1: `text-display-md font-medium leading-none tracking-tight lg:text-display-lg`.
  - `description`: `pt-2 text-body tracking-tight text-muted-foreground` (sans).
  - `meta`: `pt-1 text-meta tabular-nums text-muted-foreground` (sans; números alinhados).
  - `actions`: à direita no desktop (`lg:flex-row lg:items-end lg:justify-between`), embaixo no celular.
  - Wrapper `pb-6 lg:pb-8`.
  - `PageHeaderSkeleton({ description?, meta?, back? })` com as mesmas alturas (26px / `lg:` 32px de título com `leading-none`), para os `loading.tsx` não pularem (anti-CLS, ADR 0029).
- Adoção, página por página (sem mudar o conteúdo abaixo do cabeçalho):
  - `app/(app)/jogos/page.tsx:288-297` (celular) e `:377-401` (desktop): `PageHeader title="Próximos jogos" meta="{n} partidas · {período}{ · liga}"` nos dois. No celular, o seletor de liga e as datas (`:300-311`) ficam onde estão (filtros em chips são o PR 4). No desktop, os dois vão em `actions`, cada um ainda dentro do seu `<div data-tour=…>` (o `steps.test.ts` procura o atributo literal no código). O `HOME_SUBTITLE` sai (decisão 8): `lib/copy.ts` fica sem uso e é apagado. `app/(app)/jogos/loading.tsx` (`:15-19` celular, `:30-33` desktop) com `PageHeaderSkeleton`.
  - `app/(app)/dashboard/page.tsx:64-73` (+ `loading.tsx`).
  - `app/(app)/time/[team]/page.tsx:195-202` (celular) e `:246-252` (desktop): título com o nome do time, `meta="histórico do time"`, `back={{ href: "/jogos", label: "jogos" }}` (troca o link manual de `:186-194` e `:238-245`). + `loading.tsx`.
  - `app/(app)/apostas/page.tsx:75-81`, `app/(app)/bolao/page.tsx:54-58`, `app/(app)/bolao/[id]/page.tsx:65-80` (back "bolão", `description` com jogo + link "ver jogo", `meta` com apostas e pote), `app/(app)/perfil/page.tsx:47-50`, `app/(app)/como-usar/como-usar-content.tsx:78` (o h1 do conteúdo vira `PageHeader`; o teste renderiza `ComoUsarContent`, então segue valendo). + `bolao/loading.tsx`, `bolao/[id]/loading.tsx`. (`/apostas`, `/perfil` e `/como-usar` não têm `loading.tsx`; não criar.) Em `/apostas` a constante `RISK_DISCLAIMER_PT_BR` continua renderizada (`components/__tests__/bet-slip-guards.test.ts:68` lê o fonte da página).
  - `components/dashboard/prediction-detail.tsx:71-80`: `PageContainer width="reading"` + `PageHeader back title="{casa} × {fora}" meta="{liga} · {data}"` (sai o "prediction {id}" de depuração, como o "MATCH · id" do PR 1; o admin tem o id na URL). Vale para `/dashboard/[predictionId]` e o admin. + `dashboard/[predictionId]/loading.tsx` e `admin/users/[userId]/[predictionId]/loading.tsx`.
  - **Admin fica como está** (decisão 3): `components/admin/page-heading.tsx` continua sendo o cabeçalho do admin e recebe o piso de 11px pelo codemod; `admin/users/[userId]/page.tsx:82` só troca `text-[28px]` por `text-display-md` (3d).
  - Fora: `error.tsx`, `not-found*.tsx` (cartão de estado, não cabeçalho de página), `app/(app)/match/[id]/**`, admin, páginas públicas (`/`, `/como-funciona`, `/termos`, `/privacidade`, `/signin`, `/p`).

**Testes.**
- Novo `components/__tests__/page-header.test.tsx`: um h1; `back` renderiza o `BackLink`; `actions` presente; classes de tamanho (`text-display-md`, `lg:text-display-lg`).
- Novo `__tests__/page-header-coverage.test.ts` (no molde do `app-shell-coverage`): nenhum arquivo `.tsx` em `app/(app)/**` (fora de `match/`, `admin/`, `__tests__`, `error.tsx`, `not-found.tsx` e `loading.tsx`) contém `<h1` direto; e em `components/**` só `page-header.tsx` e `admin/page-heading.tsx` têm `<h1` (lista explícita no teste; conferido: hoje só `admin/page-heading.tsx:22` e `dashboard/prediction-detail.tsx:75` têm, e o segundo sai). `app/not-found-content.tsx` e `app/p/[id]/not-found.tsx` ficam fora do escopo do teste (não são `app/(app)`).
- Ajustar testes que buscam o h1 por classe, se houver (`components/__tests__/back-link.test.tsx` pina a classe do `BackLink`, que não muda).
- Tour: `league-picker`, `date-range`, `recent-predictions`, `match-row` continuam no DOM de `/jogos` (o `steps.test.ts` confere que o `data-tour` existe no código; conferir também na tela).

**Riscos.**
- `/jogos` e `/time` têm duas árvores (celular `lg:hidden` / desktop `hidden lg:block`); as duas recebem o mesmo `PageHeader`. Não juntar as árvores aqui (isso é o PR 4 para listas e o PR 3 para o jogo).
- O h1 do desempenho no celular cai de 28px para 26px; o de `/time` no celular sobe de 18 para 26px. É a unificação pedida.
- Os `loading.tsx` precisam acompanhar cada página, senão o cabeçalho pula ao carregar.

---

## ADR 0056 e DESIGN.md (commit 1)

- Número conferido: o último ADR em `docs/decisions/` é o 0055 (`0055-contexto-do-usuario-como-afirmacoes-a-conferir.md`) e nenhum plano reserva o 0056; o ADR planejado para jogos ao vivo fica com o 0057. Se o de jogos ao vivo chegar ao main antes, renumerar este (e as menções no DESIGN.md e na 0029) no rebase.
- `docs/decisions/0056-piso-de-11px-mono-so-em-numero-e-vocabulario-de-tela.md` (curta). Decide: (1) escala com piso de 11px: `eyebrow-xs`/`eyebrow` aposentados, `display-xs` 22 e `display-xl` 40 entram, zero `text-[Npx]` (substitui a seção "Exceções registradas pela #246" da 0029 quanto a 22/30); (2) mono só para número (odd, placar, %, unidade, data/hora), sempre com `tabular-nums`; rótulo em sans; (3) `muted-fg-2` escuro 0,62 e claro 0,52, só em texto ≥12px e nunca sobre preenchimento sólido `*-soft`/`surface-3`, com a tabela de contraste; (4) vocabulário de tela na camada de view (`lib/view/markets/display.ts`), sem tocar prompt, seed nem `presentation.ts`, com a tabela do glossário; (5) `ResultBadge` como selo único de resultado; (6) `PageHeader` + `PageContainer` com duas larguras nas telas de usuário; (7) escopo do admin: só regras de token (piso, contraste, zero `text-[Npx]`), mantém mono, termos técnicos e `PageHeading`; (8) exceção conhecida: iniciais do `TeamAvatar` abaixo de 11px até o PR 5.
- ADR 0029: uma linha no Status: "Emendada pela ADR 0056 (escala tipográfica e exceções 22/30)". O resto fica (é registro histórico).
- `DESIGN.md`: Typography (nova escala, regra do mono, sans nos rótulos), Color (`muted-fg-2` com a regra de ≥12px e de fundo), Components (`ResultBadge`, `PageHeader`, `PageContainer`), Layout (duas larguras e o gutter), e uma linha "Vocabulário de tela" apontando para a ADR 0056 e para `lib/view/markets/display.ts`.
- `docs/plans/**` antigos citam `text-eyebrow`: não mexer (são históricos).

---

## Checklist de `/como-usar` e do tour
- `/como-usar`: `:82`, `:129`, `:172`, `:216`, `:226`, `:286`, `:313`, `:346`, `:353`, `:356`; o h1 vira `PageHeader`. Lista do teste de rótulos atualizada (linha 17).
- Tour (`lib/tour/steps.ts`): títulos `:78` ("Palpite da IA") e `:88` ("Suas apostas"); textos `:51`, `:79`, `:89`, `:103`. **Nenhum `target` muda.** `guided-tour.test.tsx:209` atualizado.
- Alvos `data-tour` que precisam continuar no DOM: `menu`, `league-picker`, `date-range`, `recent-predictions`, `match-row`, `palpite`, `seu-palpite`, `bet-slip`, `odds`, `match-stats`.

## Critério de saída
`pnpm test`, `pnpm lint`, `pnpm typecheck` e `pnpm build` verdes. Conferência manual em 390px e 1440px, claro e escuro:
- nenhum texto abaixo de 11px (DevTools: nenhum `font-size` < 11px no computed das telas logadas), **exceto** as iniciais decorativas do `TeamAvatar` (`components/team-avatar.tsx:54`, `aria-hidden`, PR 5);
- `grep -rn 'text-eyebrow\|text-\[[0-9]' app components lib` sem resultado;
- `/jogos` (lista e chips "Mais de 2,5"), `/apostas` (selos, título "Suas apostas"), `/bolao/[id]` (selo no fim da linha, sem coluna vazia), `/dashboard` (retorno / taxa de acerto / jogos sem aposta, filtro em português, coluna "vantagem", selo de status), `/dashboard/[id]`, `/time/[x]`, `/perfil`, `/como-usar` com o mesmo cabeçalho e o mesmo gutter (o `/admin` só confere o piso de 11px e que nada quebrou);
- `/p/[id]` (público): kicker "Palpite da IA", selo "Acertou"/"Errou", categoria "Total de gols";
- página do jogo: "Palpite da IA", grade "mercados", painel "Suas apostas", odds "Total de gols · Mais de 2,5", "Sem aposta" na análise, "+5,6 pontos";
- sem rolagem horizontal em 390px nas telas acima;
- tour completo nas duas páginas, todos os passos com alvo;
- menu: "suas apostas".

## Decisões (resolvidas pelo dono, 2026-10-15)
Todas com o padrão que este plano recomendava. Nada fica em aberto para a implementação.
1. **Tema claro também:** sim. `--muted-fg-2` claro 0,55 → 0,52 (5,05:1 sobre `surface-2`), no commit 2.
2. **Título da grade de apostas na página do jogo:** "mercados" (o nome que o PR 3 dá à tabela única); o botão "Registrar apostas" (verbo) fica.
3. **Admin:** mantém mono, termos técnicos e o próprio `PageHeading`; recebe só as regras de token (piso de 11px, contraste do `muted-fg-2`, zero `text-[Npx]`). O guarda de mono e o de cabeçalho ignoram `app/(app)/admin/**`. Componentes compartilhados (`PredictionDetail`, `PredictionsTable`, `KpiCards`) seguem a regra de usuário.
4. **Rótulos em sans:** continuam em caixa-alta com `tracking-label`/`tracking-eyebrow` (só sai o `font-mono`). Tirar a caixa-alta, se vier, é do PR 4.
5. **CLV, no-vig e `n=`:** ficam para o PR 4 (linha 21).
6. **`/como-funciona` e corpo da landing:** ficam para o PR 6. Aqui só muda o que é compartilhado (o glossário de `components/help/glossary.ts`, os codemods de classe e o rodapé).
7. **Chip de over/under na lista:** "Mais de 2,5"; "+2,5"/"−2,5" só no chip e só se estourar em 390px.
8. **`HOME_SUBTITLE`:** sai (era só do celular); `lib/copy.ts` é apagado.
9. **Tokens novos:** `display-xs` (22) e `display-xl` (40), registrados na ADR 0056.
10. **Nome do mercado over/under na tela:** "Total de gols".

### Arquivos críticos para a implementação
- `app/globals.css`, `lib/utils.ts` (+ `lib/utils.test.ts`), `components/ui/badge.tsx`, `components/site-footer.tsx`, `DESIGN.md`, ADR 0056, ADR 0029 (linha de Status).
- `lib/view/markets/display.ts` (novo), `lib/view/recommendation.ts`, `lib/view/{analysis,odds,match-model,dashboard,recent-prediction,bet-slip,sections,best-bet}.ts`, `lib/dashboard/derive-view.ts`, `lib/format-number.ts`.
- `components/result-badge.tsx` + `lib/view/result-state.ts` (novos), `app/(app)/apostas/page.tsx`, `app/(app)/bolao/[id]/page.tsx`, `components/palpites/palpite-badges.tsx`, `components/dashboard/{predictions-table,prediction-detail,dashboard-filters,kpi-cards,market-segments}.tsx`.
- `components/page-header.tsx` + `components/page-container.tsx` (novos), as `page.tsx`/`loading.tsx` de usuário em `app/(app)` (menos `match/` e `admin/`; no admin só `admin/users/[userId]/page.tsx:82` e `admin/costs/page.tsx:175` mudam de classe), `lib/copy.ts` (apagado).
- `lib/nav/menu.ts`, `lib/tour/steps.ts`, `app/(app)/como-usar/como-usar-content.tsx`, `components/help/glossary.ts`, `components/bet-slip.tsx`, `components/palpites/{palpite-hero,public-palpite}.tsx`.
- Testes de guarda novos: `components/__tests__/design-scale-guard.test.ts`, `__tests__/page-header-coverage.test.ts`, guarda de fronteira `lib/ai` ↛ `lib/view/markets/display`.

## Revisão do plano

Revisão adversarial feita contra o código em `c31a4b4` (= `origin/main`), antes da implementação. O que mudou e por quê:

1. **Decisões fechadas.** As 10 perguntas viraram a seção "Decisões", com o padrão recomendado aceito pelo dono. As menções "(pergunta N)" no corpo viraram "(decisão N)" e os condicionais ("se a pergunta 1 sair sim") viraram passos fixos.
2. **Escopo do admin cortado** (decisão 3 diz "só o piso de 11px"). Saíram: a migração das 7 páginas do admin e de `admin/users/[userId]` para `PageHeader`/`PageContainer`, a remoção de `components/admin/page-heading.tsx`, os `loading.tsx` do admin e a troca de vocabulário em `admin/users/[userId]/page.tsx:86`. O admin fica com as regras de token (piso, contraste, zero `text-[Npx]`); `admin/users/[userId]/page.tsx:82` só troca `text-[28px]` por `text-display-md`. Componentes compartilhados (`PredictionDetail`, `PredictionsTable`, `KpiCards`) seguem a regra de usuário, inevitavelmente.
3. **Fronteiras com os PRs 4 e 6 explícitas** no topo. Telas públicas só recebem as trocas mecânicas de classe; listas (`/jogos` celular, filtros, `/apostas` detalhe, bolão além do selo) não mudam de estrutura.
4. **`PageContainer` não embrulha a árvore celular de `/jogos` e `/time`.** Ali a lista é sangrada e cada bloco (inclusive o `SectionLabel`, `px-5`) já tem gutter; o plano anterior dobraria o padding. Só o cabeçalho troca; os filtros do celular ficam onde estão.
5. **Codemods endurecidos.** `font-mono` (3c): lookbehind `(?<![\w:-])` para não transformar `marker:font-mono` em `marker:` solto, lookahead para pegar a classe no fim da string, exclusão de admin e testes no próprio comando. `muted-fg-2` (2b): o mesmo lookbehind, para não depender de nenhuma linha com variante ter `text-meta`. Registrado que o 3b reescreve os snapshots inline do golden (verde sem `-u`), e que no 2b/3c o golden fica de fora do codemod e é regenerado.
6. **Grupo C do mono não é todo número.** Achados `analysis-result.tsx:43` ("PASS" grande), `recent-pred-card.tsx:31` (times), `market-segments.tsx:35` ("graduando"); entram na revisão manual. Grupo A com conteúdo misto (`apostas/page.tsx:147`, `site-footer.tsx:31`) anotado.
7. **Contagens corrigidas.** `text-eyebrow-xs` 52/22 arquivos, `text-eyebrow` 187/71, juntas 239 em 76 arquivos (o "237 em 75" do rascunho misturava os dois); `text-meta` 99; `font-mono` 315 (D = 79/66); `text-[Npx]` são 12 usos de classe mais 3 comentários.
8. **Exceção do piso de 11px que faltava:** `components/team-avatar.tsx:54` (iniciais a 7,9px, por estilo inline, que nenhum grep de classe pega). Fica para o PR 5 (escudos) e entra como exceção no critério de saída e na ADR.
9. **Rodapé:** `site-footer.tsx:28` deixou de ser "conferir" e virou troca obrigatória (raiz `text-muted-fg-2` com filhos de 11px).
10. **Referências corrigidas:** `PredictionRowView` está em `lib/view/dashboard.ts:166` (não em `types.ts`); chamadas de `marketContextLabel`/`recommendationLabel` em `dashboard.ts:195/199,337/346` e `recent-prediction.ts:64/70`; badges de `/apostas` em `:152` e `:214`; coluna de status em `predictions-table.tsx:135-136`; `Kicker` em `palpite-hero.tsx:685-689`; botão "Registrar apostas" em `bet-slip.tsx:774`; `jogos/page.tsx:377`, `time/[team]/page.tsx:238-252`; testes `lib/format-number.test.ts` (não `lib/__tests__/`) e `lib/view/__tests__/match.test.tsx`.
11. **Rótulo de mercado vindo do banco aplicado no mapper, não na página:** `recent-prediction.ts:70-72` em vez de `jogos/page.tsx:216`; acrescentados `dashboard.ts:156` (segmentos) e `:347` (detalhe).
12. **Fronteira `lib/ai` ↛ `display.ts` precisada:** `lib/ai/best-bet.ts` importa `computeBestBetRank` de `lib/view/best-bet.ts`, então `display.ts` entra transitivamente no grafo de `lib/ai`. É inofensivo (o rank só usa números), mas o guarda passa a ser sobre import direto, mais a checagem de que `predict.ts`/`synthesis-input.ts` seguem em `presentation`, mais o guarda de pureza de bundle no `display.test.ts`.
13. **Testes que faltavam:** `lib/view/sections.test.ts:38` (resumo do H2H "over 67%"), `lib/view/__tests__/best-bet.test.ts` (rótulo do mercado), o alinhamento `includes(h)` de `predictions-table.tsx:80` junto com o cabeçalho "vantagem", e a pegadinha do teste de `/como-usar` (procura rótulos só em `.tsx`; "Em aberto" de `lib/view/result-state.ts` não seria achado).
14. **Pequenos acréscimos de vocabulário:** blurb `analysis-scenarios.tsx:237` ("medir o edge"), termo do glossário "pendente vs liquidada" (`:255`) → "em aberto", `markets.over_under` das entradas. Risco novo anotado: largura de "+5,6 pontos" na tabela e no cartão de recentes, com plano B.
15. **`/p` incluído no critério de saída** (kicker, selo e categoria mudam lá via componentes compartilhados).
16. **ADR 0056 confirmado livre** (último é o 0055); o de jogos ao vivo fica com o 0057, com nota de renumerar no rebase se ele chegar antes. A ADR ganha dois itens: escopo do admin e a exceção do `TeamAvatar`.
17. **`prediction-detail`:** o "prediction {id}" de depuração sai do `meta`, no mesmo espírito do "MATCH · id" removido no PR 1.

Sem alternativa mais simples que valha trocar: o módulo de display na view é o único jeito de mudar rótulo sem tocar seed nem prompt; redefinir os tokens antes de renomear continua sendo a forma mais barata de revisar o render.

**Riscos que ficam:**
- Diff grande e espalhado (codemods em ~76 arquivos mais o vocabulário) colidindo com o PR 3 na página do jogo; este PR entra antes e o PR 3 faz rebase.
- A revisão manual do mono (grupos C e D, ~70 linhas, mais as classes em várias linhas) é julgamento caso a caso; o guarda do caso 3 só pega classes numa linha.
- Linhas densas a 11px (lista, colunas fixas do desktop, tabela do desempenho, chips) e "Mais de 2,5"/"+5,6 pontos" mais largos: só a conferência em 390px e 1440px garante.
- Janela de inconsistência até o PR 6: `/como-funciona` segue com PASS/yield/pp no corpo enquanto o glossário compartilhado já fala português.
- Muitos testes de view mudam de expectativa no mesmo commit da linha 16; rodar `pnpm test` antes de seguir.
