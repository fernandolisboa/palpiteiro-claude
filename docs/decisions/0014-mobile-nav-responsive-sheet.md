# ADR 0014 — Navegação mobile via Sheet (drawer) responsivo

## Status

Accepted (2026-06-11)

## Contexto

Implementação da issue #136. A nav canônica (`jogos` → `/`, `dashboard` →
`/dashboard`, `admin` → `/admin`, esta última gateada por
`session.user.role === "admin"`) vive só no `DesktopShell`, escondida nos
breakpoints mobile (`lg:hidden`). O header mobile (`PageHeader`) só tinha marca +
subtítulo + toggle de tema — **sem nenhuma forma de navegar** entre jogos,
dashboard e admin. No mobile o usuário ficava preso na home.

O primitivo `Sheet` (drawer baseado em Radix Dialog) acabou de ser mergeado
(#135) e está disponível em `components/ui/sheet.tsx`, o que abre caminho pra um
drawer de navegação sem reinventar overlay/foco/escape.

## Decisão

1. **Um único padrão responsivo, sem OS-detection.** Um botão hambúrguer
   (`Menu` do `lucide-react`) no `PageHeader` mobile abre um `Sheet` que desliza
   da esquerda (`side="left"`) com os mesmos destinos da nav desktop: `jogos`,
   `dashboard` e — só pra admin — `admin`. Nada de servir nav diferente por
   plataforma; é o mesmo componente em qualquer dispositivo no breakpoint mobile.

2. **Mesmo gate de admin do desktop.** O link de admin aparece só quando
   `session.user.role === "admin"`, computado no Server Component (`app/page.tsx`)
   e passado como prop (`isAdmin`) até o `PageHeader` → `MobileNav`. Helper puro
   `mobileNavLinks(isAdmin)` deriva a lista (testado direto, no estilo de
   `visibleLeagueTabs` (hoje `leaguePickerGroups`)).

3. **`isAdmin` é prop opcional (`false` por padrão).** `app/loading.tsx` e
   `app/error.tsx` também renderizam `PageHeader` e **não têm sessão em escopo**
   (loading é fallback de servidor; error é `"use client"`). O default `false`
   mantém os dois compilando e renderiza o menu com jogos/dashboard (sem admin).

4. **Toggle de tema permanece no header**, fora do drawer. É uma ação de um
   toque, sempre visível; o drawer é só navegação. Evita dois toggles e mantém o
   tema acessível sem abrir o menu.

## Razão

- **Padrão único** elimina divergência de UX entre plataformas e o custo de manter
  dois componentes de nav. Sem sniffing de user-agent (frágil, quebra em
  tablet/resize/desktop-touch).
- **A11y de graça do Radix**: foco preso no drawer, fechar no Escape, overlay
  clicável, `aria` correto. O `SheetContent` já traz um botão de fechar; o
  `SheetTitle` (visualmente oculto via `sr-only`) satisfaz a exigência de título
  do Dialog sem poluir a UI.
- **Reuso do primitivo `Sheet` (#135)** evita reimplementar overlay/portal/foco.
- **Gate idêntico ao desktop** mantém uma só fonte de verdade pra visibilidade do
  admin (`session.user.role`), sem lógica nova de autorização.

## Alternativas consideradas

- **OS-detection servindo nav diferente por plataforma**: rejeitado — frágil
  (user-agent mente, não cobre resize/tablet/desktop-touch), exige dois
  componentes e gera UX inconsistente. O escopo do #136 pede explicitamente um só
  padrão responsivo.
- **Bottom tab bar**: rejeitado — são poucos destinos (2–3) e o drawer escala
  melhor caso a nav cresça, além de espelhar exatamente o conjunto de links do
  desktop. Tab bar fixa rouba altura útil numa lista já densa.
- **Reusar `DesktopShell` no mobile**: rejeitado — ele tem outro contrato de
  layout/breakpoint (header de 56px, avatar/sair, padding `px-8`) pensado pra tela
  larga; encaixá-lo no mobile exigiria reescrevê-lo, não reusá-lo.

## Consequências

- (+) Mobile ganha navegação entre jogos/dashboard/admin pela primeira vez.
- (+) Reusa o `Sheet` (#135); um só padrão, sem OS-sniffing; a11y herdada do Radix.
- (+) `mobileNavLinks` puro é testável sem DOM/portal (teste do helper, não do
  drawer renderizado — conteúdo do Radix portal não está no markup quando fechado).
- (−) Toggle de tema fica no header (um só toggle, não dois) — decisão de produto,
  não limitação técnica.
- (−) Staleness de role herda o ADR 0007: o link de admin só aparece após
  re-login de quem foi promovido (o `role` mora no JWT, lido no sign-in).
  Pré-existente, consistente com a nav desktop.

## Referências

- Implementa a issue #136; reusa o primitivo `Sheet` da issue #135.
- Herda a staleness de `role` no JWT do ADR 0007 (mesmo gate do desktop).
