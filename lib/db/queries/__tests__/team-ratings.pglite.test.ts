// @vitest-environment node
//
// team_rating_fits + team_ratings (ADR 0051) contra Postgres REAL (pglite): troca
// atômica do fit da liga, leitura dos dois times do jogo e o resumo do admin.
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";

let realDb: PgliteDatabase<typeof schema>;
let client: PGlite;

vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = (realDb as any)[prop];
        return typeof v === "function" ? v.bind(realDb) : v;
      },
    }
  ),
}));

import {
  getCachedSeasonResults,
  getLeagueFitInfo,
  getMatchRatings,
  listLeagueFits,
  replaceLeagueRatings,
  saveSeasonResults,
} from "@/lib/db/queries/team-ratings";

const T1 = new Date("2026-09-25T07:00:00Z");
const T2 = new Date("2026-09-26T07:00:00Z");

beforeAll(async () => {
  client = new PGlite();
  const base = drizzle(client, { schema, casing: "snake_case" });
  // neon-http tem db.batch (transação); o pglite não — shim sequencial.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (base as any).batch = async (qs: unknown[]) => {
    const out: unknown[] = [];
    for (const q of qs) out.push(await q);
    return out;
  };
  realDb = base;
  await migrate(base, { migrationsFolder: "./db/migrations" });
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe("team ratings", () => {
  it("sem fit → tudo null", async () => {
    expect(await getMatchRatings("brasileirao_a", "A", "B")).toEqual({
      fit: null,
      home: null,
      away: null,
    });
  });

  it("grava o fit e lê os dois times; time desconhecido = null", async () => {
    await replaceLeagueRatings({
      league: "brasileirao_a",
      homeAdvantage: 1.3,
      rho: -0.07,
      matchCount: 900,
      seasons: [2026, 2025, 2024],
      fittedAt: T1,
      teams: [
        { team: "A", attack: 1.2, defence: 0.9, matches: 80 },
        { team: "B", attack: 0.8, defence: 1.1, matches: 5 },
        { team: "C", attack: 1.0, defence: 1.0, matches: 40 },
      ],
    });
    expect(await getMatchRatings("brasileirao_a", "A", "B")).toEqual({
      fit: { homeAdvantage: 1.3, rho: -0.07, fittedAt: T1 },
      home: { attack: 1.2, defence: 0.9, matches: 80 },
      away: { attack: 0.8, defence: 1.1, matches: 5 },
    });
    expect((await getMatchRatings("brasileirao_a", "A", "Z")).away).toBeNull();
    // Outra liga não vê os ratings desta.
    expect((await getMatchRatings("la_liga", "A", "B")).fit).toBeNull();
  });

  it("refit troca a liga inteira: time que saiu do fit some", async () => {
    await replaceLeagueRatings({
      league: "brasileirao_a",
      homeAdvantage: 1.25,
      rho: -0.05,
      matchCount: 910,
      seasons: [2026, 2025, 2024],
      fittedAt: T2,
      teams: [
        { team: "A", attack: 1.3, defence: 0.85, matches: 81 },
        { team: "B", attack: 0.9, defence: 1.0, matches: 6 },
      ],
    });
    const r = await getMatchRatings("brasileirao_a", "A", "C");
    expect(r.fit).toEqual({ homeAdvantage: 1.25, rho: -0.05, fittedAt: T2 });
    expect(r.home).toEqual({ attack: 1.3, defence: 0.85, matches: 81 });
    expect(r.away).toBeNull();
  });

  it("resumo do admin conta times e times utilizáveis (>= mínimo de jogos)", async () => {
    expect(await listLeagueFits()).toEqual([
      {
        league: "brasileirao_a",
        homeAdvantage: 1.25,
        rho: -0.05,
        matchCount: 910,
        seasons: [2026, 2025, 2024],
        fittedAt: T2,
        teamCount: 2,
        usableTeamCount: 1,
      },
    ]);
  });

  it("getLeagueFitInfo: data e temporadas do fit; null sem fit", async () => {
    expect(await getLeagueFitInfo("brasileirao_a")).toEqual({
      fittedAt: T2,
      seasons: [2026, 2025, 2024],
    });
    expect(await getLeagueFitInfo("la_liga")).toBeNull();
  });

  it("fit sem nenhum dos dois times → fit presente, times null", async () => {
    expect(await getMatchRatings("brasileirao_a", "X", "Y")).toEqual({
      fit: { homeAdvantage: 1.25, rho: -0.05, fittedAt: T2 },
      home: null,
      away: null,
    });
  });
});

describe("cache de temporadas encerradas", () => {
  const MATCHES = [
    { kickoffMs: 1, home: "A", away: "B", homeGoals: 2, awayGoals: 1 },
  ];

  it("guarda, relê só as pedidas e sobrescreve", async () => {
    await saveSeasonResults("la_liga", 2024, MATCHES, T1);
    await saveSeasonResults("la_liga", 2023, [], T1);
    const cached = await getCachedSeasonResults("la_liga", [2025, 2024]);
    expect([...cached.keys()]).toEqual([2024]);
    expect(cached.get(2024)).toEqual(MATCHES);

    await saveSeasonResults("la_liga", 2024, [], T2);
    expect(
      (await getCachedSeasonResults("la_liga", [2024])).get(2024)
    ).toEqual([]);
    expect((await getCachedSeasonResults("la_liga", [])).size).toBe(0);
  });
});
