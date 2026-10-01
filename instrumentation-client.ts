import * as Sentry from "@sentry/nextjs";
import { config as zodConfig } from "zod/v4/core";

// A CSP não libera eval (#467, ADR 0040). Sem isto, o Zod 4 testa `Function("")` na
// primeira validação de objeto pra decidir se compila schemas (JIT); o teste falha em
// silêncio, mas o browser reporta a violação ao Sentry a cada carga de página. Com
// `jitless` ele pula o teste e valida do mesmo jeito, sem JIT.
zodConfig({ jitless: true });

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // No browser VERCEL_ENV não existe — usar NEXT_PUBLIC_VERCEL_ENV (a Vercel
  // injeta quando "Enable access to System Environment Variables" está ligado;
  // senão cai em NODE_ENV e o preview acaba marcado como "production").
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  // PII desligado explicitamente — é o default do SDK, fixado como invariante
  // (não anexa IP nem valores de cookie). Ver ADR 0022 + docs/ops/05-legal-compliance.md.
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === "production",
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
