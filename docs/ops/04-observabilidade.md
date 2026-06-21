# Observabilidade — Sentry, logs, uptime e alertas

> ✅ **JÁ FEITO (2026-06): Sentry instalado.** `@sentry/nextjs` + `withSentryConfig` no
> `next.config.ts` (com cron monitors) — **não é mais greenfield**. Onde o doc abaixo diz
> "instalar do zero", leia como referência de config/limites. Spend-alert diário já roda.

Como dar visibilidade de erros e saúde do app em produção **sem gastar à toa**.
O objetivo aqui é destravar a Fase 2 (abrir pros amigos) com a tranquilidade de
saber quando algo quebrou — não montar um stack de SRE. Tráfego é baixo e os free
tiers cabem com folga.

Boa parte da telemetria de **custo** já existe no app (logging em `ai_calls`,
spend-alert diário). O que falta é **erro de runtime** (exceptions, 500s) e
**saúde dos crons**. Este doc cobre o que já existe, como ligar o Sentry do zero,
e o mínimo de uptime que vale a pena.

> ℹ️ Pré-requisito: a env `SENTRY_DSN` já existe como **placeholder** no
> [`.env.example`](../../.env.example) (seção Observability), mas hoje ela **não
> é lida por nada** — o pacote `@sentry/nextjs` não está instalado e não há
> nenhuma linha de código Sentry no repo. O wiring abaixo é greenfield.

## TL;DR da ordem

