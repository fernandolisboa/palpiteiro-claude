import { describe, expect, it } from "vitest";

import { previousFixture } from "@/lib/ai/engine/judgment-input";
import {
  isFriendly,
  otherCompetition,
  withoutFriendlies,
} from "@/lib/providers/sports-data/competition";
import type { NormalizedFixture } from "@/lib/providers/sports-data/types";

function fx(
  id: string,
  competition?: NormalizedFixture["competition"]
): NormalizedFixture {
  return {
    id,
    league: "brasileirao_a",
    kickoffAt: "2026-05-10T19:00:00.000Z",
    kickoffTimestampMs: Date.parse("2026-05-10T19:00:00.000Z"),
    homeTeam: "CR Flamengo",
    awayTeam: "EC Bahia",
    status: "finished",
    score: { home: 2, away: 1 },
    ...(competition ? { competition } : {}),
  };
}

const LEAGUE = {
  name: "Serie A",
  league: "brasileirao_a",
  friendly: false,
} as const;
const CUP = { name: "Copa Do Brasil", friendly: false } as const;
const FRIENDLY = { name: "Friendlies Clubs", friendly: true } as const;

describe("competition (#618)", () => {
  it("withoutFriendlies tira só o amistoso; sem campo segue como antes", () => {
    const list = [fx("a", LEAGUE), fx("b", FRIENDLY), fx("c", CUP), fx("d")];
    expect(withoutFriendlies(list).map((f) => f.id)).toEqual(["a", "c", "d"]);
    expect(isFriendly(fx("b", FRIENDLY))).toBe(true);
    expect(isFriendly(fx("d"))).toBe(false);
  });

  it("otherCompetition só para competição diferente da analisada", () => {
    expect(otherCompetition(fx("a", LEAGUE), "brasileirao_a")).toBeNull();
    expect(otherCompetition(fx("c", CUP), "brasileirao_a")).toEqual(CUP);
    expect(otherCompetition(fx("a", LEAGUE), "copa_libertadores")).toEqual(
      LEAGUE
    );
    expect(otherCompetition(fx("b", FRIENDLY), "brasileirao_a")).toBeNull();
    expect(otherCompetition(fx("d"), "brasileirao_a")).toBeNull();
  });
});

describe("descanso continua vendo o amistoso (#618)", () => {
  it("previousFixture acha o amistoso como último jogo", () => {
    const league = {
      ...fx("liga", LEAGUE),
      kickoffAt: "2026-05-01T19:00:00.000Z",
      kickoffTimestampMs: Date.parse("2026-05-01T19:00:00.000Z"),
    };
    const friendly = {
      ...fx("amistoso", FRIENDLY),
      kickoffAt: "2026-05-12T19:00:00.000Z",
      kickoffTimestampMs: Date.parse("2026-05-12T19:00:00.000Z"),
    };
    expect(
      previousFixture(
        [league, friendly],
        Date.parse("2026-05-14T19:00:00.000Z")
      )?.id
    ).toBe("amistoso");
  });
});
