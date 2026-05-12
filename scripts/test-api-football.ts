import { config } from "dotenv";
config({ path: ".env.local" });

import {
  getApiStatus,
  getFixturesByDate,
  getH2H,
  getLineups,
  getStandings,
} from "@/lib/providers/api-football";
import { LEAGUE_IDS } from "@/lib/providers/api-football-constants";

// Free plan has dual limits: only ±1 day of today's date AND seasons 2022–2024
// for season-scoped queries. Day-of fixture queries (no league filter) work in
// the live window; standings are queried against the latest allowed season.
const STANDINGS_SEASON = 2024;

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatFixture(f: {
  fixture: { id: number; date: string; status: { short: string; long: string } };
  teams: { home: { name: string }; away: { name: string } };
}): string {
  const date = new Date(f.fixture.date);
  const when = date.toISOString().replace("T", " ").slice(0, 16);
  return `  [${f.fixture.status.short}] ${f.teams.home.name} vs ${f.teams.away.name} — ${when} UTC (id=${f.fixture.id})`;
}

async function main() {
  if (!process.env.API_FOOTBALL_KEY) {
    throw new Error(
      "API_FOOTBALL_KEY not set — create .env.local from .env.example",
    );
  }

  console.log("─── API-Football smoke test ───");
  console.log(
    "(Free plan: only ±1 day of today + seasons 2022–2024 for league queries.)",
  );

  const statusBefore = await getApiStatus();
  console.log(
    `Status (before): plan=${statusBefore.subscription?.plan ?? "?"}, ` +
      `requests=${statusBefore.requests.current}/${statusBefore.requests.limit_day}`,
  );
  const callsBefore = statusBefore.requests.current;

  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const dates = [toDateString(today), toDateString(tomorrow)];

  const allFixtures: Awaited<ReturnType<typeof getFixturesByDate>> = [];
  for (const date of dates) {
    console.log(`\nFixtures on ${date} (all leagues — filtering for Brasileirão):`);
    const fixtures = await getFixturesByDate(date);
    const brasileirao = fixtures.filter(
      (f) => f.league.id === LEAGUE_IDS.BRASILEIRAO_A,
    );
    if (brasileirao.length > 0) {
      for (const f of brasileirao) console.log(formatFixture(f));
      allFixtures.push(...brasileirao);
    } else if (fixtures.length > 0) {
      console.log(
        `  (no Brasileirão games — falling back to ${fixtures.length} other fixtures)`,
      );
      for (const f of fixtures.slice(0, 5)) console.log(formatFixture(f));
      allFixtures.push(...fixtures);
    } else {
      console.log("  (no fixtures at all on this date)");
    }
  }

  const target = allFixtures[0];

  if (!target) {
    console.log("\nNo Brasileirão fixtures in the next 48h to drill into.");
  } else {
    console.log(
      `\nDrilling into fixture id=${target.fixture.id}: ` +
        `${target.teams.home.name} vs ${target.teams.away.name}`,
    );

    // Free plan rejects `last` on /fixtures/headtohead; call without it and slice client-side.
    const [h2h, standings, lineups] = await Promise.all([
      getH2H(target.teams.home.id, target.teams.away.id),
      getStandings(LEAGUE_IDS.BRASILEIRAO_A, STANDINGS_SEASON),
      getLineups(target.fixture.id),
    ]);

    console.log(`\nH2H (last ${h2h.length}):`);
    for (const f of h2h.slice(0, 5)) {
      const date = f.fixture.date.slice(0, 10);
      console.log(
        `  ${date}: ${f.teams.home.name} ${f.goals.home ?? "-"} x ${f.goals.away ?? "-"} ${f.teams.away.name}`,
      );
    }

    console.log("\nStandings (top 5):");
    const table = standings?.league.standings?.[0] ?? [];
    for (const row of table.slice(0, 5)) {
      console.log(
        `  ${String(row.rank).padStart(2)}. ${row.team.name.padEnd(22)} ` +
          `P=${row.points} J=${row.all.played} GD=${row.goalsDiff}`,
      );
    }

    console.log("\nLineups:");
    if (lineups.length === 0) {
      console.log("  (lineups not yet published — typically ~1h before kickoff)");
    } else {
      for (const l of lineups) {
        console.log(
          `  ${l.team.name} (${l.formation ?? "?"}) — ${l.startXI.length} starters`,
        );
      }
    }
  }

  console.log("\n─── Cache demo ───");
  console.log("Re-calling getFixturesByDate(today) — expect cache_hit=true:");
  await getFixturesByDate(toDateString(today));

  const statusAfter = await getApiStatus();
  console.log(
    `\nStatus (after): requests=${statusAfter.requests.current}/${statusAfter.requests.limit_day}`,
  );
  console.log(
    `Delta on requests counter: ${statusAfter.requests.current - callsBefore} ` +
      `(API's counter may lag by a few minutes; cross-check at api-football.com dashboard).`,
  );
  console.log(
    "Expected real billable calls this run: ~6 (2 fixtures-by-date, 1 H2H, 1 standings, 1 lineups, plus 1 /status which is free).",
  );
  console.log("Done.");
}

main().catch((err) => {
  console.error("Smoke test failed:");
  console.error(err);
  process.exit(1);
});
