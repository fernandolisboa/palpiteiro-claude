# HANDOFF — #323: de-slop visual do público/home (fatia 4 do épico #320)

> Snapshot de um ponto no tempo (2026-06-18), não spec viva. Auto-suficiente pra abrir a
> próxima fatia sem re-derivar contexto. Aterrado no código real.

## Estado do épico (#320)

`#321` (fundação/ADR 0029) · `#246` (match page) · **`#322` (dashboard) — todas MERGED.**
Próximas: **`#323` (público/home)**, depois `#324` (admin), `#325` (perfil). Mesmo padrão de
herdeiro: **consome** os tokens/primitivas da fundação por edição de classe, **não re-deriva nem
cunha token** (banido pela ADR 0029). Só apresentação, paridade de dados, via `/impeccable`.

## Escopo do #323 = a "grade compartilhada" que o #322 deferiu

O #322 ficou dashboard-only porque o census provou que toda a grade é importada **só por
`app/page.tsx`** (home/público), não pelo dashboard. **Esses são os arquivos do #323:**

- `components/date-range-tabs.tsx`, `components/league-tabs.tsx` (filtros da home)
- `components/match-row.tsx` (linha de jogo, mobile) + `components/desktop-status-cell.tsx`
- `components/upcoming-matches-desktop.tsx`, `components/upcoming-matches-mobile.tsx`
- `components/recent-pred-card.tsx`
- `app/page.tsx` (home) e o que mais a superfície pública renderizar (signin/como-funciona se entrarem no escopo do issue)

Census já feito nesta sessão (linha a linha) — **não precisa re-rodar do zero**, só revalidar
números de linha. Resumo dos achados por arquivo (categorias ADR 0029):

