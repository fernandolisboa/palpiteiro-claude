# Plano — menu sempre visível e nova navegação

Snapshot do plano (2026-10-13). Pedido do Fernando: o menu superior some em várias telas (sobra só o
`< jogos`), e a ordem/agrupamento do menu precisa ser repensada.

## Diagnóstico (código em `main`, 6fe4df3)

O header é por página, não por layout, e cada página escolhe o seu:

| Rota | Celular (< lg) | Computador (lg+) |
|---|---|---|
| `/jogos` | `PageHeader` (☰) | `DesktopShell` |
| `/match/[id]`, `/time/[team]` | só `< jogos` + tema | `DesktopShell` |
| `/dashboard`, `/dashboard/[id]`, `/admin/users/*` | `DesktopShell` (nav inline sem ☰, estoura a largura) | `DesktopShell` |
| `/apostas`, `/perfil`, `/admin`, `/admin/*` | sem header | sem header |
| `/como-usar`, `/como-funciona` | wordmark + tema | wordmark + tema |

Além disso o `loading.tsx` de cada rota remonta o header e o `error.tsx` de `/jogos` usa outro.

## Decisão

1. **Route group `app/(app)/`** com `layout.tsx` que renderiza o `AppShell` (header + conteúdo). Entram
   `jogos`, `match`, `time`, `dashboard`, `apostas`, `perfil`, `como-usar`, `admin`. URLs não mudam. O
   header fica montado entre navegações, e loading/error/not-found de cada rota herdam o menu sem esforço.
   Toda página nova logada que cair no grupo já nasce com menu.
2. `/como-funciona` continua pública (fora do middleware, CSP estática), mas passa a renderizar o mesmo
   `AppShell`: logado → menu completo; anônimo → marca + tema + "entrar". Vira dinâmica (lê a sessão);
   a CSP pública `'unsafe-inline'` cobre isso.
3. **Um único modelo de menu** em `lib/nav/menu.ts` (função pura, testável) consumido pelo header do
   computador e pelo drawer do celular. Substitui `mobileNavLinks` e a lista duplicada do `DesktopShell`.
4. **Agrupamento**
   - Principal (as telas de uso): `jogos` · `apostas` · `desempenho` (era "dashboard"; a página passa a
     se chamar "Desempenho", URL `/dashboard` mantida).
   - `ajuda ▾`: como usar · como funciona · rever o tour.
   - `admin ▾` (só admin): visão geral · usuários · custos de IA · calibração · configurações · ligas
     (mesma lista do índice `/admin`, que passa a ler daqui).
   - À direita: tema e menu da conta (avatar ▾: perfil · sair).
   - Celular: ☰ abre drawer com as mesmas seções (principal, ajuda, admin, conta).
5. Header **sticky** (fica visível ao rolar), `scroll-padding-top` global pros links de âncora do guia.
6. Some o `< jogos` das páginas de topo (apostas, perfil, como usar, como funciona, admin). Fica onde é
   contextual: jogo (volta pra lista filtrada), time, detalhe de predição, sub-páginas do admin.
7. Remover `DesktopShell` e `PageHeader`; o subtítulo do `/jogos` celular ("N jogos · 5 dias") vai pro
   corpo da página.
8. Tour: alvo `data-tour="menu"` continua (no nav do computador e no ☰ do celular). Textos do tour e
   do `/como-usar` atualizados pros novos rótulos (desempenho, ajuda, menu da conta).

## Testes

- `lib/nav/__tests__/menu.test.ts`: itens/ordem, admin só pra admin, ativo por prefixo, grupo ativo.
- Atualizar `mobile-nav.test.tsx`, testes de `/como-funciona`, `/como-usar`, tour.
- Teste estrutural: toda `page.tsx` logada (dentro do matcher do middleware) mora em `app/(app)/`.
- Build de produção local + Chromium pra conferir header em 390px e 1440px.

## Ajustes da revisão do plano

- `getSession` (`lib/auth/session.ts`) = `auth()` com `cache()` do React: layout do grupo e layout do
  admin pagam uma leitura de sessão só.
- `AppShell` não deixa falha de sessão derrubar o layout (cairia no global-error): loga no Sentry e
  renderiza o menu básico. Erros internos do Next passam via `unstable_rethrow`.
- "rever o tour" clicado já em `/jogos` não remontava o `GuidedTour`: a chave muda a cada request
  forçado.
- `scroll-mt-20` já existente cobre o header fixo; sem `scroll-padding-top` global.
- Testes que importavam `@/app/admin/...` e o teste do `/como-usar` (raiz por `__dirname`) ajustados.
