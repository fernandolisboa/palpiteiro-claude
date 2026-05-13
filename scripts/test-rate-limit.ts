/*
 * Manual validation for issue #23 — proves that the rate limiter SPACES real
 * API calls instead of letting bursts through.
 *
 * What it does:
 *  - Fires 10 calls to API-Football /status in parallel (intentional burst).
 *  - /status does NOT consume the daily quota (confirmed via response counter:
 *    `requests.current` stays constant before/after the run).
 *  - Logs each dispatch + arrival with a relative timestamp.
 *  - Aborts immediately on 429 or quota errors.
 *
 * Expected behavior:
 *  - api-football client config: concurrency=2, throttle=8 req/min.
 *  - Calls 1-8 dispatch within the first ~2s (pairs of 2).
 *  - Calls 9 and 10 wait until the sliding window frees a slot (~60s after
 *    calls 1 and 2 respectively).
 *  - Total duration: ~62-75s, no 429.
 *
 * Total real calls consumed: 10, all to /status (0 against daily quota).
 *
 * Run: pnpm tsx scripts/test-rate-limit.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { getApiStatus } from "@/lib/providers/sports-data/api-football/adapter";
import { ApiFootballHttpError } from "@/lib/providers/sports-data/api-football/errors";

const TOTAL_CALLS = 10;

async function main(): Promise<void> {
  if (!process.env.API_FOOTBALL_KEY) {
    throw new Error(
      "API_FOOTBALL_KEY not set — create .env.local from .env.example",
    );
  }

  console.log("─── Rate limit validation (issue #23) ───");
  console.log(
    `Plan: ${TOTAL_CALLS} parallel calls to /status. ` +
      `Expected spacing: ~62-75s total (concurrency=2, throttle=8/min).`,
  );

  const startMs = Date.now();
  const promises: Array<Promise<void>> = [];
  let aborted = false;

  for (let i = 1; i <= TOTAL_CALLS; i++) {
    const callNum = i;
    console.log(`[call ${callNum}/${TOTAL_CALLS}] dispatching`);
    promises.push(
      (async () => {
        try {
          const t0 = Date.now();
          const status = await getApiStatus();
          const t1 = Date.now();
          console.log(
            `[call ${callNum}/${TOTAL_CALLS}] done — ` +
              `t=${((t1 - startMs) / 1000).toFixed(2)}s ` +
              `latency=${t1 - t0}ms ` +
              `requests=${status.requests.current}/${status.requests.limit_day} ` +
              `plan=${status.subscription?.plan ?? "?"}`,
          );
        } catch (err) {
          if (
            err instanceof ApiFootballHttpError &&
            (err.status === 429 || err.status === 403)
          ) {
            console.error(
              `[call ${callNum}/${TOTAL_CALLS}] ABORT — HTTP ${err.status} ` +
                `(likely quota/ban): ${err.body.slice(0, 200)}`,
            );
            aborted = true;
            return;
          }
          console.error(
            `[call ${callNum}/${TOTAL_CALLS}] failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          aborted = true;
          throw err;
        }
      })(),
    );
  }

  await Promise.allSettled(promises);
  const totalMs = Date.now() - startMs;

  console.log("─── Summary ───");
  console.log(`Total calls: ${TOTAL_CALLS}`);
  console.log(`Duration: ${(totalMs / 1000).toFixed(2)}s`);
  console.log(`Aborted: ${aborted}`);
  console.log(
    `Throttle target: 8 req/min — for 10 calls expect ~62-75s (calls 9 and ` +
      `10 wait one window).`,
  );

  if (aborted) {
    console.error("FAIL — at least one call aborted or returned an error.");
    process.exit(1);
  }
  if (totalMs < 50_000) {
    console.error(
      `FAIL — duration ${(totalMs / 1000).toFixed(2)}s is too short; ` +
        `throttle did not enforce spacing.`,
    );
    process.exit(2);
  }
  console.log("PASS — rate limiter spaced 10 calls into the expected window.");
}

main().catch((err) => {
  console.error(err);
  process.exit(99);
});
