# PLAN — #246: de-slop visual da match page (fatia 2 · referência viva)

> Plano de implementação (artefato histórico, snapshot 2026-06-18). Fatia 2 do épico **#320**.
> Adota os tokens/primitivas da fundação #321 (MERGED). Derivado de exploração + síntese +
> review adversarial (4 lentes, todas `approve-with-changes`, escopo limpo no boundary de arquivo).
> **Match-page-only.** Registra as decisões finais com os ajustes do review.

## Princípio
Só apresentação, zero mudança funcional, **paridade de dados** (odds, recomendação, cenários)
preservada, sem regressão. Conduzido via `/impeccable`. **#246 é a referência viva**: onde a tela
diverge da ADR 0029, #246 ganha e a ADR é atualizada (doc-only aqui — sem novo token).

## Decisões finais (ajustes do review folded in)

- **Outliers 22px/30px — política única: MANTER como `text-[22px]`/`text-[30px]` arbitrários
  in-file, com comentário; NÃO adicionar token nem tocar `globals.css`** (foundation = #321,
  evita pré-empt dos heirs). Locais: `odds-card.tsx` (odd value), hero desktop (nome `lg:text-[22px]`,
  placar `lg:text-[30px]`, "vs" `lg:text-[22px]`). **ADR 0029 ganha uma nota doc-only** de exceções
  da match-tela (não um token). Score mobile 28→`display-md`(26). (Resolve a contradição
  interna do plano: manter outlier ⇒ NÃO add token.)
- **`tracking-[0.12em]` → `tracking-label`(0.14em)** é mudança de valor real (0.12→0.14), não
  rename. Adotar deliberadamente (0.14 é o tracking de eyebrow dominante da ADR) em TODA a tela;
  editar o golden conscientemente.
- **Gaps de micro-tier preservados**: badge `9.5→text-eyebrow-xs`(9); caption/pct `10.5→text-eyebrow`(10);
  section-label `10.5→text-eyebrow`(10). Não achatar tiers adjacentes no card de odds.
- **market-run-summary**: Callout colore só o ÍCONE por variante, NÃO o título → passar
  `variant="warn"` + ícone warn + título como nó `text-warn-fg` (não o prop `title` cru), pra
  preservar o cue de aviso.
- **"Odds indisponíveis"** → `<Callout variant="info">` (estado pré-mercado esperado, calmo —
  não é erro).
- **EmptyState aninhado** em seções/collapsibles → passar `className="py-6"` (evita o py-12
  shell-grade); o bump 12→14 do título é aceito como padrão de de-slop.
- **loading.tsx HeroSkeleton** deve acompanhar o hero unificado (senão CLS) — atualizar no passo do hero.
- **page.tsx hero**: manter o wrapper `grid-cols-[1fr_320px]` (L378) + a célula direita de odds
  (L448-451); substituir SÓ o div do hero esquerdo (L379-446) por `<MatchHero/>`.
- **Hero deltas conscientes**: desktop ganha pill LIVE (aditivo, raro); countdown guardado
  `lg:hidden` (sob placar) / `hidden lg:inline` (header) pra cada viewport mostrar onde mostra hoje;
  `lg:text-[22px]`/`lg:text-[30px]` preservam o tamanho desktop.

## Ordem de execução (11 passos)
1. **Token swaps mecânicos** (leaf, sem golden): analysis-scenarios, match-collapsible,
   section-footer-dispatch, previous-analyses, best-bet-results, new-analysis-form,
   match/[id]/loading.tsx (label), match/[id]/not-found.tsx (+ max-w-narrow).
2. **Selects/checkbox a11y**: market-multi-select, model-override-select, market-select —
   focus-visible ring (espelha ui/select.tsx) + tokens. (reduced-motion já vem do bloco global #321.)
3. **EmptyState** (raw divs) + tokens dos ramos populados: form-section, h2h-section (ambos os
   ramos do ternário!), standings-section, match-sections-auxiliary (3 instâncias).
4. **Callout** (4 avisos): analysis-error-card, match/[id]/error.tsx, market-run-summary (título
   warn-fg via nó + ícone), odds-card !view ("Odds indisponíveis" variant=info).
5. **odds-card with-view** (GOLDEN-GATED): tokens; manter `text-[22px]` (outlier); regenerar golden
   verificando diff = só renames + snaps intencionais (9.5→9, 0.12→0.14) + MatchRow/Desktop intactos.
6. **analysis-result**: hierarchy fix (PASS `text-[36px]`→`display-sm`; recomendação `text-[28px]`
   →`display-md`) + bullets hand-built→lucide + tokens.
7. **analyze-cta**: glifos ✓/▸/·→lucide (Check/ChevronRight/Circle) + tokens + atualizar test pinado (✓).
8. **analysis-scenarios**: `min-[480px]:`→`sm:` + atualizar test pinado (min-[480px]→sm).
9. **standings-section**: extrair `grid-cols-[20px_1fr_36px_36px_44px]`→const `STANDINGS_GRID`.
10. **Hero de-dup**: match-hero responsivo (mobile base + lg:) ; deletar bloco inline desktop
    (page.tsx:379-446), renderizar `<MatchHero/>` na célula esquerda; atualizar HeroSkeleton do
    loading.tsx; migrar labels sobreviventes do page.tsx.
11. **Gutter/alinhamento**: hero edge == card border edge (px-5 column); `lg:px-0` no hero (célula
    do grid); verificar via /impeccable.

## Testes a atualizar
- `odds-card-parity.golden.test.tsx` — regenerar (passo 5), diff = renames + snaps intencionais
  (9.5→9, 0.12→0.14); **MatchRow + UpcomingMatchesDesktop snapshots NÃO podem mudar**.
- `analyze-cta.test.tsx:74` — `✓` glyph → asserir `lucide-check` + `text-muted-foreground` (manter teeth).
- `analysis-scenarios.test.tsx:389` — `min-[480px]:grid-cols-2` → `sm:grid-cols-2`.
- `analysis-result.test.tsx`, `odds-card-nway.test.tsx`, `model-override-select.test.tsx` —
  toContain-only; rodar pra confirmar verdes (sem update esperado).

## Verificação
Triade (`typecheck && lint && test --no-file-parallelism && build`) + golden diff revisado à mão +
CSS sanity. Visual: match page é session-gated → owner faz o /impeccable no preview Vercel logado
(documentar). "Fecha #246" PT-BR não auto-fecha → fechar manual.

## Fora de escopo (NÃO tocar)
match-row.tsx, upcoming-matches-*, dashboard/, admin, perfil, público, shell. Não adicionar token
de tipo/cor. Não cunhar `--text-display-xs`. Não mexer no mapper (casa/visitante/encerrado ficam
literais inline; i18n é #323).
