/*
 * Generates team-id maps for sports-data adapters.
 *
 * Usage:
 *   pnpm tsx scripts/generate-team-ids.ts --provider=football-data-org
 *   pnpm tsx scripts/generate-team-ids.ts --provider=api-football
 *
 * What it does (per provider):
 * - Calls the provider's "teams in a competition" endpoint once per league.
 * - Writes the resulting `<provider>/team-ids.ts` with a canonical-name →
 *   provider-team-id map.
 * - If `canonical-teams.ts` is empty, also seeds it from the provider's team
 *   names — useful for bootstrap. Otherwise verifies coverage and reports
 *   mismatches (does NOT overwrite once populated).
 *
 * Quota usage: 2 calls per provider (one per supported league).
 *
 * Reads keys from .env.local.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  FOOTBALL_DATA_ORG_LEAGUE_CODES,
  API_FOOTBALL_LEAGUE_IDS,
  SUPPORTED_LEAGUES,
  currentSeason,
  type SupportedLeague,
} from "@/lib/providers/sports-data/leagues";

type Provider = "football-data-org" | "api-football";

type TeamEntry = { id: number | string; name: string };

function parseArgs(): { provider: Provider } {
  const arg = process.argv.find((a) => a.startsWith("--provider="));
  if (!arg) {
    console.error(
      "Missing --provider=<football-data-org|api-football>",
    );
    process.exit(1);
  }
  const value = arg.slice("--provider=".length);
  if (value !== "football-data-org" && value !== "api-football") {
    console.error(`Invalid provider: ${value}`);
    process.exit(1);
  }
  return { provider: value };
}

async function fetchFootballDataOrgTeams(
  league: SupportedLeague,
): Promise<TeamEntry[]> {
  const code = FOOTBALL_DATA_ORG_LEAGUE_CODES[league];
  const key = process.env.FOOTBALL_DATA_ORG_API_KEY;
  if (!key) throw new Error("FOOTBALL_DATA_ORG_API_KEY not set");
  const url = `https://api.football-data.org/v4/competitions/${code}/teams`;
  console.log(`[fd-org] GET ${url}`);
  const res = await fetch(url, { headers: { "X-Auth-Token": key } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `football-data.org GET ${url} -> HTTP ${res.status}\n${body.slice(0, 500)}`,
    );
  }
  const json = (await res.json()) as { teams: Array<{ id: number; name: string }> };
  console.log(`[fd-org] received ${json.teams.length} teams for ${league} (${code})`);
  return json.teams.map((t) => ({ id: t.id, name: t.name }));
}

async function fetchApiFootballTeams(
  league: SupportedLeague,
): Promise<TeamEntry[]> {
  const id = API_FOOTBALL_LEAGUE_IDS[league];
  const season = currentSeason(league);
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error("API_FOOTBALL_KEY not set");
  const url = `https://v3.football.api-sports.io/teams?league=${id}&season=${season}`;
  console.log(`[api-football] GET ${url}`);
  const res = await fetch(url, { headers: { "x-apisports-key": key } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `api-football GET ${url} -> HTTP ${res.status}\n${body.slice(0, 500)}`,
    );
  }
  const json = (await res.json()) as {
    errors?: unknown;
    response: Array<{ team: { id: number; name: string } }>;
  };
  if (
    json.errors &&
    (Array.isArray(json.errors)
      ? json.errors.length > 0
      : Object.keys(json.errors).length > 0)
  ) {
    throw new Error(
      `api-football returned errors:\n${JSON.stringify(json.errors, null, 2)}`,
    );
  }
  console.log(
    `[api-football] received ${json.response.length} teams for ${league} (${id}, season ${season})`,
  );
  return json.response.map((r) => ({ id: r.team.id, name: r.team.name }));
}

function loadCanonicalTeams(): Record<SupportedLeague, string[]> {
  const path = resolve(
    process.cwd(),
    "lib/providers/sports-data/canonical-teams.ts",
  );
  const src = readFileSync(path, "utf8");
  // Naive parse: extract array literal for each league.
  const out: Record<SupportedLeague, string[]> = {
    brasileirao_a: [],
    champions_league: [],
  };
  for (const league of SUPPORTED_LEAGUES) {
    const m = src.match(new RegExp(`${league}:\\s*\\[([^\\]]*)\\]`, "s"));
    if (!m) continue;
    const inner = m[1] ?? "";
    const names = Array.from(inner.matchAll(/"([^"]+)"/g)).map((mm) => mm[1]);
    out[league] = names.filter((n): n is string => Boolean(n));
  }
  return out;
}

function writeCanonicalTeams(
  teamsByLeague: Record<SupportedLeague, string[]>,
): void {
  const path = resolve(
    process.cwd(),
    "lib/providers/sports-data/canonical-teams.ts",
  );
  const lines = [
    `import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";`,
    ``,
    `/**`,
    ` * Canonical team names per league. Bootstrap source: football-data.org`,
    ` * /v4/competitions/{code}/teams. When API-Football is reachable, run`,
    ` * \`pnpm tsx scripts/generate-team-ids.ts --provider=api-football\` to`,
    ` * verify coverage and reconcile any spelling differences.`,
    ` *`,
    ` * Each adapter maintains its own \`team-ids.ts\` mapping these canonical`,
    ` * names to the provider-native team IDs. canonical-teams.test.ts asserts`,
    ` * both adapter maps cover 100% of this list.`,
    ` */`,
    `export const CANONICAL_TEAMS: Record<SupportedLeague, readonly string[]> = {`,
  ];
  for (const league of SUPPORTED_LEAGUES) {
    const names = teamsByLeague[league];
    lines.push(`  ${league}: [`);
    for (const n of names) lines.push(`    ${JSON.stringify(n)},`);
    lines.push(`  ] as const,`);
  }
  lines.push(`};`);
  lines.push(``);
  lines.push(
    `export function isCanonicalTeam(name: string, league: SupportedLeague): boolean {`,
  );
  lines.push(`  return CANONICAL_TEAMS[league].includes(name);`);
  lines.push(`}`);
  lines.push(``);
  writeFileSync(path, lines.join("\n"));
  console.log(`Wrote ${path}`);
}

function writeProviderTeamIds(
  provider: Provider,
  teamsByLeague: Record<SupportedLeague, TeamEntry[]>,
): void {
  const folder = provider === "football-data-org" ? "football-data-org" : "api-football";
  const constName =
    provider === "football-data-org"
      ? "FOOTBALL_DATA_ORG_TEAM_IDS"
      : "API_FOOTBALL_TEAM_IDS";
  const sourceNote =
    provider === "football-data-org"
      ? "Generated from /v4/competitions/{code}/teams."
      : "Generated from /teams?league=X&season=Y.";
  const path = resolve(
    process.cwd(),
    `lib/providers/sports-data/${folder}/team-ids.ts`,
  );
  const lines = [
    `import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";`,
    ``,
    `/**`,
    ` * Canonical-name -> provider-native team ID map for ${provider}.`,
    ` * ${sourceNote}`,
    ` * Re-run scripts/generate-team-ids.ts to refresh.`,
    ` */`,
    `export const ${constName}: Record<SupportedLeague, Readonly<Record<string, number>>> = {`,
  ];
  for (const league of SUPPORTED_LEAGUES) {
    const teams = teamsByLeague[league];
    lines.push(`  ${league}: {`);
    for (const t of teams) lines.push(`    ${JSON.stringify(t.name)}: ${t.id},`);
    lines.push(`  },`);
  }
  lines.push(`};`);
  lines.push(``);
  lines.push(
    `export function resolveTeamId(name: string, league: SupportedLeague): number | undefined {`,
  );
  lines.push(`  return ${constName}[league][name];`);
  lines.push(`}`);
  lines.push(``);
  writeFileSync(path, lines.join("\n"));
  console.log(`Wrote ${path}`);
}

