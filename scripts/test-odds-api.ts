import { config } from "dotenv";
config({ path: ".env.local" });

import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";
import {
  getOddsForSport,
  getSports,
} from "@/lib/providers/odds-api";
import { SPORT_KEYS } from "@/lib/providers/odds-api-constants";
import type {
  OddsApiBookmaker,
  OddsApiEventOdds,
} from "@/lib/providers/odds-api-schemas";

function formatPct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function findTotalsBookmaker(
  event: OddsApiEventOdds,
):
  | { bookmaker: OddsApiBookmaker; point: number; overOdd: number; underOdd: number }
  | undefined {
  // Prefer the bookmaker offering line 2.5 (project focus); fall back to first
  // bookmaker that exposes a totals market with both Over and Under outcomes.
  const candidates: Array<{
    bookmaker: OddsApiBookmaker;
    point: number;
    overOdd: number;
    underOdd: number;
  }> = [];
  for (const bookmaker of event.bookmakers) {
    const totals = bookmaker.markets.find((m) => m.key === "totals");
    if (!totals) continue;
    const byPoint = new Map<
      number,
      { over?: number; under?: number }
    >();
    for (const o of totals.outcomes) {
      if (o.point === undefined) continue;
      const slot = byPoint.get(o.point) ?? {};
      if (o.name.toLowerCase() === "over") slot.over = o.price;
      if (o.name.toLowerCase() === "under") slot.under = o.price;
      byPoint.set(o.point, slot);
    }
    for (const [point, slot] of byPoint) {
      if (slot.over !== undefined && slot.under !== undefined) {
        candidates.push({
          bookmaker,
          point,
          overOdd: slot.over,
          underOdd: slot.under,
        });
      }
    }
  }
  if (candidates.length === 0) return undefined;
  const exact = candidates.find((c) => c.point === 2.5);
  return exact ?? candidates[0];
}

async function main() {
  if (!process.env.ODDS_API_KEY) {
    throw new Error(
      "ODDS_API_KEY not set — create .env.local from .env.example",
    );
  }

  console.log("─── The Odds API smoke test ───");

  // 1. Discover sports (free call — no quota cost).
  const sports = await getSports();
  const brasileirao = sports.find((s) => s.key === SPORT_KEYS.BRASILEIRAO_A);
  const champions = sports.find((s) => s.key === SPORT_KEYS.CHAMPIONS_LEAGUE);
  const worldCup = sports.find((s) => s.key === SPORT_KEYS.WORLD_CUP);
  console.log(
    `Sports (${sports.length} total): Brasileirão=${brasileirao?.active ? "active" : "missing/inactive"}, ` +
      `Champions=${champions?.active ? "active" : "missing/inactive"}, ` +
      `World Cup=${worldCup?.active ? "active" : "missing/inactive"}`,
  );

  if (!brasileirao || !brasileirao.active) {
    throw new Error(
      `Brasileirão slug ${SPORT_KEYS.BRASILEIRAO_A} not active — check getSports() output`,
    );
  }

  // 2. Fetch upcoming totals for Brasileirão (1 billable call: 1 region × 1 market).
  console.log(`\nFetching ${SPORT_KEYS.BRASILEIRAO_A} totals (region=eu)…`);
  let events = await getOddsForSport(SPORT_KEYS.BRASILEIRAO_A, {
    markets: ["totals"],
    regions: ["eu"],
  });

  // Fall back to Champions if Brasileirão is in the off-season window.
  if (events.length === 0 && champions?.active) {
    console.log(
      "  (No Brasileirão games in the API's window — falling back to Champions League)",
    );
    events = await getOddsForSport(SPORT_KEYS.CHAMPIONS_LEAGUE, {
      markets: ["totals"],
      regions: ["eu"],
    });
  }

  console.log(`Got ${events.length} event(s) with totals odds.\n`);

  if (events.length === 0) {
    console.log("(No events at all — nothing to drill into. Try again in-season.)");
  } else {
    for (const event of events.slice(0, 5)) {
      const kickoff = event.commence_time.replace("T", " ").slice(0, 16);
      console.log(
        `▶ ${event.home_team} vs ${event.away_team} — ${kickoff} UTC (id=${event.id})`,
      );
      const pick = findTotalsBookmaker(event);
      if (!pick) {
        console.log("    (no bookmaker offers totals market for this event)");
        continue;
      }
      const implied = computeMarketImpliedProbabilities([
        pick.overOdd,
        pick.underOdd,
      ]);
      console.log(
        `    [${pick.bookmaker.title}] line=${pick.point} ` +
          `over=${pick.overOdd.toFixed(2)} under=${pick.underOdd.toFixed(2)} ` +
          `overround=${formatPct(implied.overround)}`,
      );
      console.log(
        `    implied (normalized): over=${formatPct(implied.probs[0])} under=${formatPct(implied.probs[1])}`,
      );
    }
  }

  // 2b. World Cup totals (issue #38) — confirm the Copa is covered with O/U.
  if (worldCup?.active) {
    console.log(`\nFetching ${SPORT_KEYS.WORLD_CUP} totals (region=eu)…`);
    const wcEvents = await getOddsForSport(SPORT_KEYS.WORLD_CUP, {
      markets: ["totals"],
      regions: ["eu"],
    });
    const withTotals = wcEvents.filter((e) => findTotalsBookmaker(e));
    console.log(
      `Got ${wcEvents.length} World Cup event(s), ${withTotals.length} with a totals market.`,
    );
    const sample = withTotals[0];
    if (sample) {
      const pick = findTotalsBookmaker(sample)!;
      console.log(
        `  e.g. ${sample.home_team} vs ${sample.away_team}: [${pick.bookmaker.title}] ` +
          `line=${pick.point} over=${pick.overOdd.toFixed(2)} under=${pick.underOdd.toFixed(2)}`,
      );
    }
  } else {
    console.log(
      `\n[world_cup] ${SPORT_KEYS.WORLD_CUP} not active — Copa odds unavailable.`,
    );
  }

  // 3. Cache demo — re-request should hit the in-memory cache.
  console.log("\n─── Cache demo ───");
  console.log("Re-calling getOddsForSport — expect cache_hit=true:");
  await getOddsForSport(SPORT_KEYS.BRASILEIRAO_A, {
    markets: ["totals"],
    regions: ["eu"],
  });

  console.log(
    "\nBillable calls expected this run: up to 2 (Brasileirão/Champions totals + World Cup totals; /sports is free; the cache demo re-call is free).",
  );
  console.log("Done.");
}

main().catch((err) => {
  console.error("Smoke test failed:");
  console.error(err);
  process.exit(1);
});
