# Design

Visual system of Palpiteiro. Source of truth = `app/globals.css` (`@theme` + `:root`/`.dark`) and ADR 0029 (`docs/decisions/0029-…`). Tailwind v4, shadcn/ui, OKLCH throughout, first-class dark mode. **Do not coin new tokens or hand-roll badges/cards — compose what's here.**

## Theme

Light and dark, both first-class. Neutral-forward product surface (chroma-0 grays) with a small number of semantic color families spent deliberately. Calm by default; color marks the decision. Radius base `--radius: 0.625rem` → `rounded-sm/md/lg/xl`.

## Color palette (OKLCH, `app/globals.css`)

**Neutrals (the surface):** `background`/`foreground`, `card`, `surface-2` (0.97), `surface-3` (0.94), `border` / `border-subtle` (0.94) / `border-strong` (0.78), `muted-foreground` (0.45) / `muted-fg-2` (0.55). The disciplined register.

**Cobalt — `accent-*` (hue 258):** `accent-fg` (0.42), `accent-strong-fg` (0.36), `accent-soft` (0.96/0.03), `accent-border` (0.85/0.06). The app's **identity / prominence** accent (also `--primary` and `--ring`). Used for highlighted regions and primary emphasis.

**Leaf green — `edge-*` (hue 145):** `edge-fg`/`edge-soft`/`edge-border`. **Semantic for the value engine's edge** — reserve for value/edge surfaces; do NOT borrow it for unrelated emphasis.

**Amber — `warn-*` (hue 55):** `warn-fg`/`warn-soft`/`warn-border`. Cautions, soft warnings (the `Callout variant="warn"`).

**Form W/D/L — `form-{win,loss,draw}-{bg,fg}`:** win green (145), loss red (25), draw neutral. The settled-state language (see `components/form-dot.tsx`) — reuse for any won/lost/pending-result badge so settlement reads consistently.

**Data-viz — `chart-1..5`:** warm orange→amber→teal ramp, available as `bg-chart-N`/`text-chart-N` (build-time `@theme inline`; for runtime `var()` use raw `var(--chart-N)`, not the `--color-` alias — known gotcha).

`destructive` for hard errors. Verify ≥4.5:1 body contrast on any tinted surface.

## Typography (ADR 0029 scale — `@theme`)

`font-sans` = Geist Sans, `font-mono` = Geist Mono (mono carries labels/eyebrows/numerics). **font-size tokens (px, line-height inherits):** `text-eyebrow-xs` 9 · `text-eyebrow` 10 · `text-meta` 11 · `text-body-sm` 12 · `text-body` 13 · `text-label` 14 · `text-display-sm` 18 · `text-display-md` 26 · `text-display-lg` 32. **Tracking:** `tracking-label` 0.14em + `tracking-eyebrow` 0.18em (mono uppercase chips/headers); Tailwind's negative band (`tracking-tight`) stays. **Never** `text-[Npx]` or raw tracking — use the tokens (a `cn()`/twMerge custom-token gotcha exists; see `lib/utils.ts`).

## Components (shadcn primitives — `components/ui/`)

`Badge` (size axis incl. `xs`/`sm` from the de-slop), `Button` (variants default/secondary/ghost/link/outline; sizes incl. `sm`/`xs`), `Callout` (info/warn — discreet inline notices), `Card` family, `Separator`. Exemplars to mirror: **highlighted region** → `components/best-bet-results.tsx` `BestBetCard` (soft accent fill + `ring-2 ring-accent-fg/40` + mono eyebrow chip + lucide icon — the sanctioned "stand out without breaking hierarchy"); **settled state** → `components/form-dot.tsx`; **collapsible history** → `components/match-collapsible.tsx` (used by `PreviousAnalyses`/#204). Interactive elements carry `focus-visible:ring-[3px] ring-ring/50` (baked in).

## Layout & motion

Mobile-first; the match page renders two CSS-toggled subtrees (`lg:hidden` mobile / `hidden lg:block` desktop) — a change to one needs the matching change to the other. Named width tokens: `container-content` 1040 / `aside` 320 / `narrow` 480 / `reading` 640 / `form` 380. Flex for 1D, grid for 2D. Motion is intentional and minimal; `prefers-reduced-motion` handled globally (`globals.css`) — entrances degrade to crossfade/instant automatically. No bounce/elastic; ease-out curves.
