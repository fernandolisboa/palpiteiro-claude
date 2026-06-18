# PLAN — #324: de-slop do Admin (`app/admin/**`) — fatia 6

> Plano de implementação (artefato histórico, snapshot 2026-06-18). Fatia 6 do épico **#320**.
> Herdeiro da fundação **#321** (ADR 0029, MERGED, PR #327 — fonte da verdade de tipo/tracking/
> largura/motion no `@theme`), da **#246** (match, referência viva), e dos precedentes **#322**
> (dashboard), **#323** (entrada/público) e **#331** (feed) + do fix de fundação **#333**
> (`extendTailwindMerge`, eixo `size` do Badge agora rende certo). Adota tokens/primitivas que a
> fundação criou; **não re-deriva nem cunha token** (banido pela ADR 0029). Derivado de um censo
> read-only line-by-line (12 agentes, 1/arquivo) verificado byte-exato contra o código. **Admin-only**
> (`app/admin/**` + 2 primitivas admin-scoped novas). Registra as decisões finais, incl. desvios
> conscientes do texto da issue, pra passar pelo review adversarial de 4 lentes.

## Princípio

Só **apresentação**, zero mudança funcional, **paridade de dados/actions/queries/permissão**
preservada, sem regressão. Conduzido via `/impeccable` (admin é auth-gated → owner roda **logado**
no preview Vercel, como #322/#331). A fundação (#321) é a fonte da verdade no `@theme` de
`app/globals.css`; aqui **roteamos classes** pros tokens, **consumimos** primitivas e **extraímos**
2 primitivas admin-scoped (frame compartilhado, não novo design). Onde a issue conflita com o que o
censo provou (ex.: as "3 definition-rows" são estruturalmente divergentes; a primitiva `PageHeader`
JÁ EXISTE como chrome de shell), o **código real ganha** e o desvio é documentado — mas onde o
conflito é com um **critério de aceite escrito**, registramos como desvio consciente flagado pro
review/owner (precedente #322).

## Escopo (allowlist — os ÚNICOS arquivos que podem mudar/nascer + este plano)

**Editados (presentation-only):**
- `app/admin/page.tsx`
- `app/admin/costs/page.tsx`
- `app/admin/settings/page.tsx`
- `app/admin/settings/default-model-form.tsx`
- `app/admin/settings/generation-params-form.tsx`
- `app/admin/predictions/[id]/page.tsx`
- `app/admin/predictions/[id]/override-form.tsx`
- `app/admin/users/page.tsx`
- `app/admin/users/[userId]/page.tsx`
- `app/admin/users/[userId]/user-admin-controls.tsx`

**Novos (criados):**
- `components/admin/page-heading.tsx` (primitiva — bloco título+subtítulo das páginas bare)
- `components/admin/definition-row.tsx` (primitiva — frame label/valor compartilhado)
- `app/admin/loading.tsx` (skeleton bare, max-w-reading — cobre admin root + costs + settings +
  predictions/[id] + users por cascata)
- `app/admin/users/[userId]/loading.tsx` (skeleton DesktopShell, max-w-content)
- `app/admin/users/[userId]/[predictionId]/loading.tsx` (skeleton DesktopShell, max-w-reading detail)
- `app/admin/error.tsx` (boundary compartilhado de erro admin — espelha `app/dashboard/error.tsx`)
- `docs/plans/PLAN-324.md` (este plano)

**NÃO tocar (consumir/referência):**
- `app/admin/layout.tsx` — **gate de auth/role** (`session?.user?.role !== "admin"` → `notFound()`).
  Zero superfície de apresentação. **NÃO editar** (segurança; protege a action de override de
  settlement — CLAUDE.md).
- `app/admin/users/[userId]/[predictionId]/page.tsx` — **zero superfície de apresentação**: delega
  100% pra `components/dashboard/prediction-detail.tsx` (BANIDO, #322). Só nasce o `loading.tsx`
  dessa rota; o `page.tsx` fica **INTOCADO** (as props `backHref`/`backLabel="tracking"` JÁ existem e
  passam pro prediction-detail BANIDO que renderiza o `BackLink` — a apresentação vive num componente
  banido, então a página não muda; NÃO é uma edição pendente — correção review lens A/D).
- `app/admin/predictions/[id]/__tests__/override-form.test.tsx` — teste; class-agnostic; passa
  **sem update** (ver §Testes).
- `components/ui/*` (Select, Label, Badge, Table, Button, Input, Card, Separator, Skeleton…),
  `components/empty-state.tsx`, `components/back-link.tsx`, `components/section-label.tsx`,
  `components/page-header.tsx`, `components/wordmark.tsx`, `components/nav-link.tsx`,
  `components/team-avatar.tsx`, `app/globals.css`, **`components/dashboard/*`** (BankrollChart,
  DashboardFiltersBar, KpiCards, MarketSegments, PredictionsTable, prediction-detail — #322,
  consumidos por `users/[userId]`, NUNCA editados aqui). **Cunhar token é banido.**

**Nenhum golden cobre admin** (o único golden é `odds-card-parity.golden.test.tsx`, importa
OddsCard/MatchRow/UpcomingMatchesDesktop — nada de admin) ⇒ **zero re-snapshot**. As primitivas novas
vivem em `components/admin/` (só admin importa) ⇒ **zero ripple** em qualquer golden.

## Vocabulário herdado (referência rápida — NÃO cunhar nada)

Tipografia (font-size only, leading herda → byte-idêntico onde o px casa): `text-eyebrow-xs`(9)
`text-eyebrow`(10) `text-meta`(11) `text-body-sm`(12) `text-body`(13) `text-label`(14)
`text-display-sm`(18) `text-display-md`(26) `text-display-lg`(32). **Colapso de meio-pixel**
(ADR §A.1, byteIdentical=false): 10.5→eyebrow, 11.5→meta, 12.5→body-sm, 13.5→body, 9.5→eyebrow-xs.
Tracking: `tracking-label`(0.14em — eyebrow/badge MONO UPPERCASE; absorve 0.14/0.12/0.1/0.08em),
`tracking-eyebrow`(0.18em — section-label/marca), `tracking-tight` (stock, banda negativa
-0.04/-0.035/-0.02). Raio: `rounded-sm`(6)/`md`(8)/`lg`(10)/`xl`(14)/`full`. Sombra: `shadow-sm`.
Largura: `max-w-content`(1040) `max-w-reading`(640) `max-w-narrow`(480) `max-w-form`(380)
`max-w-aside`(320). Cor semântica: `edge-fg`/`edge-soft`/`edge-border` (ganho), `destructive`
(perda/erro), `warn-fg`/`warn-soft`/`warn-border` (aviso), `accent-fg` (accent/link),
`muted-foreground`/`muted-fg-2` (secundário/terciário). Foco visível:
`focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50` (+`rounded-sm` onde
a forma comporta). Todos confirmados no `@theme` de `app/globals.css`.

## Decisões globais (cross-file)

### 1. `PageHeading` — primitiva NOVA admin-scoped (colisão de nome com a shell `PageHeader`)

**A primitiva `components/page-header.tsx` JÁ EXISTE e é OUTRA coisa** — é o **chrome de shell mobile**
(hambúrguer `MobileNav` + `Wordmark` + `ThemeToggle`), test-pinned, migrada pela #321, **consumir-only**.
Logo o "`<PageHeader title subtitle/>`" que a issue pede é uma **colisão de nome**: criar com nome
**diferente** → **`PageHeading`** em `components/admin/page-heading.tsx`.

**API:** `{ backLink?: { href: string; label: string }; title: string; subtitle: ReactNode }`.
**Render:**
```tsx
{backLink && <BackLink href={backLink.href} label={backLink.label} />}
<h1 className="text-display-md font-medium tracking-tight">{title}</h1>
<p className="pb-6 font-mono text-meta text-muted-foreground">{subtitle}</p>
```
Consome a primitiva `BackLink` (que já traz `mb-6` + ring + `ChevronLeft size-3.5` + `text-body-sm
tracking-tight`). **Consumidores (5 páginas bare):**
- `app/admin/page.tsx:33-38` — `backLink={{href:"/",label:"jogos"}}` title `Admin` subtitle
  `painel · acesso restrito a administradores`.
- `app/admin/costs/page.tsx:28-35` — `backLink={{href:"/admin",label:"admin"}}` title `Custos de IA`
  subtitle `gasto agregado · por dia, usuário, modelo · USD`.
- `app/admin/settings/page.tsx:21-28` — `backLink={{href:"/admin",label:"admin"}}` title
  `Configurações de IA` subtitle `modelo de análise · default global`.
- `app/admin/predictions/[id]/page.tsx:42-54` — `backLink={{href:`/match/${match.id}`,label:"jogo"}}`
  title `Override de settlement` subtitle `prediction · {prediction.id.slice(0, 8)}`. **Mata a
  back-link HAND-ROLLED** (linha 42-46, `inline-flex … pb-6 … text-[12.5px]` + ChevronLeft) ⇒ ganha
  ring + chevron canônico de graça; `pb-6`→`mb-6` (ambos 24px bottom, equivalente visual);
  `text-[12.5px]`→`text-body-sm`(o colapso planejado).
- `app/admin/users/page.tsx:29-34` — `backLink={{href:"/admin",label:"admin"}}` title `Usuários`
  subtitle `auditar o tracking de qualquer usuário · busca por e-mail`.

**NÃO consome (idioma diferente, fica INLINE):** `app/admin/users/[userId]/page.tsx:75-82` é
**DesktopShell** com h1 **28px(outlier)/lg:32 + subtítulo SANS** (`text-body tracking-tight`, não
mono-meta) — idêntico ao h1 do `app/dashboard/page.tsx` que a #322 deixou inline. Forçá-lo no
PageHeading exigiria variantes de escala+subtítulo pra **um único** consumidor de idioma distinto.
**Decisão: token-swap inline** (ver §per-arquivo). Isso **reconcilia escala por tipo de tela** (bare
→ display-md 26; DesktopShell-detail → 28/lg:32 como o dashboard) sem abstração forçada. **Desvio
consciente** do "1 PageHeader pra tudo".

### 2. `DefinitionRow` — primitiva NOVA admin-scoped (frame compartilhado, slots ReactNode)

O censo provou que as "3 reimplementações de linha label/valor" **NÃO são a mesma linha** — divergem
em tipografia/orientação/conteúdo. O que **de fato** repete é o **FRAME** horizontal
`flex items-center justify-between border-b border-border`. Extrair só o frame, com label/valor como
**slots ReactNode** (consumidor controla a tipografia):
```tsx
// components/admin/definition-row.tsx
export function DefinitionRow({ label, value, className }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between border-b border-border py-2", className)}>
      {label}
      {value}
    </div>
  );
}
```
**Consumidores:**
- `app/admin/predictions/[id]/page.tsx:16-25` — a função local `Row({label,value})` passa a renderizar
  `<DefinitionRow label={<span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">{label}</span>} value={<span className="text-body tabular-nums">{value}</span>} />`.
  Mantém os ~10 call-sites `<Row label="…" value={…}/>` **intactos** (Row vira wrapper tipado fino;
  zero mudança nos call-sites/copy).
- `app/admin/costs/page.tsx` — as 3 listas (byDay 65-82, byUser 97-114, byModel 129-150) consomem
  `<DefinitionRow className="px-4 py-3" label={…spans esquerdos…} value={…cluster direito…} />`
  (cada uma com sua tipografia própria nos slots; só o frame `flex justify-between border-b` sai
  pro componente; `px-4 py-3` via className).
- `app/admin/settings/page.tsx:39-57` — a lista de modelos (`flex items-center justify-between
  border-b border-border px-4 py-3 last:border-b-0`) consome `<DefinitionRow className="px-4 py-3
  last:border-b-0" label={…nome+id…} value={…pricing…} />`.

**NÃO consome (forma diferente, token-swap in-place):** `user-admin-controls.tsx:54-59,77-82`
(Role/Acesso) são **flex-COL** (label EM CIMA do valor) + emparelhados com um **botão de action** ao
lado — não é o frame horizontal label↔valor. Migrar distorceria. **Desvio consciente** do "1
DefinitionRow cobre as 3"; o censo mostra que só 2 das 3 (predictions + costs/settings)
compartilham o frame.

### 3. loading.tsx / error.tsx — 3 loading (por idioma, via cascata) + 1 error compartilhado

7 segmentos `force-dynamic`; nenhum tem `loading`/`error` hoje (confirmado). Cold-start Neon ~1s +
CLAUDE.md "loading e error states explícitos em rotas". **Precedente do repo (dashboard):**
`app/dashboard/loading.tsx` + `app/dashboard/[predictionId]/loading.tsx` (loading por idioma) e
**UM** `app/dashboard/error.tsx` bare cobrindo todo o subtree (incl. `[predictionId]`, sem
`error.tsx` próprio). CLS é dominado por **container + header above-the-fold**, que são idênticos por
idioma. Logo:

- **`app/admin/loading.tsx`** (bare, `max-w-reading px-6 py-8`): skeleton no formato PageHeading
  (linha back-link + bloco h1 + linha subtítulo) + 3-4 `Skeleton` de conteúdo. **Cobre por cascata**
  admin root + costs + settings + predictions/[id] + users (mesmo idioma/largura/header → zero CLS de
  header).
- **`app/admin/users/[userId]/loading.tsx`** (DesktopShell, `max-w-content`): espelha
  `app/dashboard/loading.tsx` (a página renderiza os MESMOS widgets KpiCards/MarketSegments/
  BankrollChart/PredictionsTable) — header skeleton + grade KPI + blocos de chart/tabela.
- **`app/admin/users/[userId]/[predictionId]/loading.tsx`** (DesktopShell, `max-w-reading`): espelha
  `app/dashboard/[predictionId]/loading.tsx` (detail reading-width). Necessário pra não herdar por
  cascata o skeleton de grade do `[userId]` (CLS).
- **`app/admin/error.tsx`** (`"use client"`, bare): espelha `app/dashboard/error.tsx` 1:1 —
  `Sentry.captureException`, `TriangleAlert` `text-warn-fg`, h1 `text-display-sm`, `Button reset` +
  `<Link href="/admin">`. Copy: "Falha ao carregar o admin". Cobre **todas** as rotas admin
  (boundary no segmento `/admin`; renderiza bare mesmo nas rotas DesktopShell, como o dashboard faz).

**Desvio consciente** do texto literal "loading.tsx + error.tsx em **cada** rota dinâmica": a
intenção (todo route dinâmico com skeleton de idioma-correto + boundary de erro) é **integralmente
satisfeita** por 3+1 via a semântica de cascata do App Router; 7+7 arquivos seria duplicação
near-idêntica contra o precedente do dashboard. **Flag pro review/owner** (alternativa: per-route
7+7 se o owner quiser literal). Skeleton via `components/ui/skeleton` (`Skeleton`), consumir-only.

### 4. Adoção de primitivas — política (parity-first)

- **`Select` (`components/ui/select.tsx`): ADOTAR** nos 3 `<select>` nativos. A ADR 0029 §B + a #321
  criaram o Select **explicitamente pra estes consumidores** (perfil/admin). Drop-in: mantém
  `<select>`/`<option>` nativos (form-submitting, `name`/`defaultValue`), traz ring + `[color-scheme]`
  + chevron. Call-sites: `default-model-form.tsx:37-57` (modelId), `generation-params-form.tsx:83-98`
  (effort), `override-form.tsx:69-79` (result). Some o `[color-scheme:light] dark:[color-scheme:dark]`
  e o `outline-none` cru hand-rolled (o Select supre). **CRÍTICO:** preservar `name`/`defaultValue` e o
  `disabled` por-option (`default-model-form` tem `disabled={!m.userSelectable}` — admin-only models
  renderizam disabled, ADR 0019; **load-bearing**).
  - **MUDANÇA DE TAMANHO consciente (review lens A/B):** o Select primitivo hardcoda **`text-body-sm`
    (12px)** (`select.tsx:22`); os 3 `<select>` hoje são **`text-sm` (14px)**. Adotar o primitivo
    **encolhe o texto do select 14→12px** — NÃO é nossa escolha de classe, é **intrínseco ao primitivo
    de fundação** (que define o tamanho canônico de select da app, perfil+admin). Aceito como
    consequência sancionada (alinha admin↔perfil↔#325; espelha o "graduado mono→sans" aceito no #322).
    Documentado, NÃO byte-idêntico. `/impeccable` valida.
  - **Largura — CONSTRANGER POR WRAPPER, NUNCA por `className` (CORREÇÃO crítica, review lens D):** o
    `className` do Select cai no `<select>` INTERNO; o `<div>` externo é `inline-flex w-full` e a
    chevron é `absolute right-2.5` ancorada nesse div. Passar `max-w-*` via `className` capa o
    `<select>` mas deixa o div externo full-width → **chevron descola** (flutua na borda direita do
    container cheio). **Receita:** `<div className="max-w-aside"><Select …/></div>`. `max-w-aside`(320)
    = byte-idêntico ao `w-80`(320) atual de model/effort; o result (`w-56`=224, sem token) **alarga
    224→320** (confortável, não full-bleed; consequência documentada — não há token 224, `max-w-[224px]`
    seria arbitrário banido). `/impeccable` julga o result.
- **Botões raw (`<button>`): foco IN-PLACE, NÃO migrar pra `<Button>`.** Os submits usam
  **inverted-fill** intencional (`bg-foreground text-background`) sem variante shadcn equivalente; os
  de role/access/buscar usam outline. Migrar mudaria o fill. **Adicionar a receita de ring** in-place
  preserva 100% a aparência e satisfaz "foco visível" (ADR:114). Call-sites: `default-model-form:66`,
  `generation-params-form:125`, `override-form:91`, `user-admin-controls:65,88`, `users/page.tsx:47`.
  (Desvio consciente da convenção ADR §B "form controls só via primitivos" — parity vence; Button
  migration fica como opção pro /impeccable.)
- **Inputs raw: foco IN-PLACE + nome acessível.** Os `<input type=number>` (score/maxTokens/temperature)
  e o de busca ganham a receita de ring; o de busca (`users/page.tsx:40-46`) ganha `aria-label`
  (hoje só placeholder). **Larguras `w-80`/`w-56`/`w-24` são escala STOCK do Tailwind (20rem/14rem/
  6rem), NÃO `w-[Npx]` arbitrário** — são sizing **funcional** (score input estreito p/ 2-3 dígitos).
  **MANTER** (como #322 manteve `max-w-[220px]` clamp, #331 `min-w-[180px]`). (Desvio do literal "w-80/
  w-56/w-24 → w-full + max-w por token": são stock-scale funcionais, não arbitrários; o de-slop real é
  ring + Select. **Flag pro owner**.)
- **`text-sm` (14px) residual — POLÍTICA explícita (review lens A/B HIGH; o grep-gate não pega
  `text-sm`):** `text-sm` é stock Tailwind mas é **fora da escala nomeada** (carrega leading 20px
  pareado, inerte em controle single-line `h-9`). O épico mata a entropia de escala → **eliminar
  `text-sm` do admin**, mapeando pra escala:
  - **3 selects** (`default-model:40`, `generation-params:87`, `override:72`) → `text-body-sm`(12) via
    o primitivo Select (shift 14→12 acima).
  - **4 number inputs** (`override:48,60` score; `generation-params:71,117` maxTokens/temperature) →
    `text-sm`→`text-body-sm`(12) **pra harmonizar com os selects no MESMO form** (shift 14→12
    consciente; evita a inconsistência select-12px-vs-input-14px que adotar o Select sozinho criaria).
  - **3 submit buttons** (`default-model:69`, `generation-params:128`, `override:91`) →
    `text-sm`→`text-label`(14, font-size byte-idêntico; dropa o leading 20px inerte; mantém o tamanho
    de botão). Os botões role/access/buscar já são `text-[12.5px]`/`text-[13px]` (arbitrários, tratados
    no mapa por-arquivo) — não são `text-sm`.
  - **Resultado:** `text-sm` zerado no admin; campos (select+input) uniformes a 12px; botões a 14px. O
    grep-gate passa a vigiar `\btext-sm\b` (0 hits esperados).
- **`Label` (`components/ui/label.tsx`): NÃO consumir.** As captions de campo do admin são spans
  **mono-uppercase eyebrow** em `<label className="flex flex-col gap-1">` (vertical) — o Label
  primitivo é `flex items-center gap-2 text-body-sm font-medium` (horizontal sans). Não é drop-in. O
  toggle de `generation-params:48` (`<label htmlFor=… flex items-center gap-2 text-[13px]`) já tem
  `htmlFor` → token-swap `text-[13px]`→`text-body` in-place (consumir Label encolheria 13→12). Manter
  as associações implícitas existentes.
- **`SectionLabel` (`components/section-label.tsx`): NÃO consumir.** Usa `tracking-eyebrow`(0.18em) +
  `px-5 pt-1 pb-2` (gutter de shell full-bleed). Os eyebrows do admin usam `tracking-[0.14em]`
  (→`tracking-label`) e vivem DENTRO de containers já com `px-6`/cards → consumir dobraria padding e
  mudaria o tracking. **Token-swap in-place** (mono uppercase muted + `text-eyebrow` + `tracking-label`,
  preservando o `pb-N` de cada um). Exceção: `users/[userId]:113` tem `tracking-[0.18em]`(→
  `tracking-eyebrow` exato) + sibling de contagem `flex items-baseline justify-between` (a forma do
  SectionLabel) — **ainda assim NÃO consome** (o `px-5` do primitivo dobraria o gutter do DesktopShell);
  token-swap in-place mantendo o `flex items-baseline justify-between`.
- **`EmptyState` (`components/empty-state.tsx`): ADOTAR só em 1 lugar.** `users/[userId]/page.tsx:91-104`
  (Card + `Inbox` + título + subtítulo hand-rolled) → `<Card className="px-8 py-16 text-center">
  <EmptyState className="max-w-form py-6" icon={<Inbox className="size-10" strokeWidth={1.25}/>}
  title="Este usuário ainda não tem predições" description="Nada pra trackear ainda." /></Card>`
  (preserva 380=max-w-form + ícone + copy; espelha #322 page.tsx). **Shifts de tipo conscientes vindos
  do primitivo (correção review lens B):** título 15px→`text-label`(**14**, shrink de 1px, sem degrau
  em 15) e descrição 13px→`text-body-sm`(**12**, NÃO `text-body`/13 — o EmptyState renderiza
  `description` em `text-body-sm`, `empty-state.tsx:31`). São consequências deliberadas de adotar o
  primitivo, registradas como shift (não byte-idênticas). Os `<p>` curtos
  (`costs` "Nenhuma chamada registrada." ×3; `users` "Nenhum usuário.") ficam **`<p>` tokenizado**
  (`text-[13px]`→`text-body`) — critério #322 dec.6 ("<p> curto em estrutura já existente →
  tokeniza, não força EmptyState"). **Flag /impeccable** (users empty poderia virar EmptyState como o
  predictions-table do #322 — entrega base é `<p>`).
- **Badge `bloqueado`/role (`users/page.tsx:70,74`): cor IN-PLACE, NÃO migrar pra `<Badge>`.** A issue
  exige só o fix de **cor crua** (`bg-red-500/10 text-red-500` → `destructive`). Migrar pro Badge
  primitivo mudaria `rounded-sm`→`rounded-full` (shape). In-place: `bg-red-500/10`→`bg-destructive/10`,
  `text-red-500`→`text-destructive`, `text-[10px]`→`text-eyebrow`, `tracking-[0.12em]`→`tracking-label`;
  role badge idem (sem cor). **Flag /impeccable** (Badge size=xs é opção pós-#333).

### 5. Heading reconciliado (escala por tipo de tela)

- **5 páginas bare**: h1 `text-[20px]`→`text-display-md`(26) — **unifica PRA CIMA** (ADR §A.1 "20px
  unifica pra display-md, nunca encolhe"); `tracking-[-0.02em]`→`tracking-tight`. (Via PageHeading,
  dec.1.)
- **`users/[userId]` (DesktopShell)**: h1 base `text-[28px]` = **outlier comentado** (heroic, sem
  degrau; espelha dashboard page.tsx/#322 dec.3); `leading-[1.05]`→`leading-none`;
  `tracking-[-0.035em]`→`tracking-tight`; `lg:text-[32px]`→`lg:text-display-lg`(32 exato); subtítulo
  `text-[13.5px]`→`text-body`(colapso ½px). Inline (dec.1).

## Mapa por arquivo (token/cor/foco — byte-exato do censo; `=` byte-idêntico, `~` colapso/mudança)

### `app/admin/page.tsx` (bare, dynamic)
- `:32` `max-w-[640px]`→`max-w-reading` (=). `:35-38` header → **PageHeading** (h1 20→display-md ~,
  `tracking-[-0.02em]`→`tracking-tight`, subtítulo `text-[11px]`→`text-meta` =, BackLink href="/"
  label="jogos"). `:48` `text-[13px]`→`text-body` (=). `:49` `text-[10.5px]`→`text-eyebrow` (~) —
  **APENAS o font-size, SEM tracking** (correção review lens B): esse span é `font-mono text-muted-foreground`
  minúsculo SEM uppercase/tracking (é meta-line dentro do Link de nav, NÃO um eyebrow); NÃO injetar
  `tracking-label`.
  `:42` nav `<Link>` → +ring de foco (full-width em `<nav>` rounded-md; usar `focus-visible:ring`
  inset/sem rounded ou `rounded-sm`, julgar clip). **As linhas 47-52 (título/desc do nav row) NÃO são
  definition-row** (é conteúdo de Link de navegação) → token-swap só. SECTIONS (11-27) = DADOS, não
  tocar.

### `app/admin/costs/page.tsx` (bare, dynamic) — 25 findings
- `:27` `max-w-[640px]`→`max-w-reading` (=). `:30-35` header → **PageHeading** (BackLink href="/admin"
  label="admin"). Eyebrows `:38/:56/:88/:120` `text-[10.5px]`→`text-eyebrow` (~) +
  `tracking-[0.14em]`→`tracking-label` (=) (mono uppercase muted, in-place). Empty `<p>`
  `:60/:92/:124` `text-[13px]`→`text-body` (=) (mantém `<p>`). Listas byDay/byUser/byModel
  (`:65-82/:97-114/:129-150`) → **DefinitionRow** (`px-4 py-3` via className; slots c/ tipografia
  própria): `:70/:106/:143` `text-[12.5px]`→`text-body-sm` (~), `:74` idem, `:77/:109/:146`
  `text-[13px]`→`text-body` (=), `:102/:135` `text-[13px]`→`text-body` (=), `:138`
  `text-[10.5px]`→`text-eyebrow` (~). KPI cell `:160-168` (Kpi local): `:163`
  `text-[10px]`→`text-eyebrow`(=) + `tracking-[0.12em]`→`tracking-label`(~, +0.02em sancionado);
  **`:166` `text-[16px]` = OUTLIER comentado** (sem degrau 14→18; NÃO colapsar, NÃO cunhar). Os 4 KPI
  cells (`:42-51`) podem ou não virar DefinitionRow — **NÃO** (são stat-cells flex-col, não label↔valor
  horizontal; token-swap in-place). Copy/keys (`formatDay`, `r.day`, `{r.calls} chamadas`, etc.)
  verbatim.

### `app/admin/settings/page.tsx` (bare, dynamic) — 18 findings
- `:20` `max-w-[640px]`→`max-w-reading` (=). `:23-28` header → **PageHeading** (BackLink href="/admin"
  label="admin"; h1 20→display-md ~; subtítulo `text-[11px]`→`text-meta` =). Eyebrows h2
  `:31/:62/:69` `text-[10.5px]`→`text-eyebrow`(~) + `tracking-[0.14em]`→`tracking-label`(=) (in-place,
  NÃO SectionLabel). Lista de modelos `:39-57` → **DefinitionRow** (`px-4 py-3 last:border-b-0`):
  `:45` `text-[13px]`→`text-body`(=), `:49` `text-[10.5px]`→`text-eyebrow`(~), `:53`
  `text-[11px]`→`text-meta`(=). `:34` `rounded-md` já-token (sem mudança). Selects/inputs/labels/foco
  ficam nos forms irmãos.

### `app/admin/settings/default-model-form.tsx` (client form, NOT dynamic) — 16 findings
- `:34` eyebrow `text-[10px]`→`text-eyebrow`(=) + `tracking-[0.14em]`→`tracking-label`(=). `:37-57`
  `<select modelId>` → **Select** envolto em `<div className="max-w-aside">` (preserva `name="modelId"`,
  `defaultValue={current}`, `disabled={!m.userSelectable}` por-option; some
  `[color-scheme]`/`outline-none`/`w-80`/`text-sm` hand-rolled; texto 14→12 via primitivo; largura
  320→320 byte-idêntica). `:60` `text-[12px]`→`text-body-sm`(=). `:66` submit `<button>` → +ring
  in-place (mantém inverted-fill) + **`text-sm`→`text-label`(=,14)**. `:76` `text-[13px]`→`text-body`(=)
  (`text-accent-fg` fica). `:78` `text-[13px]`→`text-body`(=) + **`text-red-500`→`text-destructive`**.

### `app/admin/settings/generation-params-form.tsx` (client form, NOT dynamic) — 22 findings
- **`:37-40` banner âmbar** → família **warn**. **DUAS cores âmbar de texto (correção review lens B —
  o plano antes só listava a de :40):** `:37` container `border-amber-500/40`→`border-warn-border`,
  `bg-amber-500/10`→`bg-warn-soft`, **`text-amber-700 dark:text-amber-300`→`text-warn-fg`** (some o
  dark: manual), `text-[12px]`→`text-body-sm`(=); `:40` `<p>` interno
  **`text-amber-700/90 dark:text-amber-300/90`→`text-warn-fg`** (some o dark: manual E o `/90` —
  consolida no token; confirmar no /impeccable que a perda do `/90` não é perceptível). **`:39` glifo
  `⚠`** → ícone lucide **`TriangleAlert`** (pin explícito, NÃO o alias deprecado `AlertTriangle`;
  casa com `app/dashboard/error.tsx:5` e o `app/admin/error.tsx` planejado) + copy "Parâmetros
  sensíveis" verbatim.
  Eyebrows de campo `:60/:80/:106` `text-[10px]`→`text-eyebrow`(=) + `tracking-[0.14em]`→
  `tracking-label`(=). `:48` label toggle `text-[13px]`→`text-body`(=) (mantém htmlFor). `:49-55`
  checkbox → +ring de foco. Helper spans `:73/:99/:119` `text-[11px]`→`text-meta`(=). `:83-98`
  `<select effort>` → **Select** envolto em `<div className="max-w-aside">` (preserva `name="effort"`,
  `defaultValue`, `disabled={!enabled}`; some `w-80`/`text-sm`; texto 14→12 via primitivo; largura
  320→320 byte-idêntica; `:93` `<option>` já-token fica). Inputs `:71/:117` (maxTokens/temperature) →
  +ring + **`text-sm`→`text-body-sm`(~,14→12)**; mantém `w-80` stock + min/max. `:125` submit → +ring
  in-place + **`text-sm`→`text-label`(=,14)**. `:135` `text-[13px]`→`text-body`(=) (accent fica).
  `:137` `text-[13px]`→`text-body`(=) + **`text-red-500`→`text-destructive`**. `disabled={!enabled}`
  gating = funcional, preservar em tudo.

### `app/admin/predictions/[id]/page.tsx` (bare, dynamic) — 11 findings
- `:40` `max-w-[640px]`→`max-w-reading`(=). **`:42-54` header + back-link hand-rolled** → **PageHeading**
  (`backLink={{href:`/match/${match.id}`,label:"jogo"}}`, title "Override de settlement", subtitle
  `prediction · {prediction.id.slice(0,8)}`); mata o back-link inline (ganha ring/chevron;
  `text-[12.5px]`→`text-body-sm`; `pb-6`→`mb-6`). `:16-25` `Row` local → wrapper sobre **DefinitionRow**
  (`:19` label `text-[10.5px]`→`text-eyebrow`~ + `tracking-[0.14em]`→`tracking-label`=; `:22` value
  `text-[13px]`→`text-body`=). Eyebrows `:80/:108` `text-[10.5px]`→`text-eyebrow`(~) +
  `tracking-[0.14em]`→`tracking-label`(=) in-place. `:101` `text-[13px]`→`text-body`(=). TODA a copy
  PT-BR (`gols (90')`, `placar (provider)`, `override manual`, `sim/não`, etc.) verbatim; `notFound()`/
  query intocados.

### `app/admin/predictions/[id]/override-form.tsx` (client form, NOT dynamic; test-pinned class-agnostic)
- Eyebrows `:40/:52/:66` `text-[10px]`→`text-eyebrow`(=) + `tracking-[0.14em]`→`tracking-label`(=).
  `:48/:60` score inputs → +ring + **`text-sm`→`text-body-sm`(~,14→12 harmoniza com o select)**;
  mantém `w-24` stock + `type=number min={0} required`. `:69-79` `<select result>` → **Select**
  envolto em `<div className="max-w-aside">` (preserva `name="result"`, `defaultValue={defaultResult}`
  → o `<option selected>` que o teste checa continua; some `w-56`/`outline`/`text-sm`; texto 14→12 via
  primitivo; largura 224→320). `:82` `text-[12px]`→`text-body-sm`(=). `:91` submit → +ring in-place +
  **`text-sm`→`text-label`(=,14)**. `:98` `text-[13px]`→`text-body`(=). `:100` `text-[13px]`→`text-body`(=)
  + **`text-red-500`→`text-destructive`**. OVERRIDE_RESULTS/RESULT_LABEL/`name=`s verbatim.

### `app/admin/users/page.tsx` (bare, dynamic) — 19 findings
- `:28` `max-w-[640px]`→`max-w-reading`(=). `:29-34` header → **PageHeading** (BackLink href="/admin"
  label="admin"). `:40-46` search input → +ring + **`aria-label="buscar por e-mail"`** (hoje só
  placeholder); `text-[13px]`→`text-body`(=); `tracking-tight` stock fica. `:47` submit "buscar" →
  +ring. `:49` `text-[12.5px]`→`text-body-sm`(~). `:56` `<p>Nenhum usuário.</p>`
  `text-[13px]`→`text-body`(=) (mantém `<p>`; flag EmptyState). `:63` list `<Link>` row → +ring.
  `:65` `text-[13px]`→`text-body`(=). **`:70` badge bloqueado**: `bg-red-500/10`→`bg-destructive/10`,
  `text-red-500`→`text-destructive`, `text-[10px]`→`text-eyebrow`(=), `tracking-[0.12em]`→
  `tracking-label`(~) (in-place, mantém rounded-sm). `:74` role badge `text-[10px]`→`text-eyebrow`(=)
  + `tracking-[0.12em]`→`tracking-label`(~). `:77` ChevronRight já-lucide (sem mudança).
  `action="/admin/users"`/`name="q"`/hrefs verbatim.

### `app/admin/users/[userId]/page.tsx` (DesktopShell, dynamic) — 11 findings
- `:72` `max-w-[1040px]`→`max-w-content`(=). **`:75-82` header INLINE** (NÃO PageHeading): h1 `:76`
  `text-[28px]`=outlier comentado, `leading-[1.05]`→`leading-none`, `tracking-[-0.035em]`→
  `tracking-tight`, `lg:text-[32px]`→`lg:text-display-lg`; subtítulo `:79` `text-[13.5px]`→`text-body`(~)
  (`tracking-tight`+muted ficam); BackLink href="/admin/users" label="usuários" (consumir). **`:91-104`
  empty hand-rolled** → **EmptyState** em Card (dec.4; `max-w-[380px]`→`max-w-form`, título `text-[15px]`
  vira o `text-label`(14) do primitivo, sub `text-[13px]` vira o `text-body-sm`(12) do primitivo — NÃO
  `text-body`/13 (correção review lens B); ícone Inbox + copy preservados). Eyebrow
  `:113` `text-[10.5px]`→`text-eyebrow`(~) + `tracking-[0.18em]`→`tracking-eyebrow`(=) in-place
  (mantém `flex items-baseline justify-between` + sibling count `:116` `text-[10.5px]`→`text-eyebrow`~).
  **Os imports de dashboard (KpiCards/MarketSegments/BankrollChart/PredictionsTable/DashboardFiltersBar)
  são CONSUMIDOS intactos — BANIDO editar.** Pluralização `:117` `{series.length===1?"":"s"}` = lógica,
  verbatim. auth/zod/notFound `:45-55` intocados.

### `app/admin/users/[userId]/user-admin-controls.tsx` (client subcomponent, NOT dynamic) — 14 findings
- `:21` `text-[12px]`→`text-body-sm`(=) (accent fica). `:23` `text-[12px]`→`text-body-sm`(=) +
  **`text-red-500`→`text-destructive`**. `:42-46` eyebrow h2 'controle de acesso'
  `text-[10.5px]`→`text-eyebrow`(~) + `tracking-[0.14em]`→`tracking-label`(=); subtítulo `:46`
  `text-[12px]`→`text-body-sm`(=) in-place (NÃO SectionLabel). Rows Role/Acesso `:54-59/:77-82`
  (flex-col + action) **token-swap in-place** (NÃO DefinitionRow): `:55/:78` `text-[13px]`→`text-body`(=),
  `:56/:79` `text-[10.5px]`→`text-eyebrow`(~). Botões `:65-71/:88-94` → +ring in-place (mantém
  outline + `disabled:opacity-50` self-protection); `:68/:91` `text-[12.5px]`→`text-body-sm`(~).
  Copy (Role/Acesso/permitido/revogado/"Tornar admin"/etc.) + `name="userId"`/`{state.error}` verbatim.

## Primitivas novas — specs

`components/admin/page-heading.tsx` (dec.1): server-safe (sem `"use client"`; só compõe BackLink +
h1 + p). Importa `BackLink`. Props `{backLink?, title, subtitle}`.

`components/admin/definition-row.tsx` (dec.2): server-safe. Importa `cn`. Props `{label, value,
className?}`. Frame `flex items-center justify-between border-b border-border py-2` + cn(className).

## loading/error — specs (dec.3)

- `app/admin/loading.tsx`: **`<div className="min-h-screen bg-background text-foreground">`** (wrapper
  OBRIGATÓRIO — correção review lens C: as 5 páginas bare TODAS têm `min-h-screen bg-background
  text-foreground` no topo, `page.tsx:31`/`costs:26`/`settings:19`/`predictions:?`/`users:?`; sem ele o
  cold-start pisca fundo errado + viewport curto) **>** `<div className="mx-auto w-full max-w-reading
  px-6 py-8">` + `Skeleton` back-link (`h-4 w-24`), h1 (`h-7 w-48`), subtítulo (`h-4 w-72 mt-2`), + 3-4
  blocos de conteúdo (`h-12`/`h-24 mt-N rounded-md`). Sem DesktopShell (páginas bare não têm shell).
- `app/admin/users/[userId]/loading.tsx`: `<DesktopShell><div className="mx-auto w-full max-w-content
  px-5 pb-16 pt-8 lg:px-8 lg:pt-10">` + header skeleton + grade KPI (`grid-cols-2 lg:grid-cols-4`) +
  blocos chart/tabela — espelha `app/dashboard/loading.tsx`. `DesktopShell` é async (await auth) e
  já é usado em loading (dashboard) sem problema.
- `app/admin/users/[userId]/[predictionId]/loading.tsx`: `<DesktopShell><div className="mx-auto w-full
  max-w-reading px-6 py-8">` + skeleton de detail — espelha `app/dashboard/[predictionId]/loading.tsx`.
- `app/admin/error.tsx`: cópia 1:1 de `app/dashboard/error.tsx` trocando copy ("Falha ao carregar o
  admin") e o Link de volta (`href="/admin"` label "Admin"). `"use client"`, Sentry, `max-w-narrow`,
  TriangleAlert warn-fg, Button reset.

## Testes (auditados — sem update; sem golden)

- `app/admin/predictions/[id]/__tests__/override-form.test.tsx` — `renderToStaticMarkup` +
  `toContain('value="push"/"won"/"lost"/"void"')`, `toContain("Push (devolve stake)")`,
  `toContain('name="homeScore"/"awayScore"')`, `toMatch(/<option[^>]*value="push"[^>]*selected/)`.
  **ZERO pin de classe.** Migrar pro Select mantém `<select name="result" defaultValue={defaultResult}>`
  + `<option>` nativos → o markup `<option … value="push" … selected>` continua (Select renderiza
  native select+option children). `name=`s/values/labels preservados → **passa sem update.**
- Nenhum outro teste importa arquivos admin. `odds-card-parity.golden` não cobre admin → **0 diff**.

## Ordem de execução (passos, menor risco → maior)

1. **Primitivas novas (sem consumidor ainda):** `components/admin/definition-row.tsx` +
   `components/admin/page-heading.tsx`. `pnpm typecheck` (sem uso → tree-shake; só garante compilação).
2. **loading/error (4 arquivos novos):** espelham dashboard; baixo acoplamento. `pnpm build` valida
   as fronteiras server/client.
3. **Token swaps puros tipo/tracking (leaf, sem cor/primitiva)** em todos os 10 arquivos editados —
   o grosso do mapa por-arquivo. Inclui os outliers comentados (`costs:166` 16px; `users/[userId]:76`
   28px).
4. **Cor semântica:** `text-red-500`→`text-destructive` (×5: default-model:78, generation-params:137,
   override:100, user-admin:23, users badge:70 + bg); banner âmbar→warn (generation-params:37-40); glifo
   `⚠`→lucide (generation-params:39).
5. **Foco visível (a11y):** rings in-place em todos os controles custom (nav links, list rows, search
   input+aria-label, buscar/submit buttons, score/number inputs, checkbox, role/access buttons).
6. **Select (3 call-sites):** default-model:37-57, generation-params:83-98, override:69-79 — preservar
   name/defaultValue/disabled; constranger largura.
7. **PageHeading nos 5 bare + DefinitionRow em predictions/costs/settings + EmptyState em users/[userId]
   + heading inline de users/[userId]:** o maior diff estrutural, por último.
8. **Verificação completa** (tríade + build + grep gates + /impeccable owner).

> Cada passo é um diff coeso; nenhum toca fora da allowlist. 1 agente/arquivo na implementação.

## Verificação

Tríade + build, nesta ordem, TODAS verdes: `pnpm typecheck && pnpm lint && pnpm test
--no-file-parallelism && pnpm build` (`--no-file-parallelism` obrigatório local — flake pglite
8-core; CI 2-core sem o flag). Guardas extras:
- **Grep anti-resíduo (gate de completude):** nos 10 arquivos editados pós-edit,
  `grep -E 'text-\[[0-9]|tracking-\[[0-9.]+em\]|rounded-\[[0-9]|shadow-\[|amber-|emerald-|sky-|red-[0-9]|#[0-9a-f]{3,6}|\btext-sm\b'`
  → **0 hits**, EXCETO os 2 outliers comentados (`costs:166` 16px, `users/[userId]:76` 28px) e
  `ring-[3px]` sancionado. **`text-sm` incluído no padrão** (review lens A/B): deve zerar (selects→
  primitivo body-sm, number inputs→body-sm, submits→label). (`w-80/w-56/w-24` são stock e funcionais
  → NÃO casam o padrão, mantidos de propósito.)
- **Grep `var(--color-`:** 0 hits em runtime (não há chart/inline-style novo aqui, mas confirmar).
- **Golden:** `pnpm test odds-card-parity.golden` → 0 diff, sem `-u`.
- **Diff apresentação-only:** zero mudança em query/action/permissão/copy/dado; `layout.tsx` e
  `[predictionId]/page.tsx` intocados (git diff vazio neles).
- **Worktree guard:** confirmar checkout na branch da feature (não `main`, não órfão em
  `.claude/worktrees/`).
- **Visual `/impeccable` (admin auth-gated → owner LOGADO no preview):** light/dark + mobile/desktop:
  (a) header unificado (display-md 26 nas bare; 28/lg:32 no user-detail); (b) banner warn (âmbar→token)
  + ícone lucide; (c) Selects nativos estilizados (foco + color-scheme + chevron) abrindo em ambos os
  temas; (d) foco visível de teclado em TODO controle (links/inputs/selects/checkbox/buttons); (e)
  badge bloqueado em destructive; (f) DefinitionRow nas listas de costs/settings/predictions; (g)
  EmptyState do user-detail; (h) cold-start mostra skeleton de idioma-correto sem CLS nas 3 famílias;
  (i) error boundary admin; (j) par success(accent)/error(destructive) consistente. **"Fecha #324"
  PT-BR NÃO auto-fecha** → fechar a issue manual após merge verde.

## Desvios conscientes do texto da issue

- **`PageHeader` → `PageHeading`** (nome novo): a `PageHeader` da issue colide com a primitiva de
  shell mobile existente; criamos com nome distinto, admin-scoped. E o user-detail (DesktopShell) NÃO
  entra no PageHeading (idioma diferente, inline — espelha dashboard).
- **`DefinitionRow` cobre só 2 das 3** "reimplementações" (predictions+costs/settings); user-admin é
  flex-col+action (forma distinta) → in-place. O censo provou que não são a mesma linha.
- **loading/error = 3+1, não 7+7**: cascata do App Router + precedente dashboard satisfazem a intenção;
  per-route literal seria duplicação. **Flag pro owner.**
- **`w-80/w-56/w-24` mantidos** (stock-scale funcional, não `w-[Npx]` arbitrário); o de-slop real é
  ring + Select, não width. **Flag pro owner.**
- **Botões/inputs raw: foco in-place, sem migrar pra Button/Input** (preserva inverted-fill/border
  intencional; parity > convenção ADR §B). Badge bloqueado: cor in-place, sem Badge primitivo (preserva
  rounded-sm). **Flag /impeccable.**
- **SectionLabel/Label NÃO consumidos** (tracking 0.18em + px-5 gutter / layout horizontal não casam
  os eyebrows in-flow do admin) — token-swap in-place.
- **`costs:166` 16px e `users/[userId]:76` 28px = outliers comentados** (sem degrau; espelha política
  heroic-display #246/#322), não colapsados nem token novo.

## Questões em aberto pro owner (flags — defaults propostos)

1. **loading/error topology:** default **3 loading + 1 error** (cascata + precedente dashboard).
   Alternativa: 7+7 per-route literal. → default proposto, flagado.
2. **Larguras de campo `w-80/w-56/w-24`:** default **manter** (stock-scale funcional) + ring/Select.
   Alternativa: `w-full max-w-*`. → default proposto.
3. **Empty de `users/page.tsx`** ("Nenhum usuário."): default `<p>` tokenizado. Alternativa: EmptyState
   (como predictions-table #322). → /impeccable decide.

## Ressalvas do review 4-lentes (incorporadas)

Review adversarial de 4 lentes (escopo/paridade · token/ADR · teste/golden/CLS · a11y/Next) rodado
read-only contra o código real. **Confirmações sólidas:** allowlist correta; `layout.tsx` é só gate;
`[predictionId]/page.tsx` delega 100% pro banido; Select preserva semântica de form (name/defaultValue/
disabled por-option); dropar `[color-scheme]` não perde nada (Select supre); teste override-form passa
sem update; 3+1 loading/error casa o precedente dashboard; **todos os tokens citados existem** no
`@theme`. **Folds aplicados:** (1) adotar Select **encolhe texto 14→12** — documentado + number inputs
harmonizam pra 12; (2) largura do Select via **wrapper `max-w-aside`**, nunca `className` (descola a
chevron); (3) `app/admin/loading.tsx` ganha o wrapper `min-h-screen bg-background text-foreground`;
(4) política `text-sm` explícita (eliminar; grep-gate passa a vigiar); (5) EmptyState desc = `text-body-sm`(12)
não body(13), título 15→`text-label`(14); (6) banner âmbar tem **2** cores âmbar (`:37` e `:40`) → warn-fg;
(7) `page.tsx:49` só font-size (sem tracking); (8) pin `TriangleAlert`; (9) reword `[predictionId]` (intocado).

## Fora de escopo (NÃO fazer)

Qualquer action/query/permissão/cálculo/rota/auth. Editar `app/admin/layout.tsx`,
`users/[userId]/[predictionId]/page.tsx` (só nasce o loading), `ui/*`, `empty-state`, `back-link`,
`section-label`, `page-header`, `wordmark`, `nav-link`, `team-avatar`, `globals.css`,
`components/dashboard/*`. Cunhar token. Mudar copy/dado/option-values. Migrar outras superfícies.
Re-snapshot de golden. Forçar Button/Input/Badge/SectionLabel/Label onde a parity quebra.
