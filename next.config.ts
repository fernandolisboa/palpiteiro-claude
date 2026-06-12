import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default withSentryConfig(nextConfig, {
  org: "filx-tecnologia",
  project: "javascript-nextjs",

  silent: !process.env.CI,

  // Upload a larger set of source maps for prettier stack traces
  widenClientFileUpload: true,

  // Route browser events through Next.js to avoid adblocker interference
  tunnelRoute: "/monitoring",

  // Instrument Vercel Cron jobs automatically
  automaticVercelMonitors: true,
});
