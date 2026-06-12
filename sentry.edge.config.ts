import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Distingue prod × preview no painel do Sentry. VERCEL_ENV é injetado pela
  // Vercel ("production"/"preview"/"development"); fora da Vercel cai em NODE_ENV.
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  // PII desligado explicitamente — é o default do SDK, fixado como invariante
  // (não enviamos IP/cookies). Ver ADR 0022 + docs/ops/05-legal-compliance.md.
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === "production",
});