- **match-row.tsx:** badge hand-rolled `h-[18px] text-[9.5px] tracking-[0.12em]` → `Badge size="xs"` + `tracking-label`; vários `text-[Npx]`/`tracking-[Nem]` (scores `text-[15px]`→`text-label`, eyebrows `text-[10.5px]`→`text-eyebrow`, etc.); row `<Link>` sem focus-ring; marcador 'analisado' `tracking-[0.06em]` (sem token exato — resolver junto com desktop-status-cell). **MatchRowSkeleton (linhas ~113-138) é CLS-acoplado** — migrar skeleton + linha viva no MESMO passo.
- **desktop-status-cell.tsx:** badge 'analisado' `h-[20px] text-[10px]` → `Badge size="sm"` (cores accent já tokenizadas); span 'analisado' espelha match-row.tsx:41 — manter byte-consistente (#99 paridade mobile/desktop).
- **upcoming-matches-desktop.tsx:** header `text-[10px] tracking-[0.14em]` → `text-eyebrow`+`tracking-label`; badge `text-[9.5px] tracking-[0.12em]` → `Badge size="xs"`; grid-template `grid-cols-[160px_1fr_160px_140px_40px]` duplicado em header+row → extrair const `UPCOMING_GRID` (padrão extract-to-const sancionado, cf. STANDINGS_GRID); row `<Link>` sem focus-ring.
- **date-range-tabs.tsx / league-tabs.tsx:** segmented-control gêmeo — `rounded-[5px]`→`rounded-sm`, `text-[12px]`→`text-body-sm`, `shadow-[0_1px_2px_rgb(0_0_0/0.4)]`→`shadow-sm`, focus-ring nas pills. **`[color-scheme:dark]` cravado nos `<input type=date>` (date-range-tabs:95,109)** força calendário escuro no tema claro → respeitar tema (`[color-scheme:light] dark:[color-scheme:dark]`, espelhando `ui/select.tsx`). league-tabs já tem `aria-current`/`<nav>`.
- **recent-pred-card.tsx:** `rounded-[10px]`→`rounded-lg` (10px exato); 2 badges hand-rolled `h-[19px] text-[10px]` → `Badge size="sm"` (mantendo `tracking-wide` — token reservado, NÃO redefinir); card `<Link>` sem focus-ring. `:37 text-edge-fg` já é o token canônico (manter).

## ⚠️ Diferença CRÍTICA vs #322/#246: o golden VAI mudar (de propósito)

`components/__tests__/odds-card-parity.golden.test.tsx` congela **byte-a-byte** (toMatchInlineSnapshot)
os snapshots de **`MatchRow`** (linha ~66) e **`UpcomingMatchesDesktop`** (linha ~73) — exatamente os
componentes que o #323 migra. O #246/#322 tinham como invariante *não tocar* esse golden; o **#323 é o
oposto: vai obrigatoriamente re-snapshotar** esses dois blocos.

- Regenerar com `vitest -u` **e revisar o diff À MÃO**: confirmar que mudou **só** os swaps de classe
  alvo (`text-[9.5px]`→`text-eyebrow-xs`, `tracking-[0.12em]`→`tracking-label`, `h-[18px]` via Badge,
  `grid-cols-[...]`→const, etc.) — e **NADA mais**.
- **Invariantes byte-idênticos dentro do golden:** o bloco **OddsCard** (linha ~59) NÃO deve mudar (não
  é #323); a string completa da classe do **shadcn Badge** (`data-slot="badge" … rounded-full …`) NÃO
  muda (consumir `size=`, nunca editar `ui/badge.tsx`); o **TeamAvatar** inline `oklch(var(--ta-bg-l)
  0.04 ${hue})` — **hue (120/210) e chroma (0.04) têm que round-tripar EXATOS** (não tocar
  `team-avatar.tsx`; lightness já é por-tema via token). Se algum desses bytes mexer, parou — algo
  saiu do escopo.

## Gotcha técnico reaproveitável (do #322)

Tailwind v4 `@theme inline` **inlina** os aliases `--color-*` nas classes utilitárias e **NÃO os
publica como custom property em runtime**. Pra referência de CSS-var em runtime (ex.: `stroke`/`fill`
de Recharts, estilo inline), usar o **token CRU** (`var(--chart-1)`, publicado em `:root`/`.dark`),
**nunca** o alias (`var(--color-chart-1)` → não resolve, renderiza vazio). Verificar com
`grep 'var(--color-' components/ app/` na verificação. (No #322 isso quase matou a de-hex do
bankroll-chart.) Se o público tiver gráfico, mesma regra.

## Playbook (igual #321/#246/#322)

Subagent de contexto fresco por passo: **exploração+census → plano → review adversarial do plano (4
lentes) → fold → implementação (1 agente/arquivo, allowlist-gated) → code review adversarial (4
lentes, read-only) → fix → merge**. Workflow tool pros fan-outs (ultracode). Plano histórico em
`docs/plans/PLAN-323.md`; este handoff é o snapshot.

**Verificação (ordem exata):** `pnpm typecheck && pnpm lint && pnpm test --no-file-parallelism && pnpm build`,
TODOS verdes — **com re-snapshot CONSCIENTE do golden** (≠ #322). `--no-file-parallelism` é obrigatório
local (flake de pglite em 8-core; CI 2-core verde). `/impeccable` antes-vs-depois (light/dark,
mobile/desktop) na home — superfície **pública/anônima**, então (diferente do dashboard) **dá pra ver
sem login** no preview Vercel. `"Fecha #323"` PT-BR não auto-fecha → fechar manual no merge.

## Princípios inegociáveis

Só apresentação, zero mudança funcional, paridade de dados. NÃO cunhar token. NÃO editar
`components/ui/*`, `empty-state.tsx`, `team-avatar.tsx`, `globals.css`. Skeleton CLS-acoplado migra
junto com a linha viva (match-row). `tracking-wide`/`wider`/`widest` reservados — não usar/redefinir.
Não tocar dashboard (#322, MERGED), admin (#324), perfil (#325), shell, match (#246).

## Pendência visual herdada do #322 (pro /impeccable do owner)

O #322 mergeou com a triade/CI verdes e review limpo, mas o passe `/impeccable` do dashboard é
**session-gated (auth)** → roda no preview/prod logado. Pontos a conferir lá: **A/B `chart-1` vs
`chart-4` no dark** (linha do bankroll; `chart-1` escolhido por identidade — violeta no dark, laranja
no light; nenhum é pixel-match do `#a78bfa` antigo); badge da coluna 'liga' cresceu 9.5→10px (não
estourar a coluna); `mt-1` redundante na action do EmptyState (~4px). Nenhum bloqueia; são polish.
