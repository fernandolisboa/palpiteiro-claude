import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Página do time (#574 linha 10): os próximos jogos leem as odds em lote do banco,
// como /jogos, em vez de "sem odd". Tudo mockado: sem DB, sem rede.
vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u-1" } })) }));
vi.mock("@/lib/server/request-timezone", () => ({
  getRequestTimeZone: vi.fn(async () => "America/Sao_Paulo"),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn(),
}));
vi.mock("@/lib/db/queries/matches", () => ({ getMatchesByTeam: vi.fn() }));
vi.mock("@/lib/db/queries/odds-snapshots", () => ({
  getLatestOverUnderSnapshotsForMatches: vi.fn(),
  getLatestSelectionOddsSnapshotsForMatches: vi.fn(),
}));

import { getMatchesByTeam } from "@/lib/db/queries/matches";
import {
  getLatestOverUnderSnapshotsForMatches,
  getLatestSelectionOddsSnapshotsForMatches,
} from "@/lib/db/queries/odds-snapshots";
import TeamHistoryPage from "../page";

const NOW = Date.now();

function dbMatch(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    league: "brasileirao_a",
    homeTeam: "Palmeiras",
    awayTeam: "Flamengo",
    kickoffAt: new Date(NOW + 2 * 24 * 3_600_000),
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    updatedAt: new Date(NOW),
    ...over,
  };
}

async function render() {
  const el = await TeamHistoryPage({ params: Promise.resolve({ team: "Palmeiras" }) });
  return renderToStaticMarkup(el);
}

beforeEach(() => {
  vi.mocked(getMatchesByTeam).mockResolvedValue({
    future: [dbMatch("f-1"), dbMatch("f-2")],
    past: [
      dbMatch("p-1", {
        kickoffAt: new Date(NOW - 5 * 24 * 3_600_000),
        status: "finished",
        homeScore: 2,
        awayScore: 0,
      }),
    ],
  } as never);
  vi.mocked(getLatestOverUnderSnapshotsForMatches).mockResolvedValue(
    new Map([
      [
        "f-2",
        {
          bookmaker: "x",
          overOdd: "1.850",
          underOdd: "1.950",
          overroundPct: "4.00",
          capturedAt: new Date(NOW),
        },
      ],
    ]) as never,
  );
  vi.mocked(getLatestSelectionOddsSnapshotsForMatches).mockResolvedValue(
    new Map([
      [
        "f-1",
        {
          bookmaker: "x",
          capturedAt: new Date(NOW),
          overroundPct: "5.00",
          selections: [
            { key: "home", odd: "2.670" },
            { key: "draw", odd: "2.870" },
            { key: "away", odd: "3.060" },
          ],
        },
      ],
    ]) as never,
  );
});

describe("página do time — odds dos próximos jogos (#574)", () => {
  it("lê as odds só dos jogos futuros e mostra 1X2 e over/under", async () => {
    const html = await render();
    expect(getLatestOverUnderSnapshotsForMatches).toHaveBeenCalledWith(["f-1", "f-2"]);
    expect(getLatestSelectionOddsSnapshotsForMatches).toHaveBeenCalledWith(
      ["f-1", "f-2"],
      "match_result",
    );
    expect(html).toContain(">Empate</span> 2,87");
    expect(html).toContain(">Mais de 2,5</span> 1,85");
    expect(html).not.toContain("sem odd");
  });

  it("erro de leitura das odds vira 'sem odd', sem derrubar a página", async () => {
    vi.mocked(getLatestOverUnderSnapshotsForMatches).mockRejectedValue(new Error("db"));
    vi.mocked(getLatestSelectionOddsSnapshotsForMatches).mockRejectedValue(new Error("db"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await render();
    expect(html).toContain("sem odd");
    spy.mockRestore();
  });
});
