# PLAN-316 — `<PalpitesPanel/>` (UI capstone do arco de palpites)

Issue: **#316** — `feat(match-ui): <PalpitesPanel/> na região destacada + 'ver palpites anteriores' (/impeccable, pós-#246)`

> Snapshot histórico (ver `docs/plans/README`). Aterra no código real. Depende de
> **#314** (schema/query) e **#315** (gerador + auto-run + actions), AMBOS MERGED.
> **`/impeccable` é critério de saída** (plano E revisão das telas) + verificação no
> app real. Roda DEPOIS de #246 (já mergeado).

Design direction confirmada pelo dono via `/impeccable shape`: **"distinct warm lane"**
(identidade quente, inconfundível como o registro *playful*, distinta do cobalt do
motor de valor). Register `product`, **Committed-for-one-surface** (o momento de
delight que o PRODUCT.md reserva). Refs de design: `PRODUCT.md`, `DESIGN.md`, ADR 0029.

---

## 0. Não-negociáveis (ADR 0028 + #316 + de-slop)

1. **NUNCA** edge / stake / Yield / odds / `%` / EV / nome do modelo / custo de token / nada de `aiCall`. Palpite é predição, não recomendação de valor (`db/schema.ts` palpite_outcomes não tem `profitUnits`). É a linha mais dura — a razão de o painel ser visualmente distinto é o usuário NÃO ler como recomendação.
2. **"ver palpites anteriores" = lista PLANA sempre-visível**, NÃO colapsável. Divergir de `PreviousAnalyses`/`MatchCollapsible` (`components/match-collapsible.tsx`). Sem chevron, sem `defaultOpen`, sem estado open/close.
3. **Herdar tokens ADR 0029** — sem `text-[Npx]`, sem `rounded-[Npx]`, sem hex/cor nomeada crua, sem badge/card hand-rolled. Reusar `Badge`/`Button`/`Callout`. A ÚNICA adição ao token system é a família `--palpite-*` (§2), seguindo a convenção exata de `edge-*`/`warn-*`.
4. **Settleable honesty**: só `exact_score` ganha badge de estado que vira acertou/errou; `red_card`/`corners` ficam permanentemente "só por diversão / não liquidável". Pending ≠ fun (render distinto).
5. **Aditivo, nunca substitui** a análise. Senta entre o confronto e a pilha de análise, distinto mas sem desfazer o de-slop (#246/#320).
6. **Lógica em `lib/`** — mapper `lib/view/palpites.ts`; componente só apresenta (CLAUDE.md). Derivação de estado (pending/fun/won/lost) no mapper, não no JSX.
7. **NÃO re-adicionar `PalpiteAutoRun`** (já em `app/match/[id]/page.tsx:186`) e NÃO disparar async no render do Server Component; regen vai por `useActionState(regeneratePalpitesAction)` no leaf cliente.
8. **Ambos os branches ou nada** — mobile e desktop são subárvores CSS-toggled separadas; mudar um exige o outro.

---

## 1. Slot (verificado no código)

A página renderiza duas subárvores toggled por CSS (`lg:hidden` / `hidden lg:block`); **inserir o painel DUAS vezes**. Ambos `MobileMatch`/`DesktopMatch` já recebem `matchId`. `PalpiteAutoRun` já está montado (`page.tsx:186`) — não re-adicionar.

- **MOBILE** (`app/match/[id]/page.tsx` ~L306-310): dentro de `<div className="flex flex-col gap-3 px-5 pb-6">`, após os `OddsCard` (L307-308) e ANTES do bloco `{analyzable ? <AnalysisPanel…}`. Inserir `<PalpitesPanel matchId={matchId} />` como irmão (herda o `gap-3`).
- **DESKTOP** (`app/match/[id]/page.tsx` ~L382-395): odds vivem na coluna direita do `grid grid-cols-[1fr_320px]`; AnalysisPanel vive num `<div className="pb-6">` ABAIXO do grid. Inserir o painel full-width APÓS o grid fechar e ANTES do `<div className="pb-6">` (espelhar o spacing).

> Verificar as linhas exatas na implementação (a página tem ~439 linhas; âncoras podem ter drift). A LÓGICA do slot é a da ADR 0028: mobile após odds no flex `gap-3`; desktop após o grid, antes do wrapper `pb-6` da análise.

---

## 2. Token — família `--palpite-*` (warm, ADR 0029 convention)

Adicionar em `app/globals.css`, espelhando o tripé de `edge-*` (`:139-142`) e `warn-*` (`:144-147`). Hue quente ~40 (terracotta/coral) — distinto de cobalt (258), edge-green (145), warn-amber (55). Em `:root` E `.dark`, e os aliases em `@theme inline`.

```css
/* :root — Palpite — warm terracotta (engajamento, hue ~40). Identidade do
   domínio de palpites, paralela ao edge-* do domínio de valor. */
--palpite-fg: oklch(0.52 0.16 40);         /* texto/glyph sobre tint claro */
--palpite-strong-fg: oklch(0.45 0.18 40);  /* texto do chip (contraste ≥4.5) */
--palpite-soft: oklch(0.96 0.045 40);      /* tint do chip / fundo sutil */
--palpite-border: oklch(0.84 0.09 40);     /* ring / borda */
```

```css
/* @theme inline */
--color-palpite-fg: var(--palpite-fg);
--color-palpite-strong-fg: var(--palpite-strong-fg);
--color-palpite-soft: var(--palpite-soft);
--color-palpite-border: var(--palpite-border);
```

Dark mode (`.dark`): mesma hue, L invertido (fg mais claro ~0.72, soft escuro ~0.26, border ~0.40) — **calibrar contraste no browser** (verificação `/impeccable audit`). NÃO usar `warn-*` (colide com o `Callout warn` do estado de erro) nem `chart-1` cru (sem tripé, contraste fino). **Settled state continua na família `form-*`** (won → `form-win`, lost → `form-loss`) — settlement lê consistente com o resto do app; a identidade quente é do PAINEL, não do resultado.

---

## 3. View-model — `lib/view/palpites.ts` (novo)

`getPalpiteSetsForMatch(matchId, userId)` retorna `PalpiteSetWithLines[]` (`lib/db/queries/palpites.ts`): `{ palpiteSet, aiCall, palpites: (DbPalpite & { outcome: {result:"won"|"lost"}|null })[] }`. Adicionar `toPalpitesView` (padrão de `lib/view/analysis.ts`):

```ts
type PalpiteLineView = {
  id: string;
  type: "exact_score" | "red_card" | "corners";
  typeLabel: string;            // "placar exato" | "cartão vermelho" | "escanteios"
  text: string;                 // a frase, verbatim (≤280)
  state:
    | { kind: "fun" }                                  // settleable=false
    | { kind: "pending" }                              // exact_score, sem outcome
    | { kind: "settled"; result: "won" | "lost" };     // exact_score liquidado
};
type PalpiteSetView = { id: string; generatedAt: Date; lines: PalpiteLineView[] };
type PalpitesView = { current: PalpiteSetView | null; previous: PalpiteSetView[] };
```

- `current = sets[0]`, `previous = sets.slice(1)` (a query já ordena newest-first).
- **NUNCA** mapear nada de `aiCall` (custo/modelo/tokens) pro view. O `aiCall` existe no retorno da query mas o mapper o DESCARTA.
- Derivação de `state` AQUI, não no JSX.

---

## 4. Árvore de componentes (`components/palpites/`)

Server Components por padrão; `"use client"` só onde há estado.

```
PalpitesPanel (server)            components/palpites/palpites-panel.tsx
│  props: { matchId }
│  • auth() → userId; getPalpiteSetsForMatch → toPalpitesView
│  • shell: warm ring (palpite-border) + header chip + glyph (lucide Dices)
│  • branch nos estados (§5)
├─ PalpiteRow (server)            components/palpites/palpite-row.tsx
│     frase (text-body) + TypeBadge + (SettleableBadge | NonSettleableTag)
├─ TypeBadge (server)             Badge size=xs — "placar exato"/"cartão vermelho"/"escanteios"
├─ SettleableBadge (server)       exact_score: pending → "aguardando placar" (neutro);
│                                 won → "acertou" (form-win); lost → "errou" (form-loss)
├─ NonSettleableTag (server)      red_card/corners: muted "só por diversão"
├─ RegenButton ("use client")     components/palpites/regen-button.tsx
│     useActionState(regeneratePalpitesAction); pending → spinner + disabled (cards ficam);
│     union: rate → "limite atingido, tente mais tarde"; not_found/generation_error →
│     "não consegui gerar agora" (Callout warn, discreto, inline)
└─ PreviousPalpites (server)      components/palpites/previous-palpites.tsx
      lista PLANA de previous[], cada set com eyebrow muted (tempo relativo),
      register quieter (surface-2), separados por border-t border-border-subtle.
      SEM colapsável. (Se crescer muito: "ver mais" client useState count — só
      append de linhas planas, nunca expand/collapse. Enviar lista plana primeiro.)
```

`RegenButton` é o ÚNICO `"use client"`. Glyph: lucide `Dices` (lê "fun", não "value"; BestBetCard usa `Sparkles` no lado valor — divergir).

---

## 5. Estados (cada um renderiza)

| Estado | Condição | Render |
|---|---|---|
| **empty** | `current === null` | Dentro do shell quente: linha muted "ainda sem palpites pra esse jogo" + Button "gerar novos palpites". Sem spinner (auto-run é fire-and-forget). |
| **loading (auto-run)** | 1ª carga, set ainda não persistido | SEM UI de loading dedicada (auto-run silencioso; `revalidatePath` injeta o set no próximo render). Opcional: skeleton sutil no corpo, nunca bloqueante. |
| **populated** | `current` tem linhas | Header + as PalpiteRows. exact_score → SettleableBadge (pending). fun → NonSettleableTag. RegenButton no rodapé. "ver anteriores" se `previous.length>0`. |
| **regen pending** | `RegenButton` pending | Button disabled + spinner; cards atuais ficam visíveis (otimista, não-bloqueante). |
| **error (regen)** | `regen → {ok:false}` | `Callout variant="warn"` discreto, pequeno (rate / generation_error). Nunca full-bleed. |
| **error (auto-run)** | silent-fail | Renderiza = **empty** (auto-run engole o erro; real vive em `ai_calls`). Button é a recuperação. |
| **finished game** | jogo liquidado | SettleableBadge resolve won ("acertou", form-win) / lost ("errou", form-loss). fun continuam NonSettleableTag. Outcome é data-driven (mesmo render em analyzable=true/false). |

A11y: estado settled não depende só de cor — par tint `form-*` + palavra ("acertou"/"errou") (+ ícone opcional). `focus-visible` nos interativos (baked nas primitivas). `prefers-reduced-motion` global.

---

## 6. Interação + motion

- **gerar novos**: `RegenButton` → `regeneratePalpitesAction` via `useActionState`; pending → spinner; sucesso → `revalidatePath` troca o set; erro → Callout inline.
- **ver anteriores**: zero interação (lista plana sempre-visível). Sem toggle.
- **Motion** (product register, 150-250ms, conveys state): entrada sutil das rows do set atual (stagger leve opcional, degrada com `prefers-reduced-motion`); spinner no regen. Nada decorativo. Sem orquestração de page-load.

---

## 7. Implementação — sequência de commits pequenos

Branch de `origin/main`. Worktree isolado (sessão paralela ativa).

1. **`feat(ui): token family --palpite-* (warm) + view-model toPalpitesView`** — §2 (`globals.css` :root/.dark/@theme) + §3 (`lib/view/palpites.ts` + tipos). `pnpm typecheck`.
2. **`feat(ui): <PalpitesPanel/> + subcomponentes (rows, badges, regen, previous)`** — §4, todos os estados §5. `RegenButton` client com `useActionState`.
3. **`feat(match-ui): montar <PalpitesPanel/> nos dois branches da página`** — §1 (mobile + desktop).
4. **`test(ui): toPalpitesView (mapper) + estados do painel`** — testes do mapper (derivação fun/pending/won/lost; descarta aiCall) + render dos estados (RTL se o repo usa; senão, testes do mapper + smoke).

Gate de cada PR: `pnpm typecheck && pnpm lint && pnpm test --no-file-parallelism && pnpm build` verdes.

---

## 8. Revisão `/impeccable` + verificação no app real (critério de saída)

**Inegociável**: depois de construir, rodar `/impeccable audit` + `critique`/`polish` nas telas (a11y/contraste/responsivo/slop) e **verificar no app real** via dev server + Playwright:
- jogo COM palpite (populated) — mobile + desktop.
- jogo SEM palpite (empty / auto-run em voo).
- regen (loading → novo set; e um erro discreto).
- "ver anteriores" (≥2 sets) — lista plana.
- jogo encerrado (settleable acertou/errou).
- Contraste do `--palpite-*` (light + dark) ≥4.5:1 no texto; screenshots.

Corrigir o que o audit/critique apontar ANTES do merge. O `/impeccable` é parte do critério, não "se sobrar tempo".

---

## 9. Critério de saída (#316)

- [ ] `<PalpitesPanel/>` montado nos DOIS branches; nunca edge/stake/Yield/odds/%.
- [ ] Badge acertou/errou (form-*) nos settleable; fun marcados não-liquidáveis.
- [ ] "gerar novos" (regen) + "ver anteriores" lista PLANA (não colapsável).
- [ ] Todos os estados (empty/loading/regen/erro/encerrado) explícitos.
- [ ] Família `--palpite-*` on-system (light+dark), contraste verificado; lógica em `lib/view/palpites.ts`.
- [ ] `/impeccable` aplicado no plano E na revisão; verificado no app real (screenshots).
- [ ] `pnpm typecheck`+`lint`+`test`+`build` + checks de CI verdes.
