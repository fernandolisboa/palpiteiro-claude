import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://6e20653a3786e5ad70752c04f4786910@o4511552692748288.ingest.us.sentry.io/4511552779452416",

  // 10% sampling in production — raise to 1 locally or via env var if needed
  tracesSampleRate: 0.1,

  enableLogs: true,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
