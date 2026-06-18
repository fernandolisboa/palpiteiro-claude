# PLAN — #321: ADR 0029 + fundação de de-slop (escala + primitivas + shell)

> Plano de implementação (artefato histórico, snapshot 2026-06-18). Fatia 1 do épico **#320**.
> Derivado da exploração read-only + síntese + review adversarial (4 lentes, todas
> `approve-with-changes`). Registra as **decisões finais** — incluindo os desvios conscientes
> do texto da issue, aterrados no review.

## Princípio inegociável (toda fatia do #320)

**Só apresentação. Zero mudança funcional. Paridade de dados preservada. Sem regressão.**
Fundação-primeiro: tokens + convenções + primitivas saem aqui; as superfícies de conteúdo
(match/dashboard/admin/perfil/público) **herdam** nas fatias #246/#322–#325. Nesta fatia,
**só o shell** é migrado.

## Decisões finais (com os ajustes do review)

### Escala de tipografia — `@theme`, **font-size only, sem line-height pareado**
Tailwind v4 gera `.text-x { font-size: var(--text-x); line-height: var(--text-x--line-height) }`.
**Omitir** o companion `--text-x--line-height` ⇒ a utility seta **só** font-size e o
line-height **herda** — exatamente o comportamento do `text-[Npx]` que ela substitui (docs
confirmam: `text-[<value>]` = font-size only). Logo `text-[13px]→text-body` é **byte-idêntico**
em rendering. Isso resolve o blocker de "leading inventado" do review: **não bakeamos
line-height**; o pairing size→leading é só **documentado** (ADR) e migrações aplicam as
utilities `leading-*` padrão do Tailwind onde a origem tinha leading explícito
(`leading-[1]`/`leading-[1.05]`→`leading-none`).

Escala (px, pra paridade — a app já é px-based; **meios-pixels banidos**, colapsados pro
inteiro mais próximo, delta imperceptível por review):

| token | px | papel | colapsa |
|---|---|---|---|
| `--text-eyebrow-xs` | 9 | menor monograma/glyph (help-hint `?`) | 9 |
| `--text-eyebrow` | 10 | eyebrow mono dominante (sufixo wordmark, section-label, badges) | 9.5, 10, 10.5 |
| `--text-meta` | 11 | meta/timestamp/"sair"/link saiba-mais | 11, 11.5 |
| `--text-body-sm` | 12 | nav desktop, back-link, label de usuário, controle de form | 12, 12.5 |
| `--text-body` | 13 | corpo de leitura (subtítulo, prosa) | 13, 13.5 |
| `--text-label` | 14 | rótulo/título de item/nome de time/nav-row mobile | 14, e 15-body |
| `--text-display-sm` | 18 | wordmark + headings pequenos/h2 | 15, 16, 17, 18, 20 |
| `--text-display-md` | **26** | h1 mobile + métrica/placar | 22, 26 |
| `--text-display-lg` | 32 | h1 desktop + hero | 28, 30, 32, 36 |

- **`display-md = 26` (não 24)** — blocker do review: `app/loading.tsx` (shell, migrado) e
  `app/page.tsx` "Próximos jogos" (conteúdo, **não** migrado nesta fatia) usam o MESMO par
  `text-[26px]`/`text-[32px]`. 26→24 faria o skeleton divergir 2px do live ⇒ exatamente o CLS
  que a fatia mata. 26 mantém paridade; `22→26` (7 usos de conteúdo) documentado pros heirs.
- **15px é context-dependent**: nav-row mobile (`text-[15px]`, corpo) → `text-label`(14);
  heading 15px → `display-sm`(18). Heirs resolvem por contexto.
- **h1 unifica pra CIMA**: os h1 de 20px (admin/perfil) → `display-md`(26) nos heirs,
  alinhando com o h1 de 26 do home — **não** encolhem pra 18. (resolve o "h1 shrink" do review.)

### Tracking — 2 tokens NOVOS, `tracking-tight` **não** redefinido
- `--tracking-label: 0.14em` → `tracking-label` (badges/labels mono uppercase).
- `--tracking-eyebrow: 0.18em` → `tracking-eyebrow` (sufixo de marca, section-label, 404).
- **NÃO redefinir `tracking-wide`**: só 2 usos, ambos em `recent-pred-card.tsx` (conteúdo,
  fora de escopo) — redefinir saltaria 0.025em→0.18em num arquivo que não tocamos. Por isso
  nomes não-colidentes (`-label`/`-eyebrow`).
- **NÃO redefinir `tracking-tight`** (134 usos app-wide): roteamos as trackings negativas
  ad-hoc do shell (`-0.04`/`-0.035`/`-0.02`) pro `tracking-tight` existente. Mantém a mudança
  **aditiva** (zero shift em conteúdo) e ainda elimina `tracking-[Nem]` arbitrário do shell.

### Larguras — namespace `--container-*` → `max-w-*` (px, paridade)
`--container-content: 1040px` · `-aside: 320px` · `-narrow: 480px` · `-reading: 640px` ·
`-form: 380px` → `max-w-content/aside/narrow/reading/form`. Colapsa 1100→1040, 680→640, 360→380.

### Espaçamento — **convenção** (utilities existentes), não tokens novos
Gutter de página = `px-5` mobile / `lg:px-8` desktop (o gutter responsivo não cabe num único
token). Padding interno de card = `px-4`/`px-6` (continuam legítimos — discriminador: gutter =
padding horizontal do container externo; padding de célula/card fica). Ritmo vertical =
`gap-2`/`gap-3`, `pb-6`; header mobile `pt-6 pb-4`.

