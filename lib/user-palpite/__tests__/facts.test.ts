import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const absences = { getAbsencesByFixture: vi.fn() };
const sports = { getTeamForm: vi.fn(), getStandings: vi.fn() };
vi.mock("@/lib/providers/absences", () => ({ getAbsencesProvider: () => absences }));
vi.mock("@/lib/providers/sports-data", () => ({ getSportsDataProvider: () => sports }));

import {
  SportsDataTransientError,
  SportsDataUnsupportedError,
} from "@/lib/providers/sports-data/types";
import { fetchPalpiteFacts } from "@/lib/user-palpite/facts";

const MATCH = {
  id: "m-1",
  league: "brasileirao_a" as const,
  kickoffAt: new Date("2026-05-20T19:00:00Z"),
  homeTeam: "Flamengo",
  awayTeam: "Palmeiras",
};
const ALL = { absences: true, form: true, standings: true };
const NONE = { absences: false, form: false, standings: false };

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  absences.getAbsencesByFixture.mockReset();
  sports.getTeamForm.mockReset();
  sports.getStandings.mockReset();
  absences.getAbsencesByFixture.mockResolvedValue({
    home: [{ player: { name: "Pedro" }, type: "injury", status: "injured" }],
    away: [],
  });
  sports.getTeamForm.mockResolvedValue([]);
  sports.getStandings.mockResolvedValue({ league: "brasileirao_a", season: 2026, tables: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("fetchPalpiteFacts", () => {
  it("nada pedido → nenhuma chamada e nenhum fato", async () => {
    expect(await fetchPalpiteFacts(MATCH, NONE)).toEqual({});
    expect(absences.getAbsencesByFixture).not.toHaveBeenCalled();
    expect(sports.getTeamForm).not.toHaveBeenCalled();
    expect(sports.getStandings).not.toHaveBeenCalled();
  });

  it("só o que foi pedido; desfalques enriquecidos (posição desconhecida)", async () => {
    const facts = await fetchPalpiteFacts(MATCH, { ...NONE, absences: true });
    expect(facts.form).toBeUndefined();
    expect(facts.standings).toBeUndefined();
    expect(facts.absences).toEqual({
      available: true,
      data: {
        home: [
          {
            injury: { player: { name: "Pedro" }, type: "injury", status: "injured" },
            position: undefined,
            isRegularStarter: undefined,
            isTopScorer: undefined,
          },
        ],
        away: [],
      },
    });
    expect(absences.getAbsencesByFixture).toHaveBeenCalledWith({
      league: "brasileirao_a",
      kickoffAt: "2026-05-20T19:00:00.000Z",
      homeTeam: "Flamengo",
      awayTeam: "Palmeiras",
    });
  });

  it("Unsupported e Transient viram indisponível (nunca lista vazia); standings undefined também", async () => {
    absences.getAbsencesByFixture.mockRejectedValue(
      new SportsDataUnsupportedError("x", "p", "getInjuriesByFixture"),
    );
    sports.getTeamForm.mockRejectedValue(new SportsDataTransientError("x", "p", "m", null));
    sports.getStandings.mockResolvedValue(undefined);
    const facts = await fetchPalpiteFacts(MATCH, ALL);
    expect(facts).toEqual({
      absences: { available: false },
      form: { available: false },
      standings: { available: false },
    });
  });

  it("um fetch lento estoura o teto sozinho sem afetar os outros", async () => {
    vi.useFakeTimers();
    sports.getStandings.mockReturnValue(new Promise(() => {}));
    const p = fetchPalpiteFacts(MATCH, ALL, { budgetMs: 1000 });
    await vi.advanceTimersByTimeAsync(1001);
    const facts = await p;
    expect(facts.standings).toEqual({ available: false });
    expect(facts.absences?.available).toBe(true);
    expect(facts.form).toEqual({ available: true, data: { home: [], away: [] } });
  });
});
