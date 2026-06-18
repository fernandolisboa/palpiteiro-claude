# ADR 0029 — Fundação de design: escala de tipografia/espaço/tracking + convenções de uso dos tokens

## Status

Accepted (2026-06-18) — **fatia 1 (fonte da verdade) do épico de de-slop visual #320** (issue
#321). Vive na **camada de apresentação**: não emenda nenhum ADR de produto/dados. É
**apresentação-only** (zero mudança funcional, paridade de dados preservada) e **shell-only**
nesta fatia — match/dashboard/admin/perfil/público herdam a escala por edição de classe nas
fatias #246/#322–#325. Numeração: 0027 é o último aceito; **0028 está reservado** pro arco de
palpites (#313).

## Contexto

`app/globals.css` já tem uma fundação de **cor** madura: ~60 tokens em `@theme inline`
(globals.css:6-65) com famílias semânticas completas (accent/cobalt, edge/leaf-green, warn/
amber, form W/D/L, escala neutra estendida `surface-2/3`, `border-subtle/strong`, `muted-fg-2`)
espelhadas em light (`:root`, :67-131) e dark (`.dark`, :133-196), mais `--radius-*` (sm/md/lg/xl
sobre `--radius: 0.625rem`).

O que **NÃO existe** e gera a entropia visual percebida como "slop de IA":

- **Zero token de tipografia** (`--text-*`), tracking (`--tracking-*`), leading ou espaçamento.
  Só `--font-sans`/`--font-mono` (globals.css:9-10). Sem escala nomeada pra "snap-ar", todo
  componente cai em px-perfect arbitrário.
- **Zero `prefers-reduced-motion`** em qualquer lugar; `animate-spin`/`animate-pulse` + animações
  Radix (sheet/popover) ignoram a preferência do SO.

Consequência medida (grep em `app/`+`components/`, 69 arquivos, 424 usos de `text-[Npx]`):

- **22 tamanhos de fonte distintos** com fragmentação de meio-pixel: 10/10.5 (72/75, **empatados**),
  12/12.5 (30/53), 13/13.5 (65/13), 9/9.5 (3/14), 11/11.5 (43/9). **Zero** uso de `text-xs/sm/base`.
- **13 valores de tracking** ad-hoc pro mesmo papel de eyebrow; **4** valores de `rounded-[Npx]`.
- **30+ cores cruas** fora de token: `emerald-500` (7, ganho), `red-500` (10, perda),
  `amber-500/700` (5, warn), `sky-500` (1), + hex `#a78bfa` (2 linhas em
  `components/dashboard/bankroll-chart.tsx`).
- **Primitivas divergentes**: Callout em 4 implementações à mão; EmptyState ora `<div>` ora card;
  Wordmark "palpiteiro" em **3 tamanhos** (desktop-shell.tsx:24 17px, page-header.tsx:23 18px,
  signin/page.tsx:32 20px) e **3 sufixos**; `Select`/`Label` **ausentes** de `components/ui/`;
  Badge primitivo reescrito inline com `h-[Npx]`+`text-[Npx]` em 7+ lugares.
- **a11y de shell**: `desktop-shell`/`mobile-nav` sem `aria-current`/`aria-label`/`focus-visible`
  (só `help-hint.tsx` tem ring de foco correto — é o template). `team-avatar.tsx:21-22` hardcoda
  `oklch(0.32 0.04 hue)`/`oklch(0.88 0.04 hue)` **theme-invariante** (no dark fica quase colado no
  fundo). `loading.tsx` duplica o heading divergindo (26px/`leading-[1.05]`/`pt-1` mobile vs
  32px/`leading-[1]`/`pt-10` desktop). `glossary-section.tsx:37,44` usa `pl-[22px]` mágico.

**Portanto o slop é majoritariamente USO INCONSISTENTE, não falta de tokens** — exceto a lacuna
real de tipografia/tracking/leading/espaço, que é onde esta ADR atua.

## Decisão

Duas frentes, ambas **presentation-only**.

### A. Preencher os buracos do `@theme` (a fonte da verdade)

1. **Escala tipográfica finita (9 passos), `font-size` only.** Derivada da distribuição
   **medida** (não inventada), em **pixels inteiros** (meios-pixels banidos no token), colapsando
   bandas próximas:

   `--text-eyebrow-xs` 9 · `--text-eyebrow` 10 · `--text-meta` 11 · `--text-body-sm` 12 ·
   `--text-body` 13 · `--text-label` 14 · `--text-display-sm` 18 · `--text-display-md` **26** ·
   `--text-display-lg` 32.

   **Sem `--text-*--line-height` pareado** — decisão deliberada. No Tailwind v4 a utility de
   font-size é `font-size: var(--text-x); line-height: var(--text-x--line-height)`; **omitir** o
   companion faz o line-height **herdar**, idêntico ao `text-[Npx]` (que também seta só
   font-size). Assim `text-[13px]→text-body` é **byte-idêntico** em rendering. Bakear um
   line-height seria uma mudança app-wide silenciosa (o census mostra ~14 usos explícitos de
   `leading-*` vs 424 de tamanho; vários numéricos densos usam `leading-none` de propósito). O
   pairing size→leading é **documentado** (headings → `leading-none`/`leading-tight`; corpo →
   default) e migrações aplicam as utilities `leading-*` padrão onde a origem tinha leading
   explícito; `leading-[1]`/`leading-[1.05]` ad-hoc → `leading-none`.

   - `display-md = 26` (não 24): `app/loading.tsx` (shell, migrado nesta fatia) e `app/page.tsx`
     "Próximos jogos" (conteúdo, migrado depois) compartilham o par `26/32`; colapsar 26→24
     desincronizaria o skeleton do live por 2px (o CLS que a fatia mata). `22→26` (conteúdo)
     documentado pros heirs.
   - 15px é context-dependent: nav-row mobile (corpo) → `text-label`(14); heading 15px →
     `display-sm`(18). Os h1 de 20px (admin/perfil) unificam **pra cima** → `display-md`(26),
     alinhando com o h1 do home — não encolhem.

2. **Tracking — 2 tokens NOVOS, sem colidir com a escala do Tailwind.** `--tracking-label`
   (0.14em, eyebrows/badges mono uppercase — valor dominante, 62 usos) e `--tracking-eyebrow`
   (0.18em, sufixo de marca / section-label / headers 404). **Não** reusamos os nomes reservados
   `tracking-wide/wider/widest`: redefinir `--tracking-wide` saltaria os 2 usos de
   `recent-pred-card.tsx` (conteúdo, fora de escopo) de 0.025em→0.18em. **Não** redefinimos
   `tracking-tight` (134 usos app-wide): a banda negativa ad-hoc do shell
   (`-0.04`/`-0.035`/`-0.02`) é roteada pro `tracking-tight` existente — mantém a mudança
   **aditiva** (zero shift em conteúdo) e ainda elimina `tracking-[Nem]` arbitrário do shell.

3. **Larguras recorrentes como constantes** via namespace `--container-*` → utilities `max-w-*`:
   `--container-content` 1040 · `-aside` 320 · `-narrow` 480 · `-reading` 640 · `-form` 380
   (px, pra paridade). Colapsa 1100→1040, 680→640, 360→380.

4. **`@media (prefers-reduced-motion: reduce)` global** em `globals.css` zerando **só** duração
   (`transition-duration`/`animation-duration`, `animation-iteration-count:1`,
   `scroll-behavior:auto`) — **nunca** `animation-name`/display, pra Radix sheet/popover ainda
   montar e abrir/fechar (sem animação) sob reduce.

5. **Avatar tokenizado por tema.** `--ta-bg-l`/`--ta-fg-l` (lightness) em `:root` (0.32/0.88) e
   `.dark` (0.40/0.92); `team-avatar.tsx` passa a `oklch(var(--ta-bg-l) 0.04 ${hue})` /
   `oklch(var(--ta-fg-l) 0.04 ${hue})`. O **hue fica inline e intocado** (identidade estável — o
   hue é computado em `lib/view/team.ts`, nunca no componente); o light é exatamente 0.32/0.88
   (paridade byte), só o ramo `.dark` é novo.

### B. Convenções de uso dos tokens existentes (a disciplina que tudo herda)

- **Mapa semântico de cor** (proibido cru fora do mapa): ganho/over/profit+ = `edge-fg`
  (+`edge-soft`/`edge-border`); perda/negativo = `destructive`; aviso/amostra-pequena =
  `warn-fg`/`warn-soft`/`warn-border`; accent/link = `accent-fg`/`accent-strong-fg`. **Séries de
  gráfico sempre tokenizadas, nunca hex** — o `#a78bfa` de `bankroll-chart.tsx` migra pra um
  `chart-N` existente **no #322** (a paleta de chart já tem 5 séries; **nenhum token de cor novo
  é cunhado aqui**).
