import { beforeEach, describe, expect, it, vi } from "vitest";

// Sem provider de verdade: as duas fábricas são mockadas.
const provider = {
  getTeamForm: vi.fn(),
  getH2H: vi.fn(),
};
const absences = { getAbsencesByFixture: vi.fn() };
vi.mock("@/lib/providers/sports-data", () => ({
  getSportsDataProvider: () => provider,
}));
vi.mock("@/lib/providers/absences", () => ({
  getAbsencesProvider: () => absences,
}));

import { fetchUnderdogSignals } from "@/lib/underdog/fetch-signals";

const MATCH = {
  league: "brasileirao_a" as const,
  kickoffAt: new Date("2026-11-21T19:30:00Z"),
  homeTeam: "SE Palmeiras",
  awayTeam: "CR Flamengo",
};
const injuries = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ player: `p${i}` }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  provider.getTeamForm.mockResolvedValue([]);
  provider.getH2H.mockResolvedValue([]);
  absences.getAbsencesByFixture.mockResolvedValue({
    home: injuries(5),
    away: injuries(1),
  });
});

describe("fetchUnderdogSignals", () => {
  it("monta os sinais com os dados de cada fonte", async () => {
    const out = await fetchUnderdogSignals({ match: MATCH, side: "away" });
    expect(out).toEqual([{ kind: "absences", favorite: 5, underdog: 1 }]);
    expect(provider.getH2H).toHaveBeenCalledWith(
      "SE Palmeiras",
      "CR Flamengo",
      "brasileirao_a",
      5
    );
  });

  it("fonte que falha só tira o próprio sinal", async () => {
    absences.getAbsencesByFixture.mockRejectedValue(new Error("429"));
    expect(await fetchUnderdogSignals({ match: MATCH, side: "away" })).toEqual(
      []
    );
  });

  it("prazo duro: fonte lenta vira sinal ausente", async () => {
    absences.getAbsencesByFixture.mockReturnValue(new Promise(() => {}));
    const out = await fetchUnderdogSignals({
      match: MATCH,
      side: "away",
      timeoutMs: 20,
    });
    expect(out).toEqual([]);
  });
});