### reduced-motion — bloco global, **só duração**
`@media (prefers-reduced-motion: reduce)` zerando `transition-duration`/`animation-duration`
(+`animation-iteration-count:1`, `scroll-behavior:auto`) — **nunca** `animation-name`/display,
pra Radix sheet/popover ainda montar/abrir. Verificar sheet/popover sob reduce.

### Avatar — tokenizado por tema (light **byte-idêntico**)
`:root { --ta-bg-l:0.32; --ta-fg-l:0.88 }` / `.dark { --ta-bg-l:0.40; --ta-fg-l:0.92 }`;
inline `oklch(var(--ta-bg-l) 0.04 ${hue})` / `oklch(var(--ta-fg-l) 0.04 ${hue})`. **Hue fica
inline e intocado** ⇒ identidade estável (hue é computado em `lib/view/team.ts`, nunca no
componente). Light = exatamente 0.32/0.88 (paridade); só o ramo `.dark` é novo.

## Escopo de arquivos (ALLOWLIST — rejeitar diff fora disto)

**Tokens/base:** `app/globals.css`.
**Primitivas novas:** `components/ui/callout.tsx`, `components/empty-state.tsx`,
`components/ui/select.tsx`, `components/ui/label.tsx`, `components/wordmark.tsx`,
`components/nav-link.tsx`.
**Primitivas editadas:** `components/ui/badge.tsx` (size axis aditivo, default no-op).
**Avatar:** `components/team-avatar.tsx`.
**Shell migrado:** `components/desktop-shell.tsx`, `components/page-header.tsx`,
`components/mobile-nav.tsx`, `components/section-label.tsx`, `components/back-link.tsx`,
`components/form-dot.tsx`, `components/help-hint.tsx`, `components/user-avatar.tsx`,
`app/loading.tsx`, `app/error.tsx`, `app/signin/page.tsx`,
`components/help/glossary-section.tsx`.
**Testes atualizados:** `components/__tests__/back-link.test.tsx` (pin `text-[12.5px]`),
`components/__tests__/odds-card-parity.golden.test.tsx` (3 snapshots: ripple de help-hint +
team-avatar; regenerar e verificar diff = só os deltas intencionais).

### FORA de escopo (removido por review — colisão com heirs)
- ❌ `components/dashboard/bankroll-chart.tsx` (#322) — **não** editar e **não** cunhar
  `--color-chart-profit`. Convenção "chart tokenizado, nunca hex; `#a78bfa`→`chart-N`" fica
  **documentada** pro #322.
- ❌ `components/match-row.tsx` (#246, dual-use home) — defer inteiro.
- ❌ `components/skeletons/match-sections-skeleton.tsx` (só match page, #246) — defer.
- ❌ `components/skeletons/match-list-skeleton.tsx` — twin (home desktop row) é conteúdo;
  re-derivar altura agora desincroniza ⇒ defer a derivação-por-token pra quando a linha real
  migrar (evita CLS). Critério (e) "anti-CLS" satisfeito por **manter paridade com a linha
  não-migrada**, movendo a derivação com cada linha.

## Primitivas — adoção no shell vs criadas-pra-heirs (carve-out do critério b)
- **Adotadas no shell agora:** `Callout` (error.tsx), `Wordmark` (desktop-shell/page-header/
  signin), `NavLink`/`navLinkVariants` (desktop-shell/mobile-nav).
- **Criadas como fundação, consumidores migram nos heirs:** `Select`/`Label` (selects nativos
  vivem em perfil/admin #325/#324), `EmptyState` (empty states de conteúdo), variantes de
  tamanho de `Badge` (badges hand-rolled em odds/match — conteúdo). Registrado nas
  Consequências da ADR pra o critério (b) não falhar em silêncio. **Select = `<select>` nativo
  estilizado** (não Radix): consumidores são selects nativos ⇒ drop-in, sem mudar modelo de
  interação.

## a11y
`<nav aria-label>` em **ambos** os `<nav>` (desktop-shell + mobile-nav) + `aria-current="page"`
no link ativo; `focus-visible:ring-[3px] ring-ring/50` em todo link/Link custom (nav, back-link,
wrapper do user-avatar). `pl-[22px]`×2 do glossary → `pl-5.5` (22px = ícone size-3.5 + gap-2,
na escala de spacing). `layout/theme-toggle/version-checker` inspecionados, **limpos** (sem
slop, sem `animate-*`) → omissão deliberada.

## Ordem de execução
1. ADR 0029 (`docs/decisions/`). 2. `globals.css` (tokens + reduced-motion + `--ta-*`).
3. Primitivas novas. 4. Badge size axis. 5. team-avatar. 6. Migração do shell. 7. a11y.
8. Atualizar testes (back-link + golden, verificando diff). 9. Triade local
(`typecheck && lint && test --no-file-parallelism && build`). 10. Verificação visual
(Playwright, light/dark, mobile/desktop). 11. Code-review workflow → correções. 12. PR.

## Critério de saída
Triade verde; preview Vercel sobe; revisão `/impeccable` antes-vs-depois sem regressão; diff
só de apresentação. "Fecha #321" PT-BR **não** auto-fecha → fechar manual no merge.