- **Raio só via `--radius`** (`rounded-sm/md/lg/xl`/`rounded-full`); proibir `rounded-[Npx]`.
- **Foco visível** `focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none`
  em **todo** controle interativo, incluindo `<select>`/checkbox nativo e Links custom — não só
  nos primitivos shadcn (que já têm).
- **`motion-reduce:`** nas animações além do bloco global.
- **Controles de form só via primitivos** (`Input`/`Button`/`Select`/`Label`). `Select` é um
  `<select>` **nativo estilizado** (não Radix): os consumidores (perfil/admin) já são selects
  nativos ⇒ drop-in, sem mudar modelo de interação; o `radix-ui` unificado segue disponível se um
  controle mais rico for preciso no futuro.
- **Breakpoints só sm/md/lg** (banir `min-[Npx]:`).
- **Wordmark único** (`<Wordmark suffix>`): marca `display-sm` + `tracking-tight`; sufixo mono
  `text-eyebrow` uppercase `tracking-eyebrow` `text-muted-fg-2`. O **texto** de cada sufixo é
  preservado verbatim (o tagline obsoleto "over/under 2.5" do signin é **copy** — fica pro #323).
- **nav-link com `aria-current="page"`** + `<nav aria-label>`.
- **Exceções shadcn herdadas (documentadas, NÃO "corrigir")**: `text-white` no variant
  `destructive` (`ui/badge.tsx:16`, `ui/button.tsx:14`) é contraste intencional no fill; o
  `bg-black/50` do overlay (`ui/sheet.tsx`) é o scrim padrão do Radix Dialog. São as **únicas**
  fugas de cor crua sancionadas.

## Consequências

- **(+)** Fonte única da verdade pra tipo/tracking/largura/motion no `@theme`; o resto da app
  herda por edição de classe, sem re-derivar a escala. 22 tamanhos → 9; meios-pixels e bandas
  duplicadas mortos no token.
- **(+)** a11y de foco/`aria-current`/tema-do-avatar corrigida no shell; `prefers-reduced-motion`
  respeitado app-wide.
- **(−) Carve-out do critério "primitivas usadas no shell"**: `Callout`, `Wordmark` e `NavLink`
  **são** adotados no shell agora; `Select`/`Label`/`EmptyState` e as variantes de **tamanho** de
  `Badge` são criados como **fundação** cujos consumidores vivem em superfícies de conteúdo
  (selects de perfil/admin; empty states; badges hand-rolled de odds/match) e adotam nos heirs
  #322–#325. Registrado explicitamente pra o critério não falhar em silêncio.
- **(−)** Os colapses de escala são opinativos (ex.: marca 17/18/20 → `display-sm` 18; `22→26`)
  — documentados aqui pra não serem re-divergidos.
- **(−)** `Select`/`Label`/`EmptyState` quase não são exercidos shell-only ⇒ baixa cobertura até
  os heirs (aceitável numa fatia de fundação; manufaturar consumidor falso seria pior).
- **Skeletons (anti-CLS) deferidos com razão**: a "linha real" de `match-list-skeleton`
  (home desktop) é conteúdo não-migrado; re-derivar a altura por token agora a desincronizaria.
  A derivação-por-token anda **junto** com a migração de cada linha real (evita introduzir CLS).
- **Ripple em golden de conteúdo**: editar primitivas **compartilhadas** (`help-hint`,
  `team-avatar`) muda o output renderizado dos consumidores ⇒ `odds-card-parity.golden` é
  **regenerado** (verificando que o diff é só `text-[9px]→text-eyebrow-xs` e a representação
  `oklch(...)→oklch(var(...))` com dígitos de hue + valores light preservados). Não editamos os
  arquivos de conteúdo — só o snapshot reflete a mudança da primitiva.

## Exceções registradas pela #246 (referência viva)

A fatia #246 (de-slop da match page) é a **referência viva** onde a escala é exercida primeiro;
onde a tela diverge, #246 ganha e esta ADR registra (doc-only — sem cunhar token novo):

- **`text-[22px]` / `text-[30px]` como outliers sancionados de _heroic display_**: o valor da odd
  (`odds-card.tsx`) e o hero desktop (nome do time, "vs", placar) usam 22px/30px, que **não têm
  degrau** na escala (gaps display-sm 18 → display-md 26 → display-lg 32). Colapsar achataria a
  hierarquia da tela de referência. Ficam como `text-[Npx]`/`lg:text-[Npx]` arbitrários
  **comentados**, NÃO um token — adicionar `--text-display-xs` é decisão de fundação (futura,
  #321/#320) que pré-emptaria os heirs; **#246 não cunha token**.
- **Tracking de eyebrow normaliza pra `--tracking-label`(0.14em)**: os `tracking-[0.12em]` ad-hoc da
  match-tela passam pro token dominante (0.14em) — mudança de valor consciente, não rename.
- **`EmptyState` ganha uso com override in-card**: aninhado em collapsibles/section cards o
  py-12/centering shell-grade é alto demais → consumidores passam `className="py-6"`. #246 é o
  primeiro consumidor real de conteúdo do primitivo (carve-out previsto nas Consequências).
- **Breakpoint 480→640**: banir `min-[480px]:` (regra desta ADR) move o reflow do grid de cenários
  pra `sm`(640px) — consequência intencional, sem custom screen.
- **Geometria de grid-track**: a ADR não tem namespace de token pra larguras de coluna; templates
  mágicos repetidos (`grid-cols-[20px_1fr_36px_36px_44px]` em standings) viram **const nomeada**
  (`STANDINGS_GRID`) — convenção sancionada (extract-to-const).

## Alternativas consideradas

1. **Só lint/convenção sem tokens no `@theme`** — rejeitado: sem escala nomeada cada superfície
   re-deriva os meios-pixels; o lint pegaria o sintoma, não a fonte.
2. **Bakear `--text-*--line-height` em cada token** — rejeitado: mudança app-wide silenciosa de
   line-height herdado; quebra alinhamento de numéricos densos que dependem de `leading-none`.
   Documentar o pairing + `leading-*` explícito é equivalente em intenção e seguro.
3. **`display-md = 24` (ponto-médio de 22/26)** — rejeitado: desincroniza o skeleton de shell do
   live não-migrado por 2px (CLS).
4. **Redefinir `tracking-tight`/`tracking-wide`** — rejeitado: toca rendering de conteúdo
   (incl. `recent-pred-card.tsx`, fora de escopo) por nomes reservados; nomes novos
   (`-label`/`-eyebrow`) + reuso do `tracking-tight` existente são aditivos.
5. **Escala fina (12+ passos preservando 17/18/20, 22/26, 28/32)** — rejeitado: reintroduz a
   fragmentação que o épico existe pra matar.
6. **Migrar superfícies de conteúdo aqui** — rejeitado: viola shell-only e colide com
   #246/#322–#325. `bankroll-chart`/`match-row`/`match-sections-skeleton` removidos do escopo
   por isso.
7. **Cunhar `--color-chart-profit` pra de-hex o `#a78bfa`** — rejeitado: é cor de chart (#322) e
   a paleta já tem `chart-1..5`; reusar uma série existente honra "nenhum token de cor novo".
8. **`Select` via Radix** — rejeitado pra esta fatia: consumidores são `<select>` nativos; um
   primitivo nativo-estilizado é drop-in e não muda o modelo de interação dos heirs.

## Referências

`app/globals.css` (`@theme` 6-65; `:root` 67-131; `.dark` 133-196; base 198-205),
`components/ui/{badge,button,input,card}.tsx` (padrão focus-visible/cva), `components/help-hint.tsx`
(único focus-visible de shell correto — template), `components/team-avatar.tsx:18-25` (oklch
hardcoded), `app/loading.tsx:18,37` (heading divergente), `components/__tests__/back-link.test.tsx`
(pin de classe), `components/__tests__/odds-card-parity.golden.test.tsx` (golden de conteúdo com
ripple). Épico #320; fatias #246 (referência viva), #322 (dashboard), #323 (público), #324
(admin), #325 (perfil). Docs: Tailwind v4 `@theme`/font-size (line-height companion). Plano:
`docs/plans/PLAN-321.md`.
