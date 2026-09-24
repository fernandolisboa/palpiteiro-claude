/*
 * Generates team-id maps for sports-data adapters.
 *
 * Usage:
 *   pnpm tsx scripts/generate-team-ids.ts --provider=api-football
 *   pnpm tsx scripts/generate-team-ids.ts --provider=football-data-org
 *
 * What it does (per provider):
 * - Calls the provider's "teams in a competition" endpoint once per supported
 *   league.
 * - Writes `<provider>/team-ids.ts` as a CANONICAL-name -> provider-team-id
 *   map. Provider-native names are reconciled to canonical names via
 *   `canonicalizeTeamName` (exact + fuzzy) plus the explicit TEAM_NAME_ALIASES
 *   in `lib/providers/sports-data/team-names.ts` for spellings that don't
 *   fuzzy-match (national teams drift between providers, e.g. "Czechia" vs
 *   "Czech Republic"). Provider teams that still
 *   don't resolve, and canonical teams left without an id, are reported as
 *   warnings for manual aliasing.
 * - Seeds `canonical-teams.ts` for any league whose canonical list is still
 *   empty (bootstrap), from the provider being run. Already-populated leagues
 *   are kept as-is (their canonical source of truth is the provider that first
 *   seeded them). Run the PRIMARY provider first so new leagues are seeded from
 *   it (ADR-0005: canonical names come from the primary).
 *
 * Quota usage: one call per supported league.
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
import { canonicalizeTeamName } from "@/lib/providers/sports-data/team-names";

type Provider = "football-data-org" | "api-football";

type TeamEntry = { id: number; name: string };

function emptyByLeague<T>(make: () => T): Record<SupportedLeague, T> {
  return Object.fromEntries(
    SUPPORTED_LEAGUES.map((l) => [l, make()]),
  ) as Record<SupportedLeague, T>;
}

function parseArgs(): { provider: Provider } {
  const arg = process.argv.find((a) => a.startsWith("--provider="));
  if (!arg) {
    console.error("Missing --provider=<football-data-org|api-football>");
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
  if (!code) {
    console.log(`[fd-org] ${league}: not served by football-data.org — skipping.`);
    return [];
  }
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
  const json = (await res.json()) as {
    teams: Array<{ id: number; name: string }>;
  };
  console.log(
    `[fd-org] received ${json.teams.length} teams for ${league} (${code})`,
  );
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
  const out = emptyByLeague<string[]>(() => []);
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
    ` * Canonical team names per league. Each league is bootstrapped from the`,
    ` * provider that first populated it (run the primary provider first so new`,
    ` * leagues are seeded from it — ADR-0005). Re-run`,
    ` * \`scripts/generate-team-ids.ts\` to verify coverage and reconcile`,
    ` * spelling differences.`,
    ` *`,
    ` * Each adapter maintains its own \`team-ids.ts\` mapping these canonical`,
    ` * names to the provider-native team IDs. canonical-teams.test.ts asserts`,
    ` * both adapter maps cover 100% of this list (where the provider serves it).`,
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

/**
 * Resolves a provider-native team name to its canonical name. Seeded leagues
 * (canonical was just bootstrapped FROM this provider) use the provider name
 * verbatim — it IS the canonical name. Otherwise defer to the shared
 * `canonicalizeTeamName` (exact -> alias -> fuzzy); spelling drift is fixed by
 * adding entries to TEAM_NAME_ALIASES in team-names.ts.
 */
function resolveCanonicalKey(
  league: SupportedLeague,
  providerName: string,
  seeded: boolean,
): string | undefined {
  if (seeded) return providerName;
  return canonicalizeTeamName(providerName, league);
}

