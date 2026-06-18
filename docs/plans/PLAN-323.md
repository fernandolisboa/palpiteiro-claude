# PLAN — #323: de-slop das superfícies de entrada (/signin · /como-funciona · home) — fatia 4

> Plano de implementação (artefato histórico, snapshot 2026-06-18). Fatia 4 do épico **#320**.
> Herdeiro da fundação **#321** (ADR 0029, MERGED, PR #327 — fonte da verdade de tipo/tracking/
> largura/motion no `@theme`) e da **#246** (match page, referência viva, MERGED) + precedente da
> **#322** (dashboard). Adota tokens/primitivas que a fundação criou; **não re-deriva nem cunha
> token** (banido pela ADR 0029 — sem `--text-*`, `--tracking-*`, `--color-*`, `--space-*` novos).
> Derivado de censo read-only (4 agentes) + este plano + **review adversarial de 4 lentes** (escopo/
> data-parity, token-fidelity/ADR-0029, test/golden-safety, a11y/coerência-visual — todas **approve**,
> zero blocker; refinamentos dobrados abaixo). **Entry-surface-only** (signin/como-funciona/home
> chrome). Registra as decisões finais, incluindo desvios conscientes do texto da issue.

## Princípio

Só **apresentação**, zero mudança funcional, **paridade de dados** preservada (todos os números do
exemplo de como-funciona são byte-exatos por contrato; toda copy de signin/home verbatim), sem
regressão. **A ÚNICA mudança de copy permitida** é o tagline obsoleto do signin (`· over/under 2.5`).
Conduzido via `/impeccable`. A fundação (#321) é a fonte da verdade no `@theme` de `app/globals.css`;
aqui só **roteamos classes** pros tokens e **consumimos** as primitivas. **A cor já é disciplinada
nestas telas** (text-edge-fg/warn-*/muted-fg-2/border-border — zero cor crua); o desvio que esta fatia
corrige é **tipografia / tracking / raio / espaço / a11y (focus rings + aria-hidden)**, não cor.

## Escopo (allowlist — os ÚNICOS 6 arquivos que podem mudar + este plano)

- `app/page.tsx` (HOME — **só chrome próprio**: h1, subtítulo, empty states, eyebrows de seção,
  layout, links "ver todas", aria-hidden nos Inbox; reconciliar a duplicação MobileHome/DesktopHome
  fazendo o DesktopHome **CONSUMIR** o primitivo `SectionLabel` como o MobileHome já faz)
- `app/signin/page.tsx` (**SÓ o tagline obsoleto**: `Wordmark suffix="· over/under 2.5"` → `"· edge
  multi-mercado"`)
- `app/signin/sign-in-methods.tsx` (tokens + checkbox `rounded-[4px]`→`rounded-sm`; hierarquia de gap
  intencional; preservar `text-destructive` no erro + toda copy verbatim)
- `app/signin/passkey-signin-button.tsx` (tokens arbitrários)
- `app/como-funciona/page.tsx` (wordmark inline hand-rolled → `<Wordmark suffix=… />` consumindo o
  primitivo; container → `max-w-reading`)
- `app/como-funciona/como-funciona-content.tsx` (`text-[Npx]`→escala; trackings de eyebrow ad-hoc
  unificados a UM token; boxes `rounded-lg`→`rounded-xl`; ritmo de seção `pt-8 mt-8` consistente incl.
  a primeira seção ~35; focus rings nos anchors)
- + este plano (`docs/plans/PLAN-323.md`).

## NÃO tocar (consumir/referência — desvio consciente da lista literal da issue, ver §"Desvios")

`components/back-link.tsx` (sharedBeyondEntry: admin/perfil/dashboard/como-funciona; **já tokenizado**;
`ring-[3px]` é o padrão shadcn sancionado pela ADR:114, **NÃO** é violação; `back-link.test.tsx` pina
`text-body-sm`/`text-muted-foreground`/`mb-6`/`size-3.5` — editar quebraria o pin **e** vazaria
cross-surface). `components/section-label.tsx` (compartilhado com dashboard prediction-detail; receita
canônica de eyebrow, zero violação — **CONSUMIR** no DesktopHome pra matar a duplicação, nunca editar).
`components/page-header.tsx` (já migrado, zero arbitrário; não amplamente compartilhado mas nada a
corrigir). `components/wordmark.tsx` (já migrado pela #321; **só** a COPY do sufixo no call-site do
signin muda, **não** o componente). `components/empty-state.tsx` (fundação; **consumir** na home,
nunca editar). `components/help-hint.tsx` (link inline canônico do glossário; **referência de receita**
pro focus ring dos anchors de como-funciona, ver decisão 10 — nunca editar). `components/ui/*`,
`app/globals.css` (fundação; renomear/remover um token `@theme` quebraria o golden + as suítes de
token-sharing). **Qualquer** componente de feed/grade/conteúdo: `odds-card`, `match-row`,
`upcoming-matches-{mobile,desktop}`, `date-range-tabs`, `league-tabs`, `recent-pred-card`,
`desktop-status-cell` (issue **#331**); `analysis-*` (issue **#246**); `glossary-section`/`help/*`
(conteúdo de glossário — só consumido por como-funciona-content, fora do escopo de chrome).

## Vocabulário herdado (referência rápida — NÃO cunhar nada)

Tipografia (font-size only, leading herda → swap byte-idêntico onde o px casa): `text-eyebrow-xs`(9)
`text-eyebrow`(10) `text-meta`(11) `text-body-sm`(12) `text-body`(13) `text-label`(14)
`text-display-sm`(18) `text-display-md`(26) `text-display-lg`(32). Tracking: `tracking-label`(0.14em,
eyebrow/badge mono uppercase — absorve 0.16/0.14/0.12/0.04em ad-hoc), `tracking-eyebrow`(0.18em,
section-label/marca/sufixo), `tracking-tight` (stock, absorve a banda negativa -0.04/-0.035/-0.03/
-0.02em). Raio: `--radius`=0.625rem=10px → `rounded-sm`=6px, `rounded-md`=8px, `rounded-lg`=10px,
`rounded-xl`=14px (`rounded-[Npx]` banido). Largura: `max-w-reading`(640) `max-w-form`(380)
`max-w-narrow`(480) `max-w-content`(1040). Foco visível: `focus-visible:outline-none
focus-visible:ring-[3px] focus-visible:ring-ring/50` (+`rounded-sm` onde couber; BackLink:8 é o
template). Primitivas a consumir: `Wordmark` (marca display-sm + sufixo mono text-eyebrow
tracking-eyebrow text-muted-fg-2 uppercase), `SectionLabel` (eyebrow canônico, recebe `action`),
`EmptyState` (ícone+título text-label+desc text-body-sm muted+ação, `max-w-narrow`+`py-12` base,
override via `className`).

## Meios-pixels: convenção de rótulo (lente token-fidelity)

Por consistência de leitura: **byte-idêntico** = o px casa EXATO um degrau da escala (10/11/13/14/26/32).
**Colapso de meio-pixel** = o valor `.5` cai pro inteiro do degrau, mudança sub-pixel imperceptível,
sancionada pela ADR §A.1 (meios-pixels banidos no token): `13.5→13` (body), `12.5→12` (body-sm),
`11.5→11` (meta), `10.5→10` (eyebrow). Toda referência a esses `.5` abaixo é colapso de meio-pixel,
não match exato — mesmo onde o texto escreve só "11.5→meta".

## Decisões globais (cross-file) e micro-decisões resolvidas

### 1. Tagline obsoleto do signin → `· edge multi-mercado` (a ÚNICA mudança de copy da fatia)

`app/signin/page.tsx:32` `<Wordmark suffix="· over/under 2.5" />` → `<Wordmark suffix="· edge
multi-mercado" />`. **Justificativa:** (a) o produto pivotou (ADR 0015) pra **motor de seleção de edge
multi-mercado** — over/under 2.5 é só o PRIMEIRO mercado do Tier 1, não o único; pinar a marca em
"over/under 2.5" subvende o produto e é factualmente obsoleto (Wordmark JSDoc + ADR 0029:124-125
deixaram explicitamente esse texto "pro #323"). (b) **Alinha com a linguagem de marca JÁ existente do
shell**: `desktop-shell.tsx:26` usa `suffix="v0 · edge multi-mercado"` (verbatim, confirmado) e a
`HOME_SUBTITLE` é "Edge multi-mercado — análise sob demanda." — adotar `· edge multi-mercado` no signin
dá consistência cross-shell (signin é a porta de entrada; ver o mesmo descritor no shell autenticado
fecha o loop de marca) **reusando copy que já existe**, sem inventar texto novo. (c) O owner escolheu um
**descritor multi-mercado** (não a alternativa `· v0` nem o sufixo vazio). Mantém o `·` líder pra
paridade de forma com o shell. Tipografia/tracking JÁ corretos via o primitivo Wordmark (display-sm +
sufixo text-eyebrow tracking-eyebrow text-muted-fg-2 uppercase) — **nada de className muda, só o valor
da prop `suffix`**.
**FLAG /impeccable + veto do owner (load-bearing — NÃO pular):** esta é a única mudança de copy de toda
a fatia. **NOTA da lente escopo:** o lean do censo era a opção A (`· v0`, paridade cross-shell com
page-header) ou C (sem sufixo, mais quieto), com cautela contra strings single-market OU lista-longa-de-
mercados; `· edge multi-mercado` é uma opção-B sancionada (casa verbatim com `desktop-shell.tsx:26` e
com a HOME_SUBTITLE) mas **diverge do lean do censo** → o veto do owner no preview é obrigatório, não
cerimonial. Alternativas sancionadas se vetar: `· v0` (paridade literal com page-header) ou
`<Wordmark />` sem sufixo (signin mais quieto). Nenhum teste pina esse sufixo (confirmado: zero teste
importa `signin/page`).

### 2. Home h1 — par responsivo (tipo/leading/tracking)

- **MobileHome `:222`** `text-[26px] font-medium leading-[1.05] tracking-[-0.03em]` → `text-display-md
  font-medium leading-none tracking-tight`. (26→display-md byte-idêntico no size; `leading-[1.05]`→
  `leading-none` per ADR §A.1; banda negativa `-0.03em`→`tracking-tight`.)
- **DesktopHome `:302`** `text-[32px] font-medium leading-[1] tracking-[-0.035em]` → `text-display-lg
  font-medium leading-none tracking-tight`. (32→display-lg byte-idêntico; `leading-[1]`→`leading-none`;
  `-0.035em`→`tracking-tight`.)
- **Justificativa:** o par 26/32 é EXATAMENTE display-md/display-lg (ADR escolheu display-md=26
  deliberadamente pra casar com o "Próximos jogos" do home — ADR:73-76). Swap de size byte-idêntico;
  só `leading-*` e `tracking-*` mudam de ad-hoc pra token, ambos absorvidos sem shift visível. Sem
  skeleton acoplado na home (não há `loading.tsx`-pair de h1 com token de texto pro home).

### 3. Home subtítulos e empty-state copy (tipo)

- MobileHome `:225` `text-[13px] text-muted-foreground tracking-tight` → `text-body …` (13→body
  byte-idêntico; `tracking-tight` fica).
- DesktopHome `:305` `text-[13.5px] text-muted-foreground tracking-tight` → `text-body …` (13.5→body =
  colapso de meio-pixel; `tracking-tight` fica).
- "Nenhuma predição ainda." MobileHome `:276` + DesktopHome `:351` `text-[12.5px] text-muted-foreground
  tracking-tight` → `text-body-sm …` (12.5→body-sm; `tracking-tight` fica). Copy verbatim.

### 4. Home empty states (ambos os ramos) → primitivo `EmptyState` (consumir; reconciliar a assimetria)

O censo expõe uma **assimetria mobile/desktop** no empty-state de "nenhum jogo": título 14px (mobile
`:248`) vs 15px (desktop `:326`); detalhe 12.5px (`:251`) vs 13px (`:329`); ícone `size-9` (`:245`) vs
`size-10` (`:324`); `max-w-[240px]` (`:251`, no span do detalhe) vs `max-w-[360px]` (`:322`, no
container). **Reconciliar via UM uso compartilhado do `EmptyState`** em ambos os ramos:

```
<Card className="mx-5"> {/* mobile */}  |  <Card className="px-8 py-16 text-center"> {/* desktop */}
  <EmptyState
    className="py-6"               {/* aninhado em Card → corta o py-12 shell-grade (precedente #246/#322) */}
    icon={<Inbox aria-hidden="true" className="size-10" strokeWidth={1.25} />}
    title={empty.title}
    description={empty.detail}
  />
</Card>
```

- **Tipo (vem do primitivo, de-slop aceito):** título → `text-label`(14) + `tracking-tight` + medium;
  desc → `text-body-sm`(12) + muted + `tracking-tight`. Isso **colapsa** os dois títulos (14/15) pra um
  só (14, alinhado ao 14px do mobile — "unifica pra baixo" SÓ aqui porque 15 é título de empty-state,
  não número-herói; precedente #322 decisão 6) e os dois detalhes (12.5/13) pra `text-body-sm`(12).
- **Estrutura DOM (de-slop aceito, lente a11y/visual):** o primitivo renderiza título/desc como `<p>`
  (não `<span>`) e embrulha os dois num inner `<div className="flex flex-col gap-1.5">`
  (empty-state.tsx:28). **Dois deltas visíveis** a inventariar (ambos são o primitivo virando fonte da
  verdade): (i) **gap interno título↔desc:** mobile hoje é `gap-1` (`:247`), desktop é flat sem wrapper
  → vira `gap-1.5` (+2px) nos dois ramos; (ii) **elemento `span`→`p`** (sem mudança de copy/dados, só
  semântica de bloco). Ambos sem impacto de paridade de dados; **listados no checklist /impeccable**
  pra ninguém ler como diff inesperado.
- **Ícone:** unificar em `size-10` (escolho o maior — desktop; o ícone é decorativo e o empty mobile
  fica num Card de largura quase-cheia, `size-10` lê bem nos dois; `strokeWidth={1.25}` preservado).
- **Largura:** o `EmptyState` base é `max-w-narrow`(480). Mobile hoje tinha `max-w-[240px]` no SPAN do
  detalhe (não no container) e desktop `max-w-[360px]` no container. **Deixar o `max-w-narrow`(480) do
  primitivo governar** nos dois (o Card mobile é `mx-5` então o 480 é clampado pelo viewport; o desktop
  ganha +120px de largura de texto, de-slop aceito — centraliza igual). **Conferir no /impeccable que o
  bloco centralizado não fica largo demais em viewport grande.** Se o owner quiser preservar a geometria
  estreita do desktop, override `className="max-w-form py-6"` (380) — entrega base é `max-w-narrow`.
- **a11y:** o `EmptyState` já embrulha o ícone em `<span className="text-muted-fg-2">{icon}</span>`
  (preserva a cor terciária dos `:244`/`:323`); o primitivo **NÃO** adiciona `aria-hidden` sozinho (só
  embrulha `{icon}`) → o call-site **DEVE** passar `aria-hidden="true"` no `<Inbox>` (decorativo; o
  significado vem do `empty.title` adjacente). Confirmado: a responsabilidade é do consumidor.
- **Copy:** `empty.title` / `empty.detail` passados verbatim (vêm de `rangeEmptyMessage(range)` em
  `lib/view/range-href.ts`, inalterado — nunca inlinados).
- **Imports:** adicionar `EmptyState` ao import block; `Inbox`/`Card` seguem usados (Inbox no ícone,
  Card no wrapper) → sem import órfão; `pnpm lint` é o guarda.

### 5. DesktopHome header de "recentes" inline (re-implementa SectionLabel à mão) → consumir `SectionLabel`

DesktopHome `:338-349` re-implementa à mão o que o MobileHome `:262-273` já obtém do primitivo
`SectionLabel`: um `<div flex items-baseline justify-between pb-3>` com eyebrow inline (`:340`
`font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground`) + Link "ver todas →"
inline (`:343-348`, mesmas classes). **Substituir o bloco inteiro `:338-349` por `<SectionLabel>`** com
o mesmo `action` que o MobileHome já usa:

```
<div className="pt-12">
  <SectionLabel
    action={
      <Link href="/dashboard" className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-sm">
        ver todas →
      </Link>
    }
  >
    Suas predições recentes
  </SectionLabel>
  ...
```

- **Justificativa:** mata a duplicação que o censo aponta como o achado estrutural #1 da home;
  satisfaz o "DesktopHome CONSUME the SectionLabel primitive like MobileHome does".
- **Mudança consciente de gutter/ritmo no desktop (DOIS deltas, lentes token + a11y):** o `SectionLabel`
  tem `px-5 pt-1 pb-2`. O desktop hoje está dentro do container `max-w-[1040px] px-8` e o header inline
  tinha `pb-3` (sem `px-5`). Ao adotar `SectionLabel` dentro do container px-8: (i) o eyebrow ganha um
  `px-5` adicional → **recua 20px do gutter do container**; (ii) o ritmo de baseline muda de `pb-3` pra
  `pt-1 pb-2` (shift pequeno). Ambos são espaço **hand-tuned** (ADR sem token de espaço). **FLAG
  /impeccable:** se o eyebrow desalinhar com a grade de cards do `UpcomingMatchesDesktop`, a saída é não
  usar SectionLabel no desktop e só tokenizar o bloco inline (`text-[10.5px]`→`text-eyebrow`,
  `tracking-[0.18em]`→`tracking-eyebrow` nas duas spans) — **mas a entrega base consome o primitivo**
  (intenção da issue).
- **NOTA de paridade de casing (lente escopo — guard ao editar):** o desktop inline tinha children
  `"suas predições recentes"` minúsculo + `uppercase` na classe; o `SectionLabel` aplica `uppercase`
  internamente. **O implementador DEVE passar children `"Suas predições recentes"`** (exatamente como o
  MobileHome) → render byte-idêntico (uppercase nos dois) e paridade com o mobile. Não introduzir drift
  de casing/texto visível. Nenhum teste pina essa copy (confirmado).
- **Foco:** o Link "ver todas →" (ambos os ramos, `:266` mobile e `:345` desktop) hoje só tem
  `hover:text-foreground`, **sem `focus-visible`**. Adiciono `focus-visible:outline-none
  focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-sm` nos dois (no MobileHome `:266`
  diretamente; no desktop via o novo `action`). Tokenizar o eyebrow do link mobile: `text-[10.5px]`→
  `text-eyebrow`, `tracking-[0.18em]`→`tracking-eyebrow` (recipe do SectionLabel).

### 6. Home — ritmo entre feed e recentes (`pt-7` vs `pt-12`) — flag, NÃO token

MobileHome `:261` `<div className="pt-7" />` vs DesktopHome `:338` `pt-12`: dois gaps diferentes pro
mesmo break de seção. **ADR 0029 NÃO tem token de espaço** (só type/tracking/width/motion) → isto é
ajuste de ritmo **hand-tuned**, não roteamento de token. **Prioridade média/baixa.** Não unifico os
dois num valor único cegamente (mobile e desktop legitimamente têm ritmos diferentes); só registro como
item de consistência pro `/impeccable` julgar antes/depois. **Default: manter pt-7 (mobile) / pt-12
(desktop)** salvo veredito visual do owner. (Mesmo critério da #322 §"NOTE: spacing-rhythm".)

### 7. signin/sign-in-methods — tokens + checkbox radius + hierarquia de gap

- **Raio:** `:48` checkbox `Checkbox.Root` `rounded-[4px]` → `rounded-sm` (ADR bane `rounded-[Npx]`;
  4px não tem degrau exato — `rounded-sm`=6px é +2px, **flag /impeccable** num checkbox `size-4`=16px
  onde +2px de raio é perceptível; sem degrau menor). O focus ring do checkbox (`:49`) já está correto
  (`focus-visible:ring-[3px] focus-visible:ring-ring/50`) — **não tocar**.
- **Tipo:** `:57` declaração 18+ `text-[12.5px] leading-snug tracking-tight text-muted-foreground` →
  `text-body-sm …` (12.5→body-sm; `leading-snug`+`tracking-tight` ficam). `:77` divider "ou"
  `text-[10px] tracking-[0.14em]` → `text-eyebrow tracking-label` (10→eyebrow byte-idêntico;
  0.14em→tracking-label byte-idêntico). `:86` eyebrow "e-mail" `text-[10px] tracking-[0.14em]` →
  `text-eyebrow tracking-label`. `:101` erro `text-[12.5px] text-destructive tracking-tight` →
  `text-body-sm text-destructive tracking-tight` (**`text-destructive` PRESERVADO** — pin negativo no
  teste `not.toContain("text-destructive")` é sobre o ramo SEM erro; a classe vive só dentro do bloco
  `{errorMessage && (...)}` `:100-104`, confirmado, e o ramo SEM erro continua sem ela). `:108` nota de
  spam `text-[11.5px] text-muted-fg-2 tracking-tight` → `text-meta …` (11.5→meta, colapso de
  meio-pixel).
- **Hierarquia de gap (intencional, NÃO token):** o stack usa um ladder ad-hoc de 4 degraus
  (`gap-6` outer `:38`, `gap-3` form `:84`, `gap-2.5` checkbox label `:43`, `gap-1.5` field label
  `:85`). ADR não tem token de espaço → mantenho **hand-tuned**, mas torno a hierarquia **intencional e
  consistente** com o passkey-button (que usa `gap-3`/`gap-1.5` — decisão 8). **Prioridade
  média/baixa.** Não colapso os 4 degraus; só confirmo que a relação outer(6) > form(3) > label(1.5) é
  coerente. **Flag /impeccable.** Copy verbatim em TUDO ("Declaro ter 18 anos ou mais.", "Entrar com
  Google", "Enviar link de acesso", divider "ou", "e-mail", placeholder, nota de spam).

### 8. signin/passkey-signin-button — tokens

- `:68` eyebrow "e-mail (passkey)" `text-muted-foreground font-mono text-[10px] tracking-[0.14em]
  uppercase` → `text-muted-foreground font-mono text-eyebrow tracking-label uppercase` (10→eyebrow;
  0.14em→tracking-label). **Manter a ordem de classe local** (minimiza o diff; ordenação é cosmética/
  harmless). `:89` erro `text-destructive text-[12.5px] tracking-tight` → `text-destructive text-body-sm
  tracking-tight` (12.5→body-sm; `text-destructive` preservado). Copy verbatim ("e-mail (passkey)",
  "Verificando…", "Entrar com passkey", strings de erro). Os primitivos `Input`/`Button` já têm focus
  ring próprio → nada a fazer; não há Link inline → sem issue de foco.

### 9. como-funciona/page.tsx — wordmark inline hand-rolled → `<Wordmark suffix=… />` (consumir o primitivo)

`:27-34` hoje é uma marca à mão (`:28` `text-[17px] font-semibold tracking-[-0.04em]` "palpiteiro" +
`:31-33` sufixo inline `hidden font-mono text-[10px] uppercase tracking-[0.18em] text-muted-fg-2
sm:inline` "como funciona") dentro de um wrapper `<div className="flex items-baseline gap-3">` (`:27`).
**Substituir o bloco inteiro pelo primitivo:**

```
<Wordmark
  suffix="como funciona"
  suffixClassName="hidden sm:inline"
/>
```

- **Justificativa:** satisfaz o critério "Wordmark único nas 3 superfícies" (ADR §B) por **CONSUMO**
  do primitivo. O primitivo renderiza a marca a `text-display-sm`(18px) + `tracking-tight` +
  `font-semibold` — **unifica os 3 tamanhos de marca** (17 aqui / 18 shell / 20 antigo signin → 18);
  17→18 é o colapso "pra cima" sancionado pela ADR (§A.1, ADR:144). O sufixo via primitivo já é
  `font-mono text-eyebrow tracking-eyebrow text-muted-fg-2 uppercase` — **byte-idêntico em cor/peso/
  tracking ao inline atual** (o inline usa text-muted-fg-2; tracking-[0.18em]=tracking-eyebrow; size
  10→eyebrow byte-idêntico). O `hidden … sm:inline` (única visibilidade não-default a preservar) vai via
  `suffixClassName="hidden sm:inline"` — **espelha exatamente o que desktop-shell.tsx:27 faz**.
- **Mudança de gap consciente:** o wrapper inline é `gap-3` (`:27`); o Wordmark usa `flex items-baseline
  gap-2` interno. Ao adotar o primitivo, o gap marca↔sufixo vai de `gap-3` pra `gap-2` (−4px). De-slop
  aceito (gap-2 é o canônico do Wordmark em todos os call-sites). **Flag /impeccable.** O `<header>`
  externo (`:26`) e o `ThemeToggle` (`:35`) ficam intactos; só o `<div className="flex items-baseline
  gap-3">…</div>` interno vira `<Wordmark/>`.
- **Import:** adicionar `import { Wordmark } from "@/components/wordmark";`.
- **Container:** `:38` `max-w-[640px]` → `max-w-reading` (byte-idêntico, 640=640). `BackLink`
  (`:39`) **consumido inalterado** (já tokenizado, já tem ring; não tocar — ver §"NÃO tocar").

### 10. como-funciona-content.tsx — tokens + eyebrows unificados + raio dos boxes + ritmo + focus rings

O arquivo mais denso. **Cor JÁ disciplinada** (text-edge-fg/warn-*/muted-fg-2/border-border/
decoration-border-strong — não tocar). **Toda a copy é load-bearing** (números EXATOS por contrato em
`como-funciona-page.test.tsx`; headings, ids `mercado-*`, âncoras do glossário pinados) — preservar
byte-a-byte.

**Tipo (mapear pra escala; todos byte-idênticos ou colapso de meio-pixel):**
- `:13` h1 `text-[20px] font-medium tracking-[-0.02em]` → `text-display-md font-medium tracking-tight`
  (20→display-md=26, "unifica pra cima" h1 alinhando com a home — ADR:79; `-0.02em`→tracking-tight).
  **Mudança de tamanho real (+6px)** — flag /impeccable; é a política da ADR de unificar h1 de 20px pra
  display-md. Copy "Como funciona" verbatim (pin do teste).
- h2 das 6 seções `:37,:65,:161,:359,:448,:458` `text-[16px] font-medium tracking-[-0.02em]` →
  `text-display-sm font-medium tracking-tight` (16→display-sm=18, "unifica pra cima"; **+2px**, flag).
- h3 `:175,:256,:305` `text-[14px] font-medium tracking-tight` → `text-label font-medium
  tracking-tight` (14→label byte-idêntico).
- corpo `:16,:40,:68,:164,:178,:259,:308,:362,:465` `text-[13.5px] leading-relaxed … tracking-tight`
  → `text-body leading-relaxed … tracking-tight` (13.5→body, colapso de meio-pixel; leading/tracking
  ficam).
- listas dos boxes `:117,:209,:275,:328` `text-[13px] leading-relaxed … tracking-tight` → `text-body
  …` (13→body byte-idêntico).
- notas muted-fg-2 `:298,:351,:500` `text-[12.5px]` → `text-body-sm` (12.5→body-sm).
- nota do glossário `:449` `font-mono text-[11px] text-muted-foreground` (mono, NÃO uppercase, sem
  tracking) → `font-mono text-meta text-muted-foreground` (11→meta).
- badge 18+ `:461` `font-mono text-[11px] font-medium tracking-[0.04em]` → `font-mono text-meta
  font-medium tracking-label` (11→meta; 0.04em→tracking-label — normalize value-conscious do tracking
  de badge pro token dominante, espelha #246/#322; bg/border `warn-*`+`rounded-md` já tokenizados).

**Eyebrows dos boxes de exemplo — unificar a UM token (decisão por PAPEL, não por proximidade):** os 4
eyebrows `:114,:206,:272,:325` usam `font-mono text-[10.5px] uppercase tracking-[0.16em]
text-muted-foreground`. A issue cita "0.16/0.18/0.14em ad-hoc → unify". **Decisão: `tracking-label`
(0.14em), NÃO `tracking-eyebrow`(0.18em).** **Justificativa (decisão de PAPEL, não de valor mais
próximo — 0.16em é EQUIDISTANTE entre 0.14 e 0.18):** estes são eyebrows de **caption de box** (rótulo
mono uppercase de exemplo), o mesmo papel "badge/eyebrow mono uppercase" que a ADR mapeia pra
`tracking-label` (0.14em, o valor dominante, 62 usos — ADR:81-82, precedente #246 ADR:168).
`tracking-eyebrow`(0.18em) é reservado pra **marca / section-label / header de página** (Wordmark
sufixo, SectionLabel — papel de chrome de seção, não de caption interno). Size `text-[10.5px]` →
`text-eyebrow`(10). Aplicar nos 4. **CONTRASTE crítico (guard de implementação):** os eyebrows de
chrome de seção (Wordmark sufixo na decisão 9; SectionLabel "Suas predições recentes" da home; estes
NÃO estão neste arquivo) ficam em `tracking-eyebrow`(0.18em) — **não "arredondar pro mais próximo" os
0.18em da home pra tracking-label**; o split caption→label / section-label→eyebrow é o ponto sutil a
acertar. (NOTA: o "0.18em" e "0.14em" que a issue lista como "os 3 trackings" são, no arquivo real, o
eyebrow dos boxes a 0.16em (x4) — confirmado no censo.)

**Raio dos boxes de exemplo:** `:113,:205,:271,:324` `border-border bg-surface-2 mt-5 rounded-lg border
p-4` → `rounded-xl` (casa com o primitivo `ui/card.tsx:10` `rounded-xl`, confirmado). **Mudança de raio
real (+4px, 10→14px)** — os boxes hoje divergem de TODO Card real da página; alinhar a `rounded-xl` é o
de-slop. **Flag /impeccable.** (Alternativa: adotar o `<Card>` primitivo — mas isso traria `py-6 gap-6
shadow-sm bg-card` que muda mais a aparência; manter o `<div>` tokenizado + só o raio é a mudança
mínima. Entrega base: `rounded-xl` no `<div>`.) Aplicar nos 4.

**Ritmo de seção (reconciliar a primeira seção):** a primeira seção `:35` usa `border-border
scroll-mt-20 border-t pt-8` (ordem de classe border/scroll/pt diferente, **e SEM `mt-8`**); todas as
seguintes `:64,:160,:358,:447,:456` usam `border-border border-t pt-8 mt-8`. **Decisão: padronizar a
primeira seção pra incluir `mt-8`** e a mesma ordem de classe → `border-border scroll-mt-20 border-t
pt-8 mt-8`. **Justificativa:** unifica o ritmo (toda seção tem o mesmo gap superior pós-borda); o `mt-8`
na primeira só adiciona respiro após o parágrafo de intro `:16` (que já tem `pb-8`) — **flag
/impeccable** pra confirmar que o respiro extra não fica grande demais. ADR não tem token de espaço →
hand-tuned. **Prioridade média.** `scroll-mt-20` preservado (offset de âncora). Os `pt-6`/`pt-8`
internos dos sub-blocos de mercado (`:174,:255,:304`) ficam (ritmo intra-seção intencional).

**Focus rings nos ~28 anchors (26 inline `#` + 2 externos):** todo `<a href="#…">` (`:55,71,75,79,83,
95,104,181,193,198,366,370,374,378,382,390,394,398,402,406,410,414,418,422,429,438`) e os 2 externos
(`:478,:490`) repetem `text-foreground underline underline-offset-2 decoration-border-strong
hover:decoration-foreground` e **nenhum tem focus ring** (teclado não vê foco em deep-links).
**Adicionar focus ring a cada anchor.** **Receita (lente a11y — escolher UMA, com flag):** o sibling
mais próximo é `components/help-hint.tsx:51` — o link inline canônico do repo, que vive no mesmo `help/`
tree que alimenta como-funciona-content e usa `focus-visible:rounded-sm` (condicional, raio só no foco).
Como anchors inline de body copy não têm fundo, `rounded-sm` always-on vs `focus-visible:rounded-sm`
**renderiza idêntico até o foco aparecer**. **Decisão base:** aplicar a receita do help-hint pra manter
os dois links inline da MESMA página pública byte-coerentes →
`focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50`
(precedente shadcn ADR:114). **FLAG /impeccable** pra o owner ratificar UMA receita inline (always-on
`rounded-sm` do BackLink/dashboard vs `focus-visible:rounded-sm` do help-hint) e aplicá-la consistente
em como-funciona + nos hints do glossário existentes. **Não extrair primitivo `<InlineLink>`** (o censo
sugere; mas extrair um componente novo é estrutura, não roteamento de token, e a issue restringe a
edição a estes 6 arquivos — criar `components/inline-link.tsx` violaria a allowlist). **Decisão:
aplicar a classe inline em cada anchor** (repetição aceita; mantém a edição dentro da allowlist; a
extração fica pro #331 ou refactor futuro). **Prioridade alta** (é a11y real). Os ids (`#odd-decimal`,
`#edge`, etc.) e o conteúdo dos anchors verbatim (contrato do glossário).

## NOTAS de coerência cross-primitiva (lente a11y — NÃO acionáveis em #323, só evitar falso-positivo no /impeccable)

- **Sufixo do Wordmark é `text-muted-fg-2` (terciário); o eyebrow do SectionLabel é
  `text-muted-foreground` (secundário).** Em como-funciona, o sufixo "como funciona" do header e
  qualquer section-label ficam em tiers muted diferentes. **São decisões de primitivo já existentes que
  esta fatia NÃO toca** (editar qualquer um vazaria cross-surface) → não é regressão introduzida pela
  #323; registrar pra o /impeccable não confundir com bug.

## Ordem de execução (passos, do menor risco pro maior)

> Cada passo é um diff coeso. Nenhum toca arquivo fora da allowlist.

1. **Tagline do signin (1 char-string, isolado, zero teste):** `app/signin/page.tsx:32` suffix → `· edge
   multi-mercado` (decisão 1). FLAG owner.
2. **Container token (mecânico):** `como-funciona/page.tsx:38` `max-w-[640px]`→`max-w-reading`
   (byte-idêntico).
3. **Token swaps de tipo/tracking puros — signin (leaf, sem golden, só 1 pin negativo):**
   `sign-in-methods.tsx` `:57,:77,:86,:101,:108` (decisão 7, parte tipo); `passkey-signin-button.tsx`
   `:68,:89` (decisão 8). Preservar `text-destructive` nos dois erros. Rodar `sign-in-methods.test.tsx`.
4. **Raio do checkbox:** `sign-in-methods.tsx:48` `rounded-[4px]`→`rounded-sm` (decisão 7; flag +2px).
5. **Token swaps de tipo/tracking — como-funciona-content (denso, leaf, sem golden):** todo o bloco de
   tipo da decisão 10 (h1/h2/h3/corpo/listas/notas/glossário/badge) + os 4 eyebrows de box → `text-eyebrow
   tracking-label` (decisão 10). Rodar `como-funciona-page.test.tsx` (toContain de copy/ids — verde).
6. **Raio dos boxes:** `como-funciona-content.tsx:113,205,271,324` `rounded-lg`→`rounded-xl` (decisão 10;
   flag +4px).
7. **Ritmo da 1ª seção:** `como-funciona-content.tsx:35` adicionar `mt-8` + normalizar ordem (decisão 10).
8. **Focus rings nos anchors (a11y):** os ~28 `<a>` de como-funciona-content (decisão 10) com a receita
   do help-hint. Diff grande mas mecânico (mesma string em cada). Rodar `como-funciona-page.test.tsx`.
9. **Home — h1 + subtítulos + "nenhuma predição" (tipo):** `page.tsx:222,225,276` (mobile) +
   `:302,305,351` (desktop) (decisões 2,3).
10. **Home — wordmark de como-funciona via primitivo:** `como-funciona/page.tsx:27-34` → `<Wordmark
    suffix="como funciona" suffixClassName="hidden sm:inline"/>` + import (decisão 9; flag gap-3→gap-2,
    size 17→18).
11. **Home — empty states via EmptyState (maior diff estrutural):** `page.tsx:242-256` (mobile) +
    `:320-333` (desktop) → `<Card><EmptyState className="py-6" icon={<Inbox aria-hidden …/>} title=…
    description=…/></Card>` + import EmptyState (decisão 4). aria-hidden nos Inbox.
12. **Home — DesktopHome consome SectionLabel + focus rings nos "ver todas":** `page.tsx:338-349` →
    `<SectionLabel action={<Link …focus-…/>}>Suas predições recentes</SectionLabel>` (children
    Title-case, render uppercase); e adicionar focus ring no Link `:266` (mobile) (decisão 5). FLAG
    /impeccable (gutter px-5 + baseline pb-3→pt-1 pb-2 no desktop).
13. **Ritmo (flag-only, sem mudança default):** confirmar `pt-7`/`pt-12` da home (decisão 6) e o ladder
    de gap do signin (decisão 7) no `/impeccable` — sem edição cega.

## Testes (auditados — baixa fragilidade; NENHUM re-snapshot; NENHUM update esperado)

- **`components/__tests__/odds-card-parity.golden.test.tsx`** — **SEGURO, confirmado 2 vias** (censo
  §pins + lente test-safety): renderiza só OddsCard/MatchRow/UpcomingMatchesDesktop DIRETO (não via
  page.tsx); a cadeia de import deles NÃO inclui nenhuma primitiva de chrome (Wordmark/SectionLabel/
  EmptyState/BackLink). Os valores arbitrários congelados NO snapshot (`text-[22px]`, `text-[9.5px]`,
  `tracking-[0.12em]`) vivem SÓ nos componentes de feed fora de escopo (grep vazio nos 6 in-scope). As
  edições de #323 não tocam esses componentes NEM renomeiam tokens do globals.css → golden
  byte-idêntico, **sem update**. Guardrail: não editar odds-card/match-row/upcoming-matches-*, não
  renomear/remover token `@theme`.
- **`app/signin/__tests__/sign-in-methods.test.tsx`** — pina COPY ("Entrar com Google"/"Enviar link de
  acesso"/"Entrar com passkey"/"Declaro ter 18 anos ou mais"/"Informe um e-mail.") + a contagem de
  `disabled` (gate, sem mudança de lógica) + o pin **negativo** `not.toContain("text-destructive")` no
  ramo SEM erro. Verde porque: copy verbatim; o `text-destructive` só aparece no bloco
  `{errorMessage && (...)}` `:100-104`, e o caso de teste passa `errorMessage=null` → render sem a
  classe. **Sem update esperado.**
- **`components/__tests__/como-funciona-page.test.tsx`** — testa `ComoFuncionaContent` via
  `renderToStaticMarkup` (corpo, NÃO o header da page): só `toContain` de headings/copy/números (0.5208,
  1.0417, 58%, +8pp, +0.1136 ≈ +11%, 45,43%, +6,57pp, 2.0692…)/ids `mercado-*`/âncoras do glossário,
  **ZERO pin de classe**. Verde porque toda copy/id é preservada byte-a-byte; as edições de tipo/
  tracking/raio/focus-ring não tocam texto nem id. **Sem update esperado.** (O header/wordmark editado
  vive em `como-funciona/page.tsx`, que este teste não renderiza.) **NOTA:** como não há pin de classe,
  um eyebrow/anchor esquecido NÃO ficaria vermelho aqui — o **grep anti-resíduo é o gate de completude
  real** (ver Verificação).
- **`components/__tests__/back-link.test.tsx`** — pina `text-body-sm`/`text-muted-foreground`/`mb-6`/
  `size-3.5`/`lucide-chevron-left` no BackLink. **NÃO tocamos back-link.tsx** → verde, sem update.
- Sem teste importando `app/page` (home) nem `signin/page` → chrome da home/signin sem cobertura
  unitária; **verificar no preview** (decisões 1/4/5 visuais).
- **Inner loop rápido (lente test-safety):** após cada passo, rodar só as 4 suítes guardadas pra falhar
  cedo antes da tríade cara: `npx vitest run components/__tests__/odds-card-parity.golden.test.tsx
  app/signin/__tests__/sign-in-methods.test.tsx components/__tests__/como-funciona-page.test.tsx
  components/__tests__/back-link.test.tsx --no-file-parallelism` (baseline: 4 arquivos, 18 testes, VERDE
  no `main` limpo).

## Verificação

Tríade + build, nesta ordem, TODAS verdes:
`pnpm typecheck && pnpm lint && pnpm test --no-file-parallelism && pnpm build`. `--no-file-parallelism`
é obrigatório local (flake do pglite em 8-core; CI roda 2-core sem o flag). Guardas extras:
- **Golden sem churn:** `pnpm test odds-card-parity.golden` → **0 diff**, sem update.
- **Grep anti-resíduo (GATE DE COMPLETUDE — não há teste de classe que pegue swap parcial):** nos 6
  arquivos in-scope pós-edit, `grep -E 'text-\[[0-9]|tracking-\[[0-9.]+em\]|rounded-\[[0-9]'` tem que
  chegar a **0 hits** (modulo o `ring-[3px]` sancionado). Não deve sobrar nenhum `text-[Npx]`/
  `tracking-[Nem]`/`rounded-[Npx]` — não há outlier heroico-display nestas telas, ao contrário de
  #246/#322. O `ring-[3px]` dos focus é o padrão shadcn sancionado (ADR:114), **não** é resíduo.
- **Grep de copy:** confirmar que o ÚNICO string mudado é o tagline do signin (`· edge multi-mercado`);
  toda outra copy byte-idêntica (`git diff` filtrado por linhas de texto). **Atenção ao guard de
  casing:** os children do SectionLabel do desktop viram `"Suas predições recentes"` (Title-case,
  paridade com o mobile; render uppercase) — não é mudança de copy renderizada (era minúsculo +
  `uppercase`), mas o diff vai mostrar a string-fonte mudando; é esperado.
- Visual `/impeccable` (signin é público; como-funciona é público — `middleware.ts:30` exclui
  `signin$`/`como-funciona$`; home é session-gated → preview Vercel logado): light/dark + mobile/desktop,
  validando (a) tagline `· edge multi-mercado` no signin (**veto do owner, load-bearing**); (b) wordmark
  de como-funciona via primitivo (17→18, gap-3→gap-2, sufixo idêntico); (c) h1 da home 26/32 com
  leading-none; (d) empty states reconciliados (ícone size-10, título 14, desc body-sm, largura narrow,
  **gap interno gap-1→gap-1.5**, **span→p**) nos dois viewports — conferir que o bloco centralizado não
  fica largo demais; (e) DesktopHome com SectionLabel — **conferir o gutter px-5 + baseline pb-3→pt-1
  pb-2 não desalinhar** da grade de cards; (f) focus ring visível em cada anchor de como-funciona + nos
  "ver todas" (receita help-hint ratificada); (g) +4px de raio nos boxes de como-funciona e +2px no
  checkbox; (h) h1/h2 de como-funciona (+6/+2px) não estouram o ritmo de leitura; (i) ritmo da 1ª seção
  com mt-8; (j) o tier muted do sufixo Wordmark (terciário) vs section-label (secundário) NÃO é
  regressão (decisão de primitivo pré-existente). Diff tem que ser **apresentação-only**.
- **Worktree guard (lente test-safety):** confirmar que o trabalho roda no checkout RAIZ (branch `main`,
  limpo), não numa cópia órfã em `.claude/worktrees/` (que tem stale de como-funciona-page.test.tsx +
  back-link.test.tsx) — editar uma cópia deixaria as suítes raiz intactas e o CI cego.
- **"Fecha #323" PT-BR não auto-fecha** → fechar a issue manual após merge verde.

## Desvios conscientes do texto da issue

- **NÃO editar `back-link.tsx`/`section-label.tsx`/`page-header.tsx`/`wordmark.tsx`/`empty-state.tsx`/
  `help-hint.tsx`** (a issue lista alguns na "lista de componentes", mas todos já foram migrados pela
  #321 e/ou são compartilhados além do entry / pinados por teste): editar `back-link.tsx` quebraria o
  pin `back-link.test.tsx` E vazaria em admin/perfil/dashboard; editar `section-label.tsx`/`wordmark.tsx`
  vazaria no dashboard prediction-detail / shell / signin; `page-header.tsx`/`empty-state.tsx`/
  `help-hint.tsx` já são zero-violação. **CONSUMIMOS os 6, nunca editamos.** O `ring-[3px]` do BackLink é
  o padrão shadcn sancionado pela ADR:114, **não** uma violação a corrigir.
- **Tagline do signin → `· edge multi-mercado`** (decisão 1): a única mudança de copy da fatia, alinhada
  à linguagem de marca JÁ existente do desktop-shell (`v0 · edge multi-mercado`) e da HOME_SUBTITLE;
  descritor multi-mercado escolhido pelo owner. Diverge do lean do censo (A=`· v0`/C=sem sufixo) → FLAG
  /impeccable + veto load-bearing.
- **DesktopHome adota SectionLabel** mesmo trazendo `px-5` + `pt-1 pb-2` num container `px-8` `pb-3`
  (decisão 5): aceita a mudança de gutter/baseline pra matar a duplicação (intenção da issue); se
  desalinhar visualmente, fallback é só tokenizar o bloco inline.
- **Empty states unificam título 15→14 ("pra baixo")** (decisão 4): único colapso "pra baixo" da fatia,
  justificado porque 15px é título de empty-state (não número-herói) e alinha ao 14px do mobile irmão —
  precedente #322 decisão 6. O gap interno gap-1→gap-1.5 e o span→p são de-slop aceito do primitivo.
- **NÃO extrair primitivo `<InlineLink>`** pros ~28 anchors de como-funciona (decisão 10): o censo
  sugere, mas criar componente novo violaria a allowlist de 6 arquivos; aplico a classe de focus inline
  (receita help-hint) em cada anchor (repetição aceita pra ficar dentro do escopo).
- **Sem outlier heroico-display** nestas telas (contraste com #246/#322): os tamanhos da home (26/32) e
  de como-funciona (18/26) caem exatos na escala — nenhum `text-[Npx]` comentado sobrevive aqui.
- **Ritmo (pt-7/pt-12 home; ladder de gap signin; mt-8 da 1ª seção; gap interno/baseline do empty/
  SectionLabel) é hand-tuned, NÃO token** (decisões 4,5,6,7,10): ADR 0029 não adiciona token de espaço;
  tratados como consistência de baixa/média prioridade, julgados no /impeccable, sem cunhar nada.

## Fora de escopo (NÃO fazer)

Qualquer mudança de lógica/query/rota/auth/gating. Editar `ui/*`, `globals.css`, `back-link.tsx`,
`section-label.tsx`, `page-header.tsx`, `wordmark.tsx`, `empty-state.tsx`, `help-hint.tsx`. Editar
qualquer feed/grade/conteúdo: odds-card, match-row, upcoming-matches-*, date-range-tabs, league-tabs,
recent-pred-card, desktop-status-cell (#331); analysis-* (#246); glossary/help. Cunhar token (tipo/cor/
tracking/raio/espaço). Re-snapshot do golden. Mudar QUALQUER copy além do tagline do signin (a troca
para Title-case dos children do SectionLabel do desktop NÃO muda render). Criar componente novo (incl.
`<InlineLink>`). Tocar dashboard (#322), admin (#324), perfil (#325), shell.
