# Design

Visual system of Palpiteiro. Source of truth = `app/globals.css` (`@theme` + `:root`/`.dark`), ADR 0029 (`docs/decisions/0029-…`) and its amendment ADR 0056 (`docs/decisions/0056-…`: 11px floor, mono only for numbers, screen vocabulary). Tailwind v4, shadcn/ui, OKLCH throughout, first-class dark mode. **Do not coin new tokens or hand-roll badges/cards — compose what's here.**

## Theme

Light and dark, both first-class. Neutral-forward product surface (chroma-0 grays) with a small number of semantic color families spent deliberately. Calm by default; color marks the decision. Radius base `--radius: 0.625rem` → `rounded-sm/md/lg/xl`.

## Color palette (OKLCH, `app/globals.css`)

**Neutrals (the surface):** `background`/`foreground`, `card`, `surface-2` (0.97), `surface-3` (0.94), `border` / `border-subtle` (0.94) / `border-strong` (0.78), `muted-foreground` (0.45) / `muted-fg-2` (light 0.52, dark 0.62). The disciplined register. **`muted-fg-2` only on text ≥12px (or icons)** — never on `text-meta`, never on a solid `*-soft`/`surface-3` fill (use `muted-foreground` there; ADR 0056 has the contrast table).

**Cobalt — `accent-*` (hue 258):** `accent-fg` (0.42), `accent-strong-fg` (0.36), `accent-soft` (0.96/0.03), `accent-border` (0.85/0.06). The app's **identity / prominence** accent (also `--primary` and `--ring`). Used for highlighted regions and primary emphasis.

**Leaf green — `edge-*` (hue 145):** `edge-fg`/`edge-soft`/`edge-border`. **Semantic for the value engine's edge** — reserve for value/edge surfaces; do NOT borrow it for unrelated emphasis.

**Amber — `warn-*` (hue 55):** `warn-fg`/`warn-soft`/`warn-border`. Cautions, soft warnings (the `Callout variant="warn"`).

**Form W/D/L — `form-{win,loss,draw}-{bg,fg}`:** win green (145), loss red (25), draw neutral. The settled-state language: `components/result-badge.tsx` (`ResultBadge`, the one result seal) and `components/form-dot.tsx` (V/E/D form) — never hand-roll a won/lost/pending badge.

**Data-viz — `chart-1..5`:** warm orange→amber→teal ramp, available as `bg-chart-N`/`text-chart-N` (build-time `@theme inline`; for runtime `var()` use raw `var(--chart-N)`, not the `--color-` alias — known gotcha).

`destructive` for hard errors. Verify ≥4.5:1 body contrast on any tinted surface.

## Typography (ADR 0029 scale, amended by ADR 0056 — `@theme`)

`font-sans` = Geist Sans, `font-mono` = Geist Mono. **Mono only for numbers** (odd, score, %, units, date/time, counts), always with `tabular-nums`; labels/eyebrows are sans (uppercase + `tracking-label`/`tracking-eyebrow`). Raw code (`<pre>`/`<code>`) stays mono. **font-size tokens (px, line-height inherits), floor 11px:** `text-meta` 11 · `text-body-sm` 12 · `text-body` 13 · `text-label` 14 · `text-display-sm` 18 · `text-display-xs` 22 · `text-display-md` 26 · `text-display-lg` 32 · `text-display-xl` 40. **Tracking:** `tracking-label` 0.14em + `tracking-eyebrow` 0.18em (uppercase labels); Tailwind's negative band (`tracking-tight`) stays. **Never** `text-[Npx]` or raw tracking — use the tokens (a `cn()`/twMerge custom-token gotcha exists; see `lib/utils.ts`). Guarded by `components/__tests__/design-scale-guard.test.ts`. No exceptions: the `TeamAvatar` monogram also respects the floor (see Teams).

**Screen vocabulary:** the screen says "Sem aposta", "retorno", "taxa de acerto", "jogos sem aposta", "vantagem … pontos", "Total de gols · Mais de 2,5", and results "Acertou / Errou / Devolvida / Anulada / Em aberto". Translation lives in the view layer (`lib/view/markets/display.ts`, `lib/view/result-state.ts`); prompts, seed and `presentation.ts` keep the canonical terms (ADR 0056). Admin keeps technical terms.

## Teams

Canonical team names (`matches.home_team`/`away_team`, `CANONICAL_TEAMS`) are matching keys and never change on screen paths that feed the model, odds, settlement or routes. Display goes through `lib/view/team.ts` (`teamToTeam` / `teamPair`) and `lib/view/team-labels.ts`: **short display name** (`Team.name`, e.g. "Palmeiras", "Atlético de Madrid", "PSG"; World Cup in PT-BR) on every user screen, the **official name** (`Team.fullName`) only in `title`; the **3-letter code** (`Team.short`, e.g. ATM/ATH) where the column is narrow, unique per match (`teamPair` breaks ties). **Crest** via `components/team-crest.tsx` (`TeamCrest`): World Cup flag first, then the provider crest (`Team.crestUrl`, only `media(-N).api-sports.io/football/teams/*` or `crests.football-data.org`, filtered by `safeCrestUrl`), then the monogram. The monogram never goes below 11px: when the code does not fit the circle at 11px it renders the color only (no letters). Never a bookmaker or league logo.

## Components (shadcn primitives — `components/ui/`)

`Badge` (size axis incl. `xs`/`sm` from the de-slop), `Button` (variants default/secondary/ghost/link/outline; sizes incl. `sm`/`xs`), `Callout` (info/warn — discreet inline notices), `Card` family, `Separator`. Exemplars to mirror: **highlighted region** → soft accent fill + `ring-2 ring-accent-fg/40` + sans eyebrow chip (uppercase `tracking-eyebrow`; mono only on numbers, ADR 0056) + lucide icon (the sanctioned "stand out without breaking hierarchy"); **settled state** → `components/result-badge.tsx` (`ResultBadge`, always with the word); **page header** → `components/page-header.tsx` (`PageHeader` + `PageHeaderSkeleton` for `loading.tsx`) inside `components/page-container.tsx` (`PageContainer width="content" | "reading"`) on every logged-in user page (admin keeps `components/admin/page-heading.tsx`); **collapsible history** → `components/match-collapsible.tsx` (used by `PreviousAnalyses`/#204). Interactive elements carry `focus-visible:ring-[3px] ring-ring/50` (baked in).

## Layout & motion

Mobile-first; the match page is **one responsive tree** (`lg:` variants inside each block, same order at every width; #576) — no `lg:hidden`/`hidden lg:block` duplicate subtrees in its `page.tsx`/`loading.tsx` (guarded by `app/(app)/match/[id]/__tests__/single-tree.test.ts`). The only CSS toggle left there is inside `components/bet-slip.tsx` (the Suas apostas panel beside the grid on desktop × bottom bar + sheet on mobile, one state). `/jogos` and `/time` still render mobile and desktop list subtrees. Responsibility notices on the match page: one per visible screen (ADR 0057). Named width tokens: `container-content` 1040 / `aside` 320 / `narrow` 480 / `reading` 640 / `form` 380. Pages use two widths via `PageContainer` (`content` for lists/dashboards, `reading` for everything else) with one gutter (`px-5`, `lg:px-8`); the bled mobile lists of `/jogos` and `/time` keep per-block `px-5`. Flex for 1D, grid for 2D. Motion is intentional and minimal; `prefers-reduced-motion` handled globally (`globals.css`) — entrances degrade to crossfade/instant automatically. No bounce/elastic; ease-out curves.
