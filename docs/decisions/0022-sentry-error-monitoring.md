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

- **PII em traces**: stack traces podem capturar dados de usuário. `sendDefaultPii: false` é setado **explicitamente** nos 3 inits (server/edge/client) — é o default do SDK, mas fixado como invariante pra não flipar silenciosamente num re-run do wizard. Não anexamos IP do usuário nem valores de cookie; **headers de request ainda podem ser capturados** pela integração `RequestData` salvo scrubbing explícito. Compatível com a postura LGPD do projeto (ver `05-legal-compliance.md`).
- **Custo**: o free tier tem cotas **separadas por categoria** — erros (5k/mês), performance/tracing e logs são buckets distintos; **logs não contam** nos 5k de erros. Na prática o que estoura a cota é tracing, não erros — **Replay não está habilitado** (sem `replaysSessionSampleRate`/`replaysOnErrorSampleRate` nos inits; ver `04-observabilidade.md`). `tracesSampleRate: 0.1` limita o volume de traces; erros são sempre enviados (sem sampling).
- **Logs**: a integração de logs do Sentry fica **desligada** (`enableLogs` foi removido dos inits — era no-op sem `consoleLoggingIntegration`/`Sentry.logger`). Só ligar de propósito e pareado com scrubbing (`beforeSendLog`), já que `console.error` no código pode carregar payload.
- **Build**: source maps são enviados ao Sentry no CI via `SENTRY_AUTH_TOKEN`. Sem o token, o build funciona mas os stack traces em produção ficam minificados.
- **Adblock**: `tunnelRoute: "/monitoring"` roteia eventos do browser pelo próprio domínio para evitar bloqueio.
- **Ambiente**: Sentry desabilitado em dev (`enabled: NODE_ENV === "production"`). Em prod **e** preview da Vercel ambos reportam (o Next põe `NODE_ENV=production` nos dois), **distinguidos pela tag `environment`** — `VERCEL_ENV` no server/edge, `NEXT_PUBLIC_VERCEL_ENV` no client. ⚠️ Gap conhecido: preview ainda consome a cota do **mesmo** projeto; gatear preview off é opção futura (não feito pra preservar o smoke test em preview).