1. **Decisão:** ficar no Sentry **free** (Developer). Não pagar agora.
2. Instalar e configurar `@sentry/nextjs` (wizard ou manual) — seção
   [Sentry do zero](#sentry-do-zero-nextjs-15-app-router).
3. Setar `SENTRY_DSN` (+ org/project/auth token) na Vercel — ver
   [`02-vercel-prod.md`](./02-vercel-prod.md).
4. Manter o **spend-alert** ligado (já existe) — seção [O que já existe](#o-que-já-existe-não-reimplemente).
5. (Opcional) Subir um endpoint de health + monitor de uptime gratuito — seção
   [Uptime e saúde dos crons](#uptime-e-saúde-dos-crons).
6. Registrar a decisão de adicionar o Sentry — seção [Nota de processo](#nota-de-processo-registre-a-decisão).

> 🟦 **DECISÃO (sua) — pagar Sentry agora?**
> **Recomendação default: NÃO.** O plano **Developer (free)** cobre 1 usuário,
> ~5.000 erros/mês e 30 dias de retenção — sobra pra escala de amigos (Fase 2).
> O plano pago (**Team**) começa na casa de ~US$26/mês e só faz sentido se o
> volume de eventos crescer, se você precisar de mais de 1 assento, ou de
> retenção maior. Trade-off do free: quando estoura a cota mensal, eventos novos
> são **descartados silenciosamente** até o próximo ciclo (você não é cobrado por
> excedente, mas perde visibilidade no fim do mês). Pra Fase 2 isso é improvável.
> Confira os números atuais em
> [sentry.io/pricing](https://sentry.io/pricing/) e
> [docs.sentry.io/pricing](https://docs.sentry.io/pricing/) — **valores e cotas
> mudam.**

## O que já existe (não reimplemente)

Antes de adicionar ferramenta nova, saiba o que o app já entrega:

| Sinal | Onde mora | Como ler |
| --- | --- | --- |
| **Custo de IA por chamada** | tabela `ai_calls` (coluna `cost_usd`) — toda chamada passa por `lib/ai/predict.ts` | Dashboard interno / Drizzle Studio (`pnpm db:studio`) |
| **Alerta de gasto diário** | cron `/api/cron/spend-alert` (23:00 UTC, em [`vercel.json`](../../vercel.json)) | E-mail via Resend quando o gasto do dia UTC passa de `DAILY_AI_SPEND_ALERT_USD`. **Opt-in:** sem `DAILY_AI_SPEND_ALERT_USD` (ou `<=0`) não envia nada. Precisa também de `SPEND_ALERT_EMAIL`. Deduplicado por dia via Vercel KV. |
| **Rate limit por usuário/dia** | `RATE_LIMIT_ANALYSES_PER_DAY[_ADMIN]` via Upstash Ratelimit sobre o Vercel KV | Gate **antes** de qualquer chamada à Anthropic. Em dev (sem envs KV) falha aberto. |
| **Logs de runtime** | Vercel → Project → **Logs** | Stdout/stderr de funções e do build. Retenção curta no Hobby — ver [`02-vercel-prod.md`](./02-vercel-prod.md). |
| **Execução dos crons** | Vercel → Project → **Cron Jobs** (logs por execução) | Confere se settle e spend-alert rodaram e o status HTTP. |

> ⚠️ O spend-alert cobre **custo**, não **erro**. Se um deploy quebrar a análise
> ou um provider de dados começar a dar 500, o spend-alert fica quieto (gasto até
> cai). Por isso vale o Sentry: ele cobre o buraco de **exceptions/500s**.

O que **falta** e este doc resolve:

- Captura de exceptions não-tratadas (Server Components, Server Actions, routes,
  client) → **Sentry**.
- Aviso quando um **cron falha** ou o app fica **fora do ar** → **uptime monitor**.

## Sentry do zero (Next.js 15 App Router)

`@sentry/nextjs` suporta App Router nativamente via o arquivo
`instrumentation.ts` do Next e um `instrumentation-client.ts` pro browser. Você
pode usar o **wizard** (recomendado — gera tudo) ou fazer **manual**.

### Caminho A — wizard (recomendado)

O wizard instala o pacote, cria os arquivos de config, injeta o
`withSentryConfig` no `next.config.ts` e cria uma rota de teste.

```bash
npx @sentry/wizard@latest -i nextjs
```

Ele vai pedir login no Sentry, deixar você escolher/criar o **projeto**, e
perguntar quais features quer (Error Monitoring, Tracing, Session Replay, Logs).
Para este app, ligue **Error Monitoring**; **Tracing** e **Replay** podem ficar
on com sample rate baixo (ver [Controle de custo/quota](#controle-de-custoquota)).

> ⚠️ O wizard edita arquivos versionados (`next.config.ts`, cria
> `instrumentation*.ts`, `app/global-error.tsx`, e às vezes um `.env.sentry-build-plugin`
> com o auth token). **Revise o diff** antes de commitar e **não comite o auth
> token** — ele vai pra env da Vercel, não pro git. Confira que o `.gitignore`
> cobre `.env.sentry-build-plugin`.

### Caminho B — manual

Se preferir controle total (o wizard às vezes mexe demais), faça na mão:

**1. Instalar o pacote**

```bash
pnpm add @sentry/nextjs
```

**2. `sentry.server.config.ts`** (raiz do projeto)

```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // 100% em dev, baixo em prod (tráfego baixo, mas controla quota)
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  enabled: process.env.NODE_ENV === "production",
});
```

**3. `sentry.edge.config.ts`** (raiz) — idêntico ao server; cobre middleware e
edge routes.

```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  enabled: process.env.NODE_ENV === "production",
});
```

**4. `instrumentation.ts`** (raiz) — o hook do Next que carrega server/edge
conforme o runtime, e exporta `onRequestError` pra capturar erros de RSC/routes:

```typescript
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
```

**5. `instrumentation-client.ts`** (raiz) — Sentry do browser. Note o
`DSN` exposto ao client (é público por design):

```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  // Replay caro em quota — mantenha baixo (ou remova a integration)
  replaysSessionSampleRate: 0.0,
  replaysOnErrorSampleRate: 1.0,
  integrations: [Sentry.replayIntegration()],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
```

> ⚠️ O DSN do **client** é público e vai pro bundle — por convenção ele entra
> como `NEXT_PUBLIC_SENTRY_DSN`. O DSN do **server** pode ficar só em
> `SENTRY_DSN` (não exposto). Como o app usa a env canônica `SENTRY_DSN`, decida:
> ou você adiciona um `NEXT_PUBLIC_SENTRY_DSN` (mesmo valor) pro client, ou só
> instrumenta o server por enquanto. **Recomendação:** comece só com server/edge
> (cobre as exceptions de análise, settlement e crons, que é onde dói) e ligue o
> client depois.

**6. `app/global-error.tsx`** — captura erros que escapam do root layout:

```tsx
"use client";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html>
      <body>Algo deu errado.</body>
    </html>
  );
}
```

**7. `next.config.ts`** — hoje é um stub (`const nextConfig: NextConfig = {}`).
Envolva com `withSentryConfig`:

```typescript
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {};

export default withSentryConfig(nextConfig, {
  org: "SEU_ORG_SLUG",
  project: "palpiteiro",
  authToken: process.env.SENTRY_AUTH_TOKEN, // só no build/CI — nunca no git
  tunnelRoute: "/monitoring", // dribla adblock (ver abaixo)
  silent: !process.env.CI,
  widenClientFileUpload: true, // stack traces melhores
});
```

> 💡 **`tunnelRoute`** faz o SDK do browser mandar eventos por uma rota do seu
> próprio domínio (ex.: `/monitoring`) em vez de bater direto no domínio do
> Sentry — o que muitos **adblockers** bloqueiam. Sem isso, você perde erros de
> usuários com bloqueador. Só vale a pena quando o **client** está instrumentado.

> ⚠️ Se o app tem middleware de auth (Auth.js), **exclua a `tunnelRoute` do
> matcher** — senão a POST de telemetria de qualquer requisição sem sessão toma
> 307→`/signin` e o evento some. Aqui o matcher em [`middleware.ts`](../../middleware.ts)
> exclui `monitoring(?:/|$)`; ao trocar `tunnelRoute`, atualize o matcher junto.

### Envs do Sentry

Setar na Vercel (ver [`02-vercel-prod.md`](./02-vercel-prod.md) pra onde clicar):

| Env | Onde | Pra quê |
| --- | --- | --- |
| `SENTRY_DSN` | Production (+ Preview, opcional) | DSN do projeto (server/edge). Já está no [`.env.example`](../../.env.example). |
| `NEXT_PUBLIC_SENTRY_DSN` | Production (se instrumentar o client) | Mesmo valor do DSN, exposto ao browser. **Não é canônico ainda** — adicione só se ligar o client; ao ligar, registre-o (e `SENTRY_AUTH_TOKEN`) no [`.env.example`](../../.env.example) (seção Observability) pra manter os nomes canônicos versionados. |
| `SENTRY_AUTH_TOKEN` | **Production build env** (não Preview) | Upload de **source maps** no build (stack traces legíveis). Gere em Sentry → Settings → Auth Tokens. **Secret — nunca no git.** |
| `SENTRY_ORG` / `SENTRY_PROJECT` | opcional (ou hardcode no `next.config.ts`) | Slug da org/projeto pro upload. |

> ⚠️ **Source maps + custo de tokens não têm relação** — mas o upload de source
> maps acontece **no build da Vercel** (que já roda `drizzle-kit migrate &&
> next build`). Sem `SENTRY_AUTH_TOKEN` o build **não falha**, só sobe sem source
> maps e os stack traces ficam ofuscados. Confirme que o token está setado antes
> de confiar nos traces de prod.

### Controle de custo/quota

Tráfego é baixo, mas o que **estoura a cota free** é tracing e replay (quando
ligado), não erros. Mantenha conservador:

| Opção | Sugestão Fase 2 | Por quê |
| --- | --- | --- |
| `tracesSampleRate` | `0.1` em prod (ou menor) | Cada transação amostrada conta como evento de performance. |
| `replaysSessionSampleRate` | `0.0` | Replay de sessão é o que mais consome quota; ligue só se precisar. |
| `replaysOnErrorSampleRate` | `1.0` | Barato e útil: só grava replay quando há erro. |
| Error Monitoring | sempre on | É o sinal que importa; raramente estoura 5k/mês nessa escala. |

> ℹ️ **Replay não está habilitado hoje** — `instrumentation-client.ts` não
> configura `replaysSessionSampleRate`/`replaysOnErrorSampleRate`, então não
> consome cota de replay nem grava sessão. As duas linhas `replays*` acima são
> guia pra **se** ligar; antes disso reavalie PII/LGPD (Replay grava DOM e
> inputs do usuário). `tracesSampleRate` é o único knob de amostragem ativo.

Documentação oficial do setup (confira, o SDK evolui):
[Sentry · Next.js — Manual Setup](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/).

### Verificação rápida

1. Suba um deploy de Preview/Production com `SENTRY_DSN` setado.
2. Force um erro (uma rota de teste que joga `throw new Error("sentry test")`,
   ou a rota que o wizard cria).
3. Veja o evento aparecer no dashboard do Sentry em segundos.
4. Confirme que o stack trace está **legível** (source maps subiram) — se vier
   ofuscado, falta `SENTRY_AUTH_TOKEN` no build.

## Nota de processo: registre a decisão

O [`CLAUDE.md`](../../CLAUDE.md) exige **ADR** pra provider novo de IA, liga ou
mercado. Sentry é **infra de observabilidade**, fora dessa regra literal — mas
adicionar uma dependência externa que recebe **dados de usuário** (stack traces
podem conter PII; `sendDefaultPii` adiciona IP/headers) merece um registro leve:

- **Mínimo:** um commit `chore:` claro, ex. `chore(obs): add Sentry error
  monitoring (free tier)`, explicando no body o porquê e o trade-off de quota.
- **Melhor:** um ADR curto em [`docs/decisions/`](../decisions/) (feito:
  [`0022-sentry-error-monitoring.md`](../decisions/0022-sentry-error-monitoring.md)) — uma página: contexto (faltava visibilidade
  de exceptions), decisão (Sentry free), alternativas (Datadog, Rollbar/Bugsnag,
  logs do Vercel — ver a lista no ADR),
  consequências (PII em traces → ver [`05-legal-compliance.md`](./05-legal-compliance.md)
  sobre LGPD).

> 💡 Se ligar `sendDefaultPii: true` (IP/headers do usuário vão pro Sentry),
> isso é coleta de dado pessoal — cruze com a base legal e a política de
> privacidade em [`05-legal-compliance.md`](./05-legal-compliance.md). Pra Fase 2
> (amigos), o default mais conservador é **deixar `sendDefaultPii` desligado**.

## Uptime e saúde dos crons

### Saúde dos crons (de graça, já disponível)

A Vercel mostra cada execução de cron em **Project → Cron Jobs** com horário e
status HTTP. Confira lá se `settle-predictions` (09:00 UTC) e `spend-alert`
(23:00 UTC) rodaram. Lembre que ambos exigem `CRON_SECRET` (header
`Authorization: Bearer`) e a Vercel injeta isso sozinha nas execuções agendadas.

> ⚠️ O painel da Vercel **mostra** falhas mas não **te avisa** por conta própria
> de forma robusta no Hobby. Pra ser notificado quando um cron some, use um
> monitor externo (abaixo).

### Endpoint de health (opcional, recomendado)

Hoje **não existe** rota de health no app (as únicas routes são
`/api/auth/[...nextauth]` e os dois crons). Um endpoint trivial dá ao monitor
externo algo barato e público pra bater:

```typescript
// app/api/health/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, ts: new Date().toISOString() });
}
```

> ⚠️ Mantenha o `/api/health` **leve**: não toque no DB (Neon tem cold start
> ~1s e o monitor bateria a cada poucos minutos, segurando a função acordada à
> toa). Se quiser checar o DB, faça uma rota separada e com intervalo maior.

### Monitor externo gratuito

Aponte um monitor pra `https://SEU_DOMINIO/api/health` (ou pra `/` se não criar
o endpoint) e configure alerta por e-mail. Opções com free tier:

| Serviço | Free tier (confira no link — valores mudam) | Notas |
| --- | --- | --- |
| [UptimeRobot](https://uptimerobot.com/) | ~50 monitores, intervalo de 5 min, alertas por e-mail/Slack/webhook | Mais generoso pra uptime puro; tem também "heartbeat" (cron monitoring). |
| [Better Stack (Uptime)](https://betterstack.com/uptime) | ~10 monitores, checks a cada 30s, multi-região + incident mgmt | Mais features; bom se quiser status page. |
| [cron-job.org](https://cron-job.org/) | Jobs HTTP agendados grátis | Simples; pode bater num endpoint em intervalo fixo. |

> 💡 **Heartbeat/cron monitoring** (UptimeRobot, Cronitor, Better Stack) é o
> complemento certo pros **crons**: em vez de a Vercel chamar, você faz o cron
> "pingar" o monitor ao terminar — se o ping não chegar no horário esperado, o
> monitor te avisa. Isso pega o caso "o cron parou de rodar", que um check de
> uptime na home **não** detecta. Opcional pra Fase 2.

## Alternativas ao Sentry (logs)

Sentry é pra **erros**. Se você quiser **logs estruturados** pesquisáveis (não só
o que a Vercel guarda), há opções — mas pra Fase 2 isso é exagero. Tabela só pra
referência futura:

| Opção | Free tier (confira no link — muda) | Quando faz sentido |
| --- | --- | --- |
| [Vercel Log Drains](https://vercel.com/docs/log-drains) | Pago além do incluso (Vercel cobra por GB de transfer) | Encanar logs pra um destino externo; cuidado com custo de transfer. |
| [Axiom](https://axiom.co/pricing) | Plano free ~500 GB/mês de ingest | Logs/eventos em volume; tem integração Vercel (mas via Log Drains, que hoje cobra na Vercel). |
| [Better Stack Logs](https://betterstack.com/logs) | Free com retenção/volume limitados | Logs + uptime no mesmo lugar. |

> ⚠️ A integração **Axiom ↔ Vercel** depende de **Log Drains**, que a Vercel
> passou a **cobrar** (por GB de transfer) — então "Axiom é free" não significa
> "de graça ponta a ponta" no fluxo Vercel. Pra volume baixo dá pra usar a lib
> `next-axiom` (HTTP) em vez de Log Drains. Reavalie só se/quando precisar.

## Recomendação final

Pra fechar a Fase 2 redondinha, sem gastar:

1. **Sentry free (Developer)** — só Error Monitoring (server/edge primeiro),
   sample rates de tracing/replay baixos. Ligar o client + `tunnelRoute` depois.
2. **Manter o spend-alert** (já existe) ligado via `DAILY_AI_SPEND_ALERT_USD` +
   `SPEND_ALERT_EMAIL`.
3. **Monitor de uptime gratuito** (UptimeRobot) batendo em `/api/health` (criar a
   rota) ou na home, com alerta por e-mail. Opcional, mas barato e recomendado.
4. **Registrar a decisão** (commit `chore:` ou ADR curto), atento ao PII de
   traces vs. LGPD.

Não pagar Sentry agora. Reavaliar só se o volume de eventos crescer ou se a
Fase 3 (público) entrar em cena.

## Próximos passos e cross-links

- [`02-vercel-prod.md`](./02-vercel-prod.md) — onde setar `SENTRY_DSN` /
  `SENTRY_AUTH_TOKEN` na matriz de env vars, e onde ficam os Cron Logs.
- [`07-checklist-go-live.md`](./07-checklist-go-live.md) — item de go-live:
  "Sentry recebendo eventos + monitor de uptime ativo".
- [`05-legal-compliance.md`](./05-legal-compliance.md) — LGPD e PII em traces
  (`sendDefaultPii`).
- [`docs/decisions/`](../decisions/) — onde registrar o ADR do Sentry, se optar
  por um.
- [`.env.example`](../../.env.example) — env `SENTRY_DSN` (seção Observability).

> Incertezas honestas: preços e cotas (Sentry, UptimeRobot, Axiom, Vercel Log
> Drains) **mudam** — os números acima são estimativas atuais; sempre confirme no
> link oficial antes de decidir. A versão exata da API do `@sentry/nextjs` também
> evolui; siga a [doc oficial de setup](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
> se algum nome de arquivo/opção divergir.
