import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default withSentryConfig(nextConfig, {
  // Lidos do env (Vercel build + .env.local) — sem hard-code. Ausentes, o
  // plugin só pula o upload de source maps (build não falha).
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  silent: !process.env.CI,

  // Upload a larger set of source maps for prettier stack traces
  widenClientFileUpload: true,

  // Route browser events through Next.js to avoid adblocker interference
  tunnelRoute: "/monitoring",

  // Instrument Vercel Cron jobs automatically
  automaticVercelMonitors: true,
});
