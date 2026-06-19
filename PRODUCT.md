# Product

## Register

product

## Users

Solo owner first (personal use), plus a small circle of invited friends in Fase 2 (magic-link auth). Brazilian football fans who follow the Brasileirão / Champions / Copa. Context of use: checking a specific match before kickoff — they want a fast read on where the value is **and** a fun, opinionated take on the game. Mobile-first (phone, on the couch / at the bar), desktop secondary.

## Product Purpose

**Palpiteiro** uses an LLM as a multi-market **edge-selection engine** (1X2, over/under, BTTS, double chance, …): given a match + candidate markets, it emits one disciplined recommendation per analysis (market + selection + line + stake) or `pass`, always with rationale and Yield segmented by market. Alongside that serious value engine, it gives **palpites** — fun, chamativo engagement predictions ("vai dar 3 a 1 pra Alemanha", "1 cartão vermelho", "10 escanteios") that reconnect the app with its name. Success = the owner trusts the value calls AND enjoys opening a match page. It's a side project: personal use + learning to build with AI.

## Brand Personality

Opinionated, sharp, Brazilian-football-literate. Three words: **confident, playful, honest**. The value side speaks with quiet analyst discipline (numbers earn their place, never hype); the palpites side speaks like a friend with a hot take (personality, a wink), but never lies about its own track record. "Palpiteiro" itself is affectionate Brazilian slang for someone who can't resist giving their guess. The product is a knowledgeable friend, not a tipster hawking locks.

## Anti-references

- **Casino / sportsbook loudness** — neon greens, gold coins, "🔥 LOCK OF THE DAY", flashing odds, urgency timers. The app must never feel like it's selling gambling.
- **Generic SaaS-dashboard cream** — the warm near-white "AI workflow tool" aesthetic, hero-metric templates, identical card grids.
- **Tipster Telegram-channel slop** — screenshot-y, emoji-stuffed, unaccountable.
- The palpites panel specifically must NOT read as a value recommendation — no edge/odds/% language anywhere on it.

## Design Principles

1. **Two registers, one home.** The value engine looks disciplined (restraint, numbers that earn their place); palpites look playful (personality, a touch of accent). They neighbor without blurring — a reader must never confuse a fun guess for a staked value call.
2. **Honesty over hype.** Show the track record, settle what can be settled, mark what can't. Never fabricate a number to look more confident (mirrors the data discipline: prefer a visible "pending" over a plausible-but-wrong result).
3. **Mobile is the real product.** Design for the phone first; desktop is the courtesy.
4. **Inherit, don't reinvent.** The de-slop foundation (ADR 0029 tokens, shadcn primitives) is the source of truth; new surfaces compose it, never coin new tokens or hand-roll badges.
5. **Calm by default, accent on purpose.** Color and emphasis are spent deliberately — the eye should land where the decision is.

## Accessibility & Inclusion

WCAG AA: body text ≥4.5:1, large text ≥3:1 (verify any tinted-surface text). Full keyboard reach with visible `focus-visible` rings (baked into the primitives). `prefers-reduced-motion` honored globally — every animation degrades to a crossfade/instant. Settled state (won/lost) must not rely on color alone — pair the form-win/loss tint with a word ("acertou"/"errou") and/or icon. Dark mode is first-class (full `.dark` token set).
