import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Distingue prod × preview no painel do Sentry. VERCEL_ENV é injetado pela
  // Vercel ("production"/"preview"/"development"); fora da Vercel cai em NODE_ENV.
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  enableLogs: true,
  enabled: process.env.NODE_ENV === "production",
});
