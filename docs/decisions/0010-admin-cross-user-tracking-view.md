# ADR 0010 — Visão de admin pra auditar o tracking de outros usuários

## Status
Accepted (2026-06)

## Contexto

Implementação da issue #59. O #10 (dashboard de tracking) estabeleceu um
escopo per-user NÃO-NEGOCIÁVEL: TODO usuário — inclusive o admin — vê apenas as
próprias predições. As queries `getUserDashboardRows(userId)` e
`getPredictionDetailForUser(predictionId, userId)` (em
`lib/db/queries/dashboard.ts`) são escopadas por um `userId` OBRIGATÓRIO, e o
drill-down dá `notFound()` se a predição não for do usuário da sessão. A
consequência: não existe, pela UI, nenhuma visão de auditoria cross-user — o
admin solo não consegue olhar o tracking (KPIs, tabela, gráfico, racional) nem
os payloads brutos de outro usuário, mesmo sendo o dono do sistema.

O #59 pede exatamente isso: uma área de admin onde dá pra buscar usuários por
e-mail e abrir o tracking de qualquer um deles, reusando os componentes de
`components/dashboard/`. Isto é uma EXCEÇÃO deliberada ao escopo per-user do
#10, então precisa ser registrada antes de implementar.

## Decisão

1. **Seção de admin SEPARADA sob `app/admin/users/`** — e NÃO um parâmetro
   `?userId=` em `/dashboard`. Assim `/dashboard` continua trivialmente
   self-scoped (sempre `session.user.id`); `app/dashboard/*` fica INTOCADO e a
   garantia per-user dele não muda em nada (rota diferente, mesmas queries
   escopadas).

2. **REUSO das queries do #10 com o `userId` ALVO.** As páginas de admin chamam
   `getUserDashboardRows(userId)` e `getPredictionDetailForUser(predictionId,
   userId)` VERBATIM, passando o `userId` do alvo, SÓ dentro do caminho gateado
   por admin. As assinaturas continuam com `userId` OBRIGATÓRIO (não viram
   opcional/default) — qualquer enfraquecimento disso quebraria silenciosamente
   o invariante per-user. O gate é o `app/admin/layout.tsx` (role === "admin" →
   `notFound`) MAIS um re-check defensivo `role === "admin"` na própria página
   onde os dados privilegiados são buscados (espelha os comentários de
   `costs/page.tsx` e `invites/page.tsx`).

3. **Payloads brutos (`inputPayload`/`outputPayload`, que contêm o system
   prompt) INCLUÍDOS no drill-down — admin-only.** Via o já existente
   `toPredictionDetailView(detail, { includeRawPayloads: true })` e a renderização
   de payloads do componente `PredictionDetail`. `includeRawPayloads: true` já é
   o gate estabelecido de payloads (mesmo padrão de `app/dashboard/[predictionId]`
   pra admin).

4. **`notFound()` no mismatch preserva o invariante mesmo no caminho de admin.**
   O drill-down SEMPRE roteia por `getPredictionDetailForUser(predictionId,
   targetUserId)` → `null` → `notFound()` se a predição não for daquele alvo. Sem
   cross-user bleed: a query escopada é a única fonte de verdade.

## Razão

- Deixa o admin solo auditar o tracking + os payloads brutos de LLM de qualquer
  usuário, sem enfraquecer a garantia per-user.
- O reuso (queries do #10 + view-layer + componentes de dashboard) mantém um
  único caminho de código e zero string-math no admin (o view-layer já converte
  `numeric` do Drizzle pra `Number`).
- As queries escopadas por `userId` + `notFound()` no mismatch preservam o
  invariante de "ninguém vê predição de outro" mesmo dentro do caminho de admin.

## Consequências

- (+) Admin pode auditar KPIs/tabela/gráfico/drill-down de qualquer usuário.
- (+) A garantia de `/dashboard` fica LITERALMENTE inalterada (rota diferente,
  mesmas queries escopadas; `app/dashboard/*` não é tocado).
- (−) EXCEÇÃO deliberada à fronteira de visibilidade do #10 e uma superfície de
  privacidade/exposição-de-prompt — aceita no contexto solo/F&F, gateada por
  role no layout + re-check defensivo em cada página nova.

## Referências

- Relaciona-se ao #10 (dashboard de tracking) e ao #59 (esta).
- Reusa as queries e o view-layer do #10 e os componentes de
  `components/dashboard/`.
- Área de admin e gate de role: #52/#53 e ADR 0009 (whitelist em DB) pra contexto.
