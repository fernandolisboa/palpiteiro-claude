# PLAN — #331: de-slop do feed de jogos (match-row + grade + tabs + recent-pred-card) — fatia 5

> Plano de implementação (artefato histórico, snapshot 2026-06-18). Fatia 5 do épico **#320**.
> Herdeiro da fundação **#321** (ADR 0029, MERGED, PR #327 — fonte da verdade de tipo/tracking/
> largura/motion no `@theme`) e da **#246** (match page, referência viva, MERGED) + precedente das
> **#322** (dashboard) e **#323** (entrada/público). Adota tokens/primitivas que a fundação criou;
> **não re-deriva nem cunha token** (banido pela ADR 0029 — sem `--text-*`, `--tracking-*`,
> `--color-*`, `--radius-*`, `--space-*` novos). Derivado de censo read-only line-by-line + 4-lens
> review (scope/data-parity, token-fidelity, golden/CLS, a11y/coerência), todos verificados byte-exatos
> contra o código. **Feed-only** (a grade de jogos da home, importada só por `app/page.tsx`).
>
> ## ✅ BLOQUEADOR DE FUNDAÇÃO — RESOLVIDO (#333 MERGED, owner escolheu Path A)
>
> O bloqueador abaixo (eixo `size` do `Badge` quebrado pelo `twMerge` vanilla → badge a 12px) foi
> **corrigido na fundação** pelo **#333** (PR #334, `extendTailwindMerge` em `lib/utils.ts`, MERGED
> 2026-06-18). Provado empiricamente: `size=xs/sm` + cor agora rende a 10px. **Logo a Decisão 1
> (Badge size axis), o passo 1 e os flips de badge no golden estão ATIVOS** — implementar normalmente.
> **Trate toda marcação "SUSPENSO" no corpo abaixo como LEVANTADA** (é texto anterior ao merge do #333).
> Reafirmação da nota original (segue válida): no passo 8, re-derivar a previsão de flips do golden a
> partir do REGEN REAL probado, NÃO da previsão à mão.

## Princípio

Só **apresentação**, zero mudança funcional, **paridade de dados** preservada (jogos, odds, status,
placares, marcadores 'analisado'/'encerrado', copy verbatim), sem regressão. Conduzido via
`/impeccable`. **A home é session-gated** (`middleware.ts` matcher `/((?!api/|monitoring…|signin$|
como-funciona$).*)` **NÃO exclui `/`** — confirmado; usuário anônimo é redirecionado pra `/signin`),
logo o `/impeccable` roda **logado** (preview Vercel autenticado, como na #322), NÃO anônimo. A
fundação (#321) é a fonte da verdade no `@theme` de `app/globals.css`; aqui só **roteamos classes**
pros tokens.

## ⚠️ Diferença de risco vs #246/#322/#323: o golden VAI mudar (de propósito)

`components/__tests__/odds-card-parity.golden.test.tsx` congela **byte-a-byte**
(`toMatchInlineSnapshot`) os snapshots de **`MatchRow`** (linha 66) e **`UpcomingMatchesDesktop`**
(linha 73) — dois dos componentes que esta fatia migra. Nas fatias anteriores a invariante era NÃO
tocar esse golden; **aqui é o oposto: re-snapshotar conscientemente** esses dois blocos. O golden é o
gate de paridade desta fatia. **Baseline GREEN (3/3) confirmado no `main` limpo.** O re-snapshot é o
ÚLTIMO passo (passo 8), depois que todas as edições de classe estabilizaram, pra um único regen
verificável. **NOTA:** a previsão exata dos flips do badge no golden depende da resolução do bloqueador
de fundação — ver §"Bloqueador".

## Escopo (allowlist — os ÚNICOS arquivos que podem mudar + este plano)

`components/match-row.tsx` · `components/desktop-status-cell.tsx` ·
`components/upcoming-matches-desktop.tsx` · `components/upcoming-matches-mobile.tsx` ·
`components/date-range-tabs.tsx` · `components/league-tabs.tsx` · `components/recent-pred-card.tsx` ·
`components/skeletons/match-list-skeleton.tsx` + este plano (`docs/plans/PLAN-331.md`).

**Regenerado (snapshot muda, CÓDIGO de teste NÃO é editado à mão além do `-u`):**
`components/__tests__/odds-card-parity.golden.test.tsx`.

**NÃO tocar (consumir/referência):** `components/ui/*` (em especial `ui/badge.tsx`), `app/globals.css`,
`components/team-avatar.tsx` (hue 120/210 + chroma 0.04 + `font-size:7.92px` round-tripam EXATOS no
golden), `components/odds-card.tsx` (bloco OddsCard do golden linha 59, fora de escopo). **Cunhar token
novo é banido** (ADR 0029). **`lib/utils.ts` está FORA da allowlist** — qualquer fix de `extendTailwindMerge`
(ver bloqueador) é uma issue separada de fundação, não #331.

## Vocabulário herdado (referência rápida — NÃO cunhar nada)

Tipografia (font-size only, leading herda → swap byte-idêntico onde o px casa): `text-eyebrow-xs`(9)
`text-eyebrow`(10) `text-meta`(11) `text-body-sm`(12) `text-body`(13) `text-label`(14)
`text-display-sm`(18) `text-display-md`(26) `text-display-lg`(32). Tracking: `tracking-label`(0.14em,
eyebrow/badge mono uppercase), `tracking-eyebrow`(0.18em — **sem ocorrência neste slice**, ver nota).
`tracking-tight` (stock, banda negativa) e `tracking-wide`/`tracking-wider` **NÃO são redefinidos**
(reservados Tailwind; ADR §A.2 / Alternativa 4). Raio: `--radius`=0.625rem=10px → `rounded-sm`=6px,
`rounded-md`=8px, `rounded-lg`=10px, `rounded-xl`=14px. Sombra: `shadow-sm` stock. Foco visível:
`focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50` (+`rounded-sm` onde
couber). Todos os tokens citados confirmados presentes no `@theme` de `app/globals.css`.

> **Nota (token-fidelity lens):** o menu de swap da issue lista `0.18em`→`tracking-eyebrow`, mas **NÃO
> existe `tracking-[0.18em]` em nenhum dos 8 arquivos in-scope** (grep = 0 hits). É item de vocabulário,
> não ocorrência — o plano corretamente NÃO aplica nenhum mapeamento `tracking-eyebrow`. As únicas
> ocorrências `0.14em` (desktop:33, recent-pred:15) roteiam pra `tracking-label`, não `tracking-eyebrow`.

## Meios-pixels: convenção de rótulo

**byte-idêntico** = o px casa EXATO um degrau. **Colapso de meio-pixel** = o `.5` cai pro inteiro do
degrau, sancionado pela ADR §A.1: `15→label(14)` (scores, decisão 3), `12.5→body-sm(12)`,
`11.5→meta(11)`, `10.5→eyebrow(10)`, `9.5→eyebrow-xs(9)`. (A exceção do eixo Badge fica suspensa com o
bloqueador.)

## Decisões globais (cross-file) e micro-decisões resolvidas

### 1. ⛔ Badge hand-rolled → primitivo `Badge` (eixo `size`) — SUSPENSO pelo bloqueador de fundação

**Decisão original** (4 call-sites: `match-row.tsx:36` + `upcoming-matches-desktop.tsx:51` → `size="xs"`;
`desktop-status-cell.tsx:32` → `size="sm"`; `recent-pred-card.tsx:30,31` → `size="sm"`).

**O 4-lens review (golden/CLS lens) provou empiricamente, rodando `cn(badgeVariants({variant:'outline',
size:'xs'}), '… text-muted-foreground')` contra o repo real (lib/utils.ts usa `twMerge` vanilla, SEM
`extendTailwindMerge`):** o segmento de tamanho do Badge carrega `text-eyebrow` (10px), mas o `twMerge`
vanilla **não conhece** os tokens custom de font-size do `@theme` (`text-eyebrow`/`text-meta`/…) e os
**classifica como text-COLOR**. Logo, quando o consumer traz um `text-*` de cor (os QUATRO call-sites
do #331 trazem), o `twMerge` agrupa `text-eyebrow` com a cor e **descarta o `text-eyebrow`**, enquanto
o `text-xs` (12px) da base CVA **SOBREVIVE**. Resultado verificado: o badge renderiza a **12px**, não
10px — **regressão de +2.5px (9.5→12) / +2px (10→12)**, o OPOSTO do de-slop. Hoje os 4 badges
renderizam CERTO (9.5/10px) porque usam `text-[Npx]` arbitrário, que o `twMerge` SIM reconhece como
font-size e que corretamente strippa o `text-xs`.

**Confirmado já-LIVE no #322:** o badge `graduado` em `components/dashboard/market-segments.tsx:29-30`
(`size="xs"` + `text-edge-fg`) renderiza a 12px hoje — probe: `text-eyebrow present:false | text-xs
present:true`. É um defeito de fundação pré-existente, não introduzido pelo #331; o #331 só o
**espalharia** pro feed.

**Workaround "manter `text-eyebrow` explícito no consumer" NÃO funciona** (probado): com a cor depois,
`text-eyebrow` strippa; com `text-eyebrow` depois, o `twMerge` o trata como cor e ele **rouba** a cor
do consumer (badge perde a cor) e o `text-xs` ainda sobrevive. As duas ordens quebram.

**Fix correto:** registrar os tokens custom de font-size no grupo de font-size do `twMerge` via
`extendTailwindMerge` em `lib/utils.ts` (corrige TODOS os heirs + retroativamente o `graduado` do #322).
Isto está **FORA da allowlist do #331** e é uma **issue de fundação**. → **Decisão do owner pendente**
(ver §"Bloqueador de fundação"). Até lá: passo 1, Decisão 1 e os flips de badge no golden estão
SUSPENSOS. O `desktop-status-cell.tsx:32` e `recent-pred-card.tsx:30,31` (não-golden) também ficam
suspensos no eixo `size` pelo mesmo motivo.

### 2. Marcador 'analisado' `tracking-[0.06em]` (#99 paridade mobile/desktop) → **drop pra default**

`match-row.tsx:41` (mobile) e `desktop-status-cell.tsx:22` (desktop) têm spans 'analisado' **idênticos
hoje** (confirmado byte-a-byte): `font-mono text-[10px] tracking-[0.06em] text-accent-fg` (+`<Check
className="size-3" />`). O `text-[10px]`→`text-eyebrow` (byte-idêntico). O **`tracking-[0.06em]` NÃO
tem token** (0.06em < `tracking-label` 0.14em; não é a banda negativa do `tracking-tight`). **Decisão:
DROP pra default (remover a classe de tracking).** Justificativa: (a) é texto **mono, NÃO-uppercase,
minúsculo** ("analisado") — `tracking-label`(0.14em) mais que dobraria o spacing num papel errado
(label é mono uppercase); (b) `tracking-tight`(banda negativa) é pra display/títulos; (c) drop pro
default é a mudança **mínima** que mata o arbitrário. **CRÍTICO — paridade #99: os DOIS spans ficam
byte-consistentes** (mesma classe final `font-mono text-eyebrow text-accent-fg` nos dois arquivos),
migrados no MESMO passo (passo 3). NÃO está no golden (`ouMatch()` é scheduled + `hasPrediction:false`
→ ramo gated out), mas `match-row-finished-prediction.test.tsx` exige `toContain("analisado")`/
`toContain("encerrado")` verbatim nos dois → copy preservada → verde sem update. **Flag /impeccable:**
confirmar que "analisado" lê igual mobile vs desktop.

### 3. Tipografia/tracking — token swaps (scores + segmented-control incluídos)

Mapa completo por arquivo (todos byte-idêntico ou colapso de meio-pixel). `leading-*` explícito /
`font-mono` / `tabular-nums` / `font-medium` / `tracking-tight` / `tracking-wide` preservados.

- **`match-row.tsx`** (mobile):
  - `:47` kickoff `text-[11px]` → `text-meta`. **[golden]**
  - `:56,:62` nomes `text-[14px]` → `text-label` (×2, byte-idêntico; `tracking-tight` fica). **[golden]**
  - `:71` placar `text-[15px]` → `text-label` (decisão scores). (NÃO no golden — scheduled.)
  - `:76` 'encerrado'(c/ placar) `text-[9.5px]` → `text-eyebrow-xs`; `tracking-[0.08em]` → `tracking-label`.
  - `:83,:87` 'encerrado'/status(s/ placar) `text-[10.5px]` → `text-eyebrow`; `tracking-[0.08em]` →
    `tracking-label`.
  - `:91` odds `text-[12.5px]` → `text-body-sm`. **[golden]**
  - `:100` 'sem odd' `text-[10.5px]` → `text-eyebrow`.
- **`upcoming-matches-desktop.tsx`**:
  - `:33` header eyebrow `text-[10px]` → `text-eyebrow`; `tracking-[0.14em]` → `tracking-label` (exato). **[golden]**
  - `:55` kickoff `text-[11px]` → `text-meta`. **[golden]**
  - `:62,:66` nomes `text-[14px]` → `text-label` (×2). **[golden]**
  - `:69` coluna odds wrapper `text-[13px]` → `text-body` (byte-idêntico). **[golden]**
  - `:73` placar `text-[15px]` → `text-label` (decisão scores). (NÃO no golden.)
  - `:80,:84` status `text-[10.5px]` → `text-eyebrow`; `tracking-[0.08em]` → `tracking-label`.
- **`desktop-status-cell.tsx`**:
  - `:18` 'encerrado' `text-[10px]` → `text-eyebrow`; `tracking-[0.08em]` → `tracking-label`.
  - `:22` 'analisado' `text-[10px]` → `text-eyebrow`; `tracking-[0.06em]` → **drop** (decisão 2).
  - `:28` `—` (postponed/cancelled) `text-[10.5px]` → `text-eyebrow`. (NÃO no golden — `ouMatch()`
    scheduled cai no `:37`.)
  - `:37` `—` (último ramo, scheduled `hasPrediction:false`) `text-[10.5px]` → `text-eyebrow`. **[golden]**
    Confirmado: o golden Desktop renderiza `<span class="font-mono text-[10.5px] text-muted-fg-2">—</span>`
    da linha 37 → `:37` é o ÚNICO flip de DesktopStatusCell visível no snapshot.
- **`recent-pred-card.tsx`** (NÃO no golden):
  - `:15` eyebrow liga `text-[10px]` → `text-eyebrow`; `tracking-[0.14em]` → `tracking-label` (exato).
  - `:18` 'when' `text-[10px]` → `text-eyebrow`.
  - `:22` linha home/vs/away `text-[12.5px]` → `text-body-sm` (`tracking-tight` fica).
  - `:30,:31` badges → suspenso (decisão 1/bloqueador). `text-[10px]`/`tracking-wide` ficam como estão
    até a resolução do bloqueador.
  - `:37` edge `text-[11px]` → `text-meta` (`text-edge-fg` token canônico — preservar).
- **`date-range-tabs.tsx`** (segmented-control + inputs):
  - `:63` preset Link `text-[12px]` → `text-body-sm` (12==12, byte-idêntico). **[gap fechado pelo review]**
  - `:95,:109` inputs de data `text-[11.5px]` → `text-meta` (11.5→11, colapso). (Ver decisão 6 p/ ring + color-scheme.)
  - `:97` separador "–" `text-[11px]` → `text-meta`.
- **`league-tabs.tsx`** (segmented-control):
  - `:70` span desabilitado `text-[12px]` → `text-body-sm`. **[gap fechado pelo review]**
  - `:85` Link ativo `text-[12px]` → `text-body-sm`. **[gap fechado pelo review]**
- **`upcoming-matches-mobile.tsx`**: wrapper limpo, **zero arbitrário** (`Card`/`Button`/`MatchRow`).
  **Nada a tokenizar** — entrega base é zero-diff. `INITIAL_BATCH` **NÃO TOCAR** (lógica/fora de escopo).

> **GAP FECHADO (3 lentes apontaram):** o plano-draft omitia `text-[12px]`→`text-body-sm` em
> `date-range-tabs.tsx:63` + `league-tabs.tsx:70,85`. São byte-idênticos (12==12), não pinados por
> teste de classe (league-tabs.test.tsx pina só href/aria/labels), e seriam pegos pelo próprio
> grep-gate anti-resíduo do plano (3 hits residuais de `text-[12px]`). **Fold no MESMO passo das edições
> de raio/foco dessas linhas (passos 5-6).** `leading-7` e `font-medium` preservados verbatim.

**Decisão scores `text-[15px]` → `text-label`(14):** os placares de jogo encerrado (`match-row.tsx:71`,
`upcoming-matches-desktop.tsx:73`) usam 15px, sem degrau. **Colapsar pra `text-label`(14)**, NÃO
sancionar como outlier heroic-display. Justificativa: precedente direto **#322 decisão 4** + ADR §A.1
linha 77 (15px context-dependent: nav-row/corpo → `text-label`(14); heading 15px → display-sm(18)) —
o placar do feed é número-corpo `font-mono tabular-nums font-medium`, não número-herói (o privilégio
heroic-display `text-[22px]`/`text-[30px]` é reservado ao hero da match PAGE). Mobile+desktop colapsam
juntos no MESMO passo (sem lockstep cross-surface a temer). (NÃO no golden — `ouMatch()` scheduled →
verificado por grep + visual.) **Flag /impeccable:** placar a 14px ainda lê bem na coluna.

### 4. Raio e sombra

- **Raio `rounded-[5px]` → `rounded-sm`** (+1px, 5→6px): `date-range-tabs.tsx:63` (presets),
  `league-tabs.tsx:70` (span desabilitado) + `:85` (Link ativo). Espelha #322 §5.
- **Raio `rounded-[10px]` → `rounded-lg`** (10px EXATO): `recent-pred-card.tsx:12`.
- **Sombra `shadow-[0_1px_2px_rgb(0_0_0/0.4)]` → `shadow-sm`**: `date-range-tabs.tsx:65`,
  `league-tabs.tsx:87`. A ad-hoc foi calibrada só p/ dark (alpha 0.4) e quebra no light; `shadow-sm` é
  stock theme-neutral. Espelha #322 §5. **Flag /impeccable:** elevação da pill ativa em light E dark.

> **Nota:** `recent-pred-card.tsx:12` `min-w-[180px]` é arbitrário de LARGURA sem token (não há token
> de min-width de card) — **intencionalmente NÃO migrado** e o grep-gate não o casa (padrão só
> text/tracking/rounded/shadow). `size-[22px]` do TeamAvatar é prop-driven, geometria fixa — fica.

### 5. Focus rings (a11y, ADR §B / ADR:114)

Adicionar `focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50`
(+`rounded-sm` onde a forma comporta) nos `<Link>`/controles custom do feed sem ring. Receita = padrão
shadcn sancionado pela ADR:114 (precedente #322/#323). **Ordem de classe:** o repo usa as duas ordens
(`nav-link.tsx`: outline-none primeiro; `help-hint.tsx`: ring primeiro) — sem conflito de utilitário,
funcionalmente idêntico; usar a ordem do plano e hand-verificar verbatim no regen do golden.

- **`match-row.tsx:25`** row Link: +ring, **SEM `rounded-sm`** (faixa full-width num Card
  `overflow-hidden`; raio no foco recortaria). **[ATENÇÃO golden linha 66]** — o ring muda o byte;
  hand-verificar que entra exatamente a receita e nada mais.
- **`upcoming-matches-desktop.tsx:44`** row Link (template literal `… hover:bg-surface-2 ${…}`): +ring
  (sem `rounded-sm`). **[ATENÇÃO golden linha 73]** — inserir o ring ANTES do `${…}` preservando o
  trailing space do template (`hover:bg-surface-2 ` + ternário vazio gera trailing space no snapshot);
  hand-verificar o byte do `<a>`.
- **`date-range-tabs.tsx:63`** presets Link: +ring +`rounded-sm` no `cn(...)` **compartilhado** (1º arg,
  não no ramo `selected`-only — senão presets inativos ficam sem foco; análogo #322 dec.11).
- **`league-tabs.tsx:85`** Link ativo: +ring +`rounded-sm` no `cn(...)` (1º arg). O `<span
  aria-disabled>` (`:65,70`) **NÃO** ganha ring (sem href/tabIndex → não focável; comentado no código).
- **`recent-pred-card.tsx:12`** card Link: +ring, **sem `rounded-sm`** (segue o `rounded-lg` do card).

Verificados por grep + visual (date-range/league/recent não têm pin de classe); os de
match-row/desktop-row entram no re-snapshot.

### 6. `[color-scheme:dark]` → theme-aware + ring nos inputs de data (espelha `ui/select.tsx`/`market-select.tsx`)

`date-range-tabs.tsx:95` e `:109` (os dois `<input type="date">` nativos) têm `[color-scheme:dark]`
cravado → força calendário/spinner escuro mesmo no tema claro. **Trocar por `[color-scheme:light]
dark:[color-scheme:dark]`** — espelha verbatim `components/ui/select.tsx:22`.

> **MUDANÇA vs draft (a11y lens, blocker aceito):** o draft mantinha `outline-none` cru nos inputs e
> NÃO adicionava ring. **Decisão revista: adicionar o ring de foco completo nos dois inputs**, espelhando
> o precedente do REPO pros controles nativos — `components/ui/select.tsx:23` e
> `components/market-select.tsx:29` dão a `<select>`/input nativo a receita COMPLETA
> (`focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50` + `[color-scheme:light]
> dark:[color-scheme:dark]`), NÃO `outline-none` cru. A ADR 0029 linha 114 manda ring visível em TODO
> controle interativo, explicitamente "incluindo `<select>`/checkbox nativo". O `outline-none` cru é a
> própria slop que o épico mata; deferir um fix a11y mandado pela ADR num arquivo in-allowlist que já
> estamos editando é a escolha errada. **Receita final nos dois inputs:** `bg-transparent text-meta
> tabular-nums text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark]
> focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50` (mantém `outline-none`
> ao lado do ring, como o shadcn faz — o ring substitui o outline nativo). NÃO estão no golden →
> grep + visual. `:97` `text-[11px]` (separador "–") → `text-meta`. **Flag /impeccable:** abrir o
> date-picker nativo em tema claro E escuro + confirmar foco de teclado visível nos dois inputs.

### 7. `UPCOMING_GRID` const extraction (extract-to-const sancionado)

`upcoming-matches-desktop.tsx` repete `grid-cols-[160px_1fr_160px_140px_40px]` em **duas** linhas
(`:33` header, `:44` row) e o **skeleton desktop** (`match-list-skeleton.tsx:21`, via template literal)
uma terceira. Extrair `const UPCOMING_GRID = "grid-cols-[160px_1fr_160px_140px_40px]";`, **exportada**
de `upcoming-matches-desktop.tsx`; header e row consomem; o skeleton **importa e consome a MESMA const**
(decisão 8). Espelha `STANDINGS_GRID` (ADR:176-177). **Byte-invariante:** a string renderizada permanece
idêntica nos dois lugares do golden (header :33 + row :44) → **NO-OP no nível de byte** — hand-verificar.
Sem ciclo de import (skeleton importa `MatchRowSkeleton` de `match-row.tsx`, não de upcoming-desktop;
`upcoming-matches-desktop.tsx` é `"use client"` mas a const é string literal pura, consumível por server
component sem runtime client — `pnpm build`/`typecheck` pega qualquer problema de fronteira).

> **Nota (a11y/coerência lens, não-bloqueante):** a casa mais limpa pra um const de layout compartilhado
> seria um módulo `lib/` neutro, não um reach-into client component. Funciona como string literal; manter
> a exportação de upcoming-desktop (uma fonte da verdade) por simplicidade desta fatia.

### 8. CLS — skeletons em lockstep (anti-CLS; migra JUNTO com a linha viva)

A ADR 0029 deferiu a re-derivação das alturas de skeleton pra cavalgar a migração da linha viva. Os
pares EXATOS, no MESMO passo da linha viva:

**MOBILE — `MatchRowSkeleton` (`match-row.tsx:113-138`):** `117 h-[18px]` (liga), `118 h-[12px]`
(kickoff), `124/128 h-[14px]` (nomes), `132/133 h-[13px]` (odds). **Todas MANTIDAS** — os tokens
aplicados na linha viva têm a MESMA font-size renderizada (11=11, 14=14, 12.5→12 sub-pixel), e
`size="xs"` (se/quando adotado) mantém `h-[18px]`. **Nenhuma re-derivação mobile.** `123/127 size-[22px]`
(avatar, prop) fica.

**DESKTOP — `DesktopMatchListSkeleton` (`match-list-skeleton.tsx:15-51`):**
- `21 grid-cols-[…]` (template literal) → **consome `UPCOMING_GRID`** (decisão 7; byte-idêntico).
- `26 h-[18px]` / `27 h-[12px]` (badge + subline), `31/35 size-[22px]`, `32/36 h-[14px]`,
  `40/41 h-[13px]` → **todas MANTIDAS** (tokens preservam font-size; avatar é prop).
- **`44 h-[18px]` ⟷ pill 'analisado' desktop.** ⚠️ **GAP LATENTE de 2px:** skeleton usa `h-[18px]`,
  o pill vivo é `h-[20px]`. **Se/quando** a decisão 1 (Badge `size="sm"`=h-5=20px) for desbloqueada,
  re-derivar este box pra `h-5` (20px) no MESMO passo. **Importante (golden/CLS lens):** o bug do
  `twMerge` NÃO afeta o CLS — as alturas `h-[18px]`/`h-5` são reconhecidas pelo `twMerge` e funcionam;
  o box rastreia a altura do pill independente da font-size. Enquanto a decisão 1 estiver suspensa, este
  box fica em `h-[18px]` (estado atual) — sem mudança.

**Resumo do CLS:** a única mudança de altura de skeleton (`:44 h-[18px]`→`h-5`) está **acoplada à
decisão 1 suspensa**. Sem a decisão 1, **nenhuma altura de skeleton muda**. Os skeletons não estão no
golden; lockstep verificado por inspeção + `/impeccable` no estado de loading.

## Ordem de execução (passos, do menor risco pro maior)

> **Passo 1 está SUSPENSO** até a resolução do bloqueador de fundação. Os passos 2-8 são independentes
> e ready-to-implement. Quando o bloqueador resolver, o passo 1 (+ o box de skeleton `:44`→`h-5`) entra
> e o regen do golden incorpora os flips de badge.

1. **[SUSPENSO]** Badge size axis (4 call-sites) + `match-list-skeleton.tsx:44 h-[18px]`→`h-5`. Só
   após o `extendTailwindMerge` aterrissar em `lib/utils.ts` (issue de fundação) E re-probar que
   `size="xs"`/`"sm"` rendem 10px com cor presente.
2. **`UPCOMING_GRID` const extraction (mecânico, byte-no-op):** extrai+exporta de
   upcoming-desktop, header `:33` + row `:44` + skeleton `:21` consomem. Verificar zero ciclo.
3. **Marcador 'analisado' — drop do tracking, paridade #99 (os DOIS juntos):** `match-row.tsx:41` +
   `desktop-status-cell.tsx:22` `text-[10px]`→`text-eyebrow` + `tracking-[0.06em]` dropado. Byte-consistentes.
4. **Token swaps de tipo/tracking puros:** todo o mapa da decisão 3 (NÃO-Badge): match-row, upcoming-desktop,
   desktop-status-cell, recent-pred-card, **+ date-range:63/95/97/109, league:70/85** (os `text-[12px]` e
   `text-[11.5px]`/`text-[11px]`). Inclui scores 15→`text-label` e trackings `0.08em`→`tracking-label`.
5. **Foco visível (a11y):** rings em match-row:25 (sem raio), upcoming-desktop:44 (sem raio),
   date-range:63 (presets, `cn` compartilhado +`rounded-sm`), league:85 (Link ativo, `cn` +`rounded-sm`),
   recent-pred:12 (card, sem raio extra). **Fold os `text-[12px]`→`text-body-sm` de date-range:63 /
   league:70,85 aqui ou no passo 6** (mesmas linhas).
6. **Raio + sombra + color-scheme/ring dos inputs:** date-range:63(`rounded-sm`)/65(`shadow-sm`)/95,109
   (`color-scheme` theme-aware + ring + `text-meta`), league:70(`rounded-sm`)/85(`rounded-sm`)/87(`shadow-sm`),
   recent-pred:12(`rounded-lg`).
7. *(consolidado no passo 6.)*
8. **GOLDEN RITUAL — re-snapshot consciente (ÚLTIMO):** regen escopado + hand-verify.

## Golden ritual — re-snapshot consciente (load-bearing)

**Comando:** `npx vitest run components/__tests__/odds-card-parity.golden.test.tsx -u --no-file-parallelism`.
`-u` reescreve os literais `toMatchInlineSnapshot` (linhas 59/66/73) IN-PLACE; o path explícito escopa;
`--no-file-parallelism` evita flake pglite local.

**Após o regen — hand-verificar `git diff` (SÓ estes flips podem aparecer):**

*Bloco OddsCard (linha 59):* **ZERO diff** (fora de escopo; protegido ESTRUTURALMENTE — odds-card.tsx
não está na allowlist). Qualquer mudança = bug → reverter.

*Snapshot MatchRow (linha 66) — SEM a decisão 1 (badge suspenso):*
- `<a>` row: entra `focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50`
  (e NADA mais).
- kickoff `text-[11px]`→`text-meta`; nomes `text-[14px]`→`text-label` (×2, `tracking-tight` fica);
  odds wrapper `text-[12.5px]`→`text-body-sm`.
- **Liga Badge: SEM MUDANÇA** enquanto a decisão 1 estiver suspensa (continua `h-[18px] rounded-full
  px-2 text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground`).
- NÃO aparecem (fixture scheduled, `hasPrediction:false`): 'analisado'/'encerrado'/placar/status.

*Snapshot UpcomingMatchesDesktop (linha 73) — SEM a decisão 1:*
- grid (header + row): **NO-OP** (UPCOMING_GRID renderiza a MESMA literal) — confirmar.
- `<a>` row: entra o ring (cuidar do trailing space do template).
- header eyebrow `text-[10px]`→`text-eyebrow`, `tracking-[0.14em]`→`tracking-label`.
- **Liga Badge: SEM MUDANÇA** (decisão 1 suspensa).
- kickoff `text-[11px]`→`text-meta`; nomes `text-[14px]`→`text-label` (×2); odds wrapper `text-[13px]`→`text-body`.
- DesktopStatusCell `—` (scheduled, linha 37): `text-[10.5px]`→`text-eyebrow`.

> **Quando a decisão 1 for desbloqueada (pós-fix de fundação):** os flips de badge entram —
> hand-verificar contra o REGEN REAL probado (não contra previsão à mão), pois o byte do badge depende
> de como o `extendTailwindMerge` ajusta o dedup. NÃO congelar o snapshot enquanto o badge renderizar a
> 12px (isso freezaria a regressão no golden).

**Byte-invariantes que DEVEM round-tripar idênticos (qualquer diff = regressão):**
1. String CVA do shadcn Badge — invariante (não editamos `ui/badge.tsx`).
2. TeamAvatar inline style (`oklch(var(--ta-bg-l) 0.04 120/210)`, chroma 0.04, `font-size:7.92px`,
   `letter-spacing:-0.02em`) — byte-idêntico 2× por snapshot. **Protegido estruturalmente** (team-avatar.tsx
   fora da allowlist).
3. Bloco OddsCard inteiro (linha 59) — protegido estruturalmente.
4. `tracking-tight` nos nomes, tokens de cor, `bg-surface-2`, `border-border-subtle`, svg chevron
   (`size-3.5`), `href="/match/golden-1"`, ids Radix normalizados.

## Testes (auditados — re-snapshot SÓ no golden; os outros sem update)

- **`odds-card-parity.golden.test.tsx`** — re-snapshotado conscientemente (passo 8). Baseline GREEN
  (3/3) confirmado no `main` limpo.
- **`match-row-finished-prediction.test.tsx`** — `toContain("analisado")`/`toContain("encerrado")`
  (+ pin negativo). ZERO pin de classe. **Sem update.**
- **`upcoming-matches.test.tsx`** — `toContain("Carregar mais")` + scores/labels/odds; `countRows` via
  `href="/match/"` (ortogonal a classes). Zero classe. **Sem update.**
- **`league-tabs.test.tsx`** — href/aria-disabled/labels. Zero classe. **Sem update** (`text-[12px]`→
  `text-body-sm` não é pinado).
- **`lib/view/__tests__/match.test.tsx`** — `toMatchRowView` + copy. Zero classe. **Sem update.**
- **Inner loop por passo:** rodar as 5 suítes `--no-file-parallelism` após cada passo de classe (a golden
  fica vermelha até o passo 8; as outras 4 verdes o tempo todo). Após o passo 8, as 5 verdes.

## Verificação

Tríade + build, nesta ordem, TODAS verdes: `pnpm typecheck && pnpm lint && pnpm test
--no-file-parallelism && pnpm build`. Guardas extras:
- **Golden:** após o regen (passo 8), `git diff` do `.tsx` exibe SÓ os flips listados, com OddsCard/
  Badge-CVA/TeamAvatar byte-idênticos.
- **Grep anti-resíduo (GATE DE COMPLETUDE):** nos 8 arquivos in-scope pós-edit,
  `grep -E 'text-\[[0-9]|tracking-\[[0-9.]+em\]|rounded-\[[0-9]|shadow-\['` → **0 hits** (modulo
  `ring-[3px]` sancionado; `min-w-[180px]`/`size-[22px]` não casam o padrão). **Confirmar explicitamente
  por linha que date-range:63 / league:70 / league:85 (os `text-[12px]` antes esquecidos) estão limpos.**
  (Os badges hand-rolled ainda terão `text-[9.5px]`/`text-[10px]` enquanto a decisão 1 estiver suspensa —
  isto é esperado; o gate de 0 hits só vale pós-resolução do bloqueador OU se o owner re-escopar o badge
  pra fora desta fatia.)
- **Grep `color-scheme`:** `date-range-tabs.tsx` sem `[color-scheme:dark]` solto (só `[color-scheme:light]
  dark:[color-scheme:dark]`).
- **Grep CLS:** `match-list-skeleton.tsx` — confirmar nenhuma altura mudou (decisão 1 suspensa); quando
  desbloqueada, o único box re-derivado é `:44 h-5`.
- **Visual `/impeccable` (home session-gated → preview Vercel LOGADO, PATH PRIMÁRIO):** light/dark +
  mobile/desktop: (a) 'analisado'/'encerrado' paridade mobile/desktop (#99); (b) placar feed 14px; (c)
  date-picker nativo theme-aware + foco de teclado visível nos inputs (light E dark); (d) pill ativa do
  segmented-control +1px raio + shadow-sm em ambos os temas; (e) foco visível nos 5 Links custom + 2
  inputs de data; (f) skeleton de loading sem CLS; (g) Radix/animações sob `prefers-reduced-motion`
  (herdado #321); (h) segmented-control labels a 12px (body-sm) lendo bem. **Quando o badge desbloquear:**
  +verificar liga Badge sem estourar coluna + altura das pills. Diff apresentação-only.
- **Worktree guard:** confirmar checkout RAIZ (`main`, limpo), não cópia órfã em `.claude/worktrees/`.
- **"Fecha #331" PT-BR não auto-fecha** → fechar a issue manual após merge verde.

## Desvios conscientes do texto da issue

- **Marcador 'analisado' `tracking-[0.06em]` → drop pra default** (decisão 2), não `tracking-tight`:
  mono lowercase pequeno, nenhum token de tracking é o papel certo. Os dois spans byte-consistentes (#99).
- **Scores `text-[15px]` → `text-label`(14)**, NÃO heroic-display: ADR §A.1 linha 77 + #322 decisão 4.
- **`text-[12px]` do segmented-control → `text-body-sm`** (date-range:63, league:70,85): byte-idêntico;
  fechou o gap que 3 lentes do review pegaram.
- **`UPCOMING_GRID` exportado de upcoming-desktop e importado pelo skeleton** (uma fonte da verdade).
- **Inputs de data ganham focus ring** (decisão 6, revista vs draft): ADR 0029:114 + precedente
  `select.tsx`/`market-select.tsx` mandam ring em controle nativo; o `outline-none` cru é a slop a matar.
- **`upcoming-matches-mobile.tsx` zero-diff** (wrapper limpo); `INITIAL_BATCH` NÃO TOCAR.
- **Rings nos rows full-width SEM `rounded-sm`** (Card `overflow-hidden`); pills/Links com fundo próprio
  ganham `rounded-sm`; card de recentes segue `rounded-lg`.

## Fora de escopo (NÃO fazer)

Queries do feed, lógica de filtro/paginação (`INITIAL_BATCH`/`BATCH_STEP`/`RECENT_LIMIT`), rotas, auth.
Editar `ui/*` (incl. `ui/badge.tsx`), `app/globals.css`, `team-avatar.tsx`, `odds-card.tsx`,
**`lib/utils.ts`** (o fix de `extendTailwindMerge` é issue de fundação separada). Cunhar token. Editar o
CÓDIGO do golden à mão (só o `-u`). Mudar QUALQUER copy/dado. Tocar dashboard/entrada/match/admin/perfil/shell.

---

## ⛔ Bloqueador de fundação — decisão do owner pendente

**Problema (verificado empiricamente contra o repo):** o eixo `size` do `Badge` (`ui/badge.tsx:25-29`,
`sm`/`xs` carregam `text-eyebrow`) **não funciona** sob o `twMerge` vanilla de `lib/utils.ts` (sem
`extendTailwindMerge`). O `twMerge` não reconhece os tokens custom de font-size do `@theme`
(`text-eyebrow` etc.) e os classifica como text-COLOR. Quando o consumer traz um `text-*` de cor
(os 4 call-sites do #331 e o `graduado` já-shipado do #322 trazem), o `text-eyebrow` é descartado e o
`text-xs`(12px) da base CVA sobrevive → **o badge renderiza a 12px em vez de 9.5/10px** (regressão).
Probes confirmaram: `graduado` (#322) já está a 12px hoje; os 4 badges do feed renderizam CERTO hoje
SÓ porque usam `text-[Npx]` arbitrário (que o `twMerge` reconhece). Workarounds no consumer
(`text-eyebrow` explícito) não funcionam em nenhuma ordem.

**Por que não cabe no #331:** o fix correto é `extendTailwindMerge` em `lib/utils.ts` (registrar o grupo
de font-size custom), **fora da allowlist do #331**, e é um defeito de FUNDAÇÃO que afeta todos os heirs
do épico #320 (e retroativamente o #322). Adotar o eixo `size` no #331 sem o fix introduziria uma
regressão visível no feed.

**Decisão do owner (escolher um caminho):**
- **(A) Fix de fundação primeiro:** abrir issue (label `pos-pivot` + ADR-touch se necessário) pra
  `extendTailwindMerge` em `lib/utils.ts` registrando os tokens custom de font-size; aterrissar ANTES
  do #331; re-probar que `size="xs"/"sm"` rendem 10px COM cor; só então desbloquear a decisão 1 + o
  box de skeleton `:44`→`h-5` + os flips de badge no golden. Bônus: corrige o `graduado` do #322. **Recomendado.**
- **(B) Re-escopar #331 sem o eixo `size`:** manter os 4 badges hand-rolled, migrando só os
  `text-[Npx]`/`tracking-[Nem]`/`rounded`/`shadow` deles pra tokens arbitrários→nomeados onde houver
  degrau (mas o eixo `size` do Badge NÃO é adotado nesta fatia). Custo: contraria o objetivo de "consumir
  a primitiva" da fundação e o grep-gate continuaria vendo `text-[9.5px]`/`text-[10px]` nos badges (ou
  precisaria sancioná-los como exceção comentada). Menos limpo.

Os passos 2-8 deste plano (tudo exceto a decisão 1/passo 1) são independentes do bloqueador e podem ser
implementados imediatamente sob qualquer um dos caminhos.