async function main() {
  const { provider } = parseArgs();
  console.log(`Generating team-ids for ${provider}`);

  const teamsByLeague: Record<SupportedLeague, TeamEntry[]> = {
    brasileirao_a: [],
    champions_league: [],
  };
  for (const league of SUPPORTED_LEAGUES) {
    const teams =
      provider === "football-data-org"
        ? await fetchFootballDataOrgTeams(league)
        : await fetchApiFootballTeams(league);
    teamsByLeague[league] = teams;
  }

  // Reconcile canonical-teams.ts.
  const existing = loadCanonicalTeams();
  const anyExisting = SUPPORTED_LEAGUES.some((l) => existing[l].length > 0);
  if (!anyExisting) {
    console.log(
      `[canonical] canonical-teams.ts is empty — seeding from ${provider}.`,
    );
    const namesByLeague: Record<SupportedLeague, string[]> = {
      brasileirao_a: teamsByLeague.brasileirao_a.map((t) => t.name).sort(),
      champions_league: teamsByLeague.champions_league.map((t) => t.name).sort(),
    };
    writeCanonicalTeams(namesByLeague);
  } else {
    console.log(`[canonical] verifying coverage against existing list`);
    let mismatches = 0;
    for (const league of SUPPORTED_LEAGUES) {
      const providerNames = new Set(teamsByLeague[league].map((t) => t.name));
      const missing = existing[league].filter((n) => !providerNames.has(n));
      if (missing.length > 0) {
        console.warn(
          `[canonical] ${league}: ${missing.length} canonical team(s) missing from ${provider}:\n  - ` +
            missing.join("\n  - "),
        );
        mismatches += missing.length;
      }
      const extras = teamsByLeague[league]
        .map((t) => t.name)
        .filter((n) => !existing[league].includes(n));
      if (extras.length > 0) {
        console.log(
          `[canonical] ${league}: ${provider} has ${extras.length} extra team(s) not in canonical list (ignored):\n  - ` +
            extras.join("\n  - "),
        );
      }
    }
    if (mismatches > 0) {
      console.warn(
        `[canonical] ${mismatches} canonical team(s) lack a mapping from ${provider}.`,
      );
    } else {
      console.log(`[canonical] all canonical teams covered by ${provider}.`);
    }
  }

  writeProviderTeamIds(provider, teamsByLeague);

  const total =
    teamsByLeague.brasileirao_a.length + teamsByLeague.champions_league.length;
  console.log(
    `\nDone. Wrote ${total} teams (${teamsByLeague.brasileirao_a.length} BSA + ${teamsByLeague.champions_league.length} CL). API calls used: 2.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
