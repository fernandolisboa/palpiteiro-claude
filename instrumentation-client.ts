import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // No browser VERCEL_ENV não existe — usar NEXT_PUBLIC_VERCEL_ENV (a Vercel
  // injeta quando "Expose System Environment Variables" está ligado; senão cai
  // em NODE_ENV e o preview acaba marcado como "production").
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  enableLogs: true,
  enabled: process.env.NODE_ENV === "production",
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
