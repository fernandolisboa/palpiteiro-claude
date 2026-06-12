# ADR 0022 — Sentry para error monitoring e tracing

**Data:** 2026-06-12  
**Status:** Aceito

## Contexto

O projeto não tinha observabilidade de erros em produção. Erros em Server Components, Server Actions e edge middleware eram silenciosos — só apareciam nos logs do Vercel, sem agrupamento, alertas ou rastreamento de frequência.

## Decisão

Adotar o **Sentry** (`@sentry/nextjs`) como plataforma de error tracking e performance monitoring.

Stack de integração:
- `instrumentation.ts` + `sentry.server.config.ts` / `sentry.edge.config.ts` — erros no server e edge
- `instrumentation-client.ts` — erros no browser
- `app/global-error.tsx` — boundary global para erros não capturados no root layout
- `withSentryConfig` no `next.config.ts` — source maps e instrumentação de Vercel Crons

## Alternativas consideradas

| Opção | Descarte |
|---|---|
| Logs manuais via `console.error` + Vercel logs | Sem agrupamento, sem alertas, sem contexto de usuário |
| Datadog | Custo alto para side project; Sentry tem free tier generoso |
| Rollbar / Bugsnag | Sentry tem melhor integração Next.js e free tier equivalente |

## Consequências

- **PII em traces**: stack traces podem capturar dados de usuário. `sendDefaultPii` está desabilitado (não enviamos IPs/cookies por padrão). Compatível com a postura LGPD do projeto (ver `05-legal-compliance.md`).
- **Custo**: free tier Developer (5k eventos/mês). `tracesSampleRate: 0.1` limita volume de performance traces. Erros são sempre enviados (sem sampling).
- **Build**: source maps são enviados ao Sentry no CI via `SENTRY_AUTH_TOKEN`. Sem o token, o build funciona mas os stack traces em produção ficam minificados.
- **Adblock**: `tunnelRoute: "/monitoring"` roteia eventos do browser pelo próprio domínio para evitar bloqueio.
- **Ambiente**: Sentry desabilitado em desenvolvimento (`enabled: NODE_ENV === "production"`) para não poluir o painel com noise de dev.