function writeProviderTeamIds(
  provider: Provider,
  teamsByLeague: Record<SupportedLeague, TeamEntry[]>,
  canonicalByLeague: Record<SupportedLeague, string[]>,
  seededLeagues: Set<SupportedLeague>,
): { missing: number; unmatched: number } {
  const folder =
    provider === "football-data-org" ? "football-data-org" : "api-football";
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

  const mapByLeague = emptyByLeague<Record<string, number>>(() => ({}));
  let missingTotal = 0;
  let unmatchedTotal = 0;
  for (const league of SUPPORTED_LEAGUES) {
    const seeded = seededLeagues.has(league);
    const unmatched: TeamEntry[] = [];
    for (const t of teamsByLeague[league]) {
      const key = resolveCanonicalKey(league, t.name, seeded);
      if (key === undefined) {
        unmatched.push(t);
        continue;
      }
      mapByLeague[league][key] = t.id;
    }
    // Informational: provider teams with no canonical home. Expected for some
    // leagues (e.g. API-Football's UCL endpoint returns qualifier teams that
    // never reached the league phase). Only worth aliasing if one of these is
    // actually a canonical team that should have matched.
    if (unmatched.length > 0) {
      unmatchedTotal += unmatched.length;
      console.log(
        `[team-ids] ${league}: ${unmatched.length} ${provider} team(s) outside the canonical list (info):\n  - ` +
          unmatched
            .map((t) => `${JSON.stringify(t.name)} (id ${t.id})`)
            .join("\n  - "),
      );
    }
    // Blocking: canonical teams with no provider id — coverage test will fail.
    const missing = canonicalByLeague[league].filter(
      (c) => !(c in mapByLeague[league]),
    );
    if (missing.length > 0) {
      missingTotal += missing.length;
      console.warn(
        `[team-ids] ${league}: ${missing.length} canonical team(s) have NO ${provider} id (add an alias in team-names.ts):\n  - ` +
          missing.join("\n  - "),
      );
    }
  }

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
    lines.push(`  ${league}: {`);
    for (const [name, id] of Object.entries(mapByLeague[league])) {
      lines.push(`    ${JSON.stringify(name)}: ${id},`);
    }
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
  return { missing: missingTotal, unmatched: unmatchedTotal };
}

async function main() {
  const { provider } = parseArgs();
  console.log(`Generating team-ids for ${provider}`);

  const teamsByLeague = emptyByLeague<TeamEntry[]>(() => []);
  for (const league of SUPPORTED_LEAGUES) {
    teamsByLeague[league] =
      provider === "football-data-org"
        ? await fetchFootballDataOrgTeams(league)
        : await fetchApiFootballTeams(league);
  }

  // Reconcile canonical-teams.ts: seed empty leagues from this provider, keep
  // already-populated leagues untouched.
  const existing = loadCanonicalTeams();
  const merged = emptyByLeague<string[]>(() => []);
  const seededLeagues = new Set<SupportedLeague>();
  for (const league of SUPPORTED_LEAGUES) {
    // A provider that doesn't serve the league (no teams back) never seeds it.
    if (existing[league].length === 0 && teamsByLeague[league].length > 0) {
      merged[league] = teamsByLeague[league].map((t) => t.name).sort();
      seededLeagues.add(league);
      console.log(
        `[canonical] ${league}: empty — seeding ${merged[league].length} names from ${provider}.`,
      );
    } else {
      merged[league] = [...existing[league]];
    }
  }
  if (seededLeagues.size > 0) {
    writeCanonicalTeams(merged);
  } else {
    console.log(`[canonical] all leagues already populated — not overwriting.`);
  }

  const { missing, unmatched } = writeProviderTeamIds(
    provider,
    teamsByLeague,
    merged,
    seededLeagues,
  );

  const total = SUPPORTED_LEAGUES.reduce(
    (n, l) => n + teamsByLeague[l].length,
    0,
  );
  const breakdown = SUPPORTED_LEAGUES.map(
    (l) => `${teamsByLeague[l].length} ${l}`,
  ).join(" + ");
  console.log(
    `\nDone. Fetched ${total} teams (${breakdown}). API calls used: ${SUPPORTED_LEAGUES.length}.`,
  );
  if (missing > 0) {
    console.warn(
      `\nBLOCKING: ${missing} canonical team(s) have no ${provider} id — add aliases to TEAM_NAME_ALIASES in team-names.ts and re-run, or the coverage test will fail.`,
    );
  } else {
    console.log(`\nAll canonical teams covered by ${provider}. ✓`);
  }
  if (unmatched > 0) {
    console.log(
      `(${unmatched} ${provider} team(s) outside the canonical list — informational, e.g. UCL qualifiers.)`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
