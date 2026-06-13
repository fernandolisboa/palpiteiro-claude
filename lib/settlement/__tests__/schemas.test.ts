import { describe, expect, it } from "vitest";

import {
  ResultDataSchema,
  resultDataFromRegulationScore,
} from "@/lib/settlement/schemas";

describe("ResultDataSchema", () => {
  it("accepts a full split", () => {
    expect(
      ResultDataSchema.parse({ homeScore: 2, awayScore: 1, totalGoals: 3 }),
    ).toEqual({ homeScore: 2, awayScore: 1, totalGoals: 3 });
  });

  it("accepts a degraded null split (history twin)", () => {
    expect(
      ResultDataSchema.parse({
        homeScore: null,
        awayScore: null,
        totalGoals: 3,
      }),
    ).toEqual({ homeScore: null, awayScore: null, totalGoals: 3 });
  });

  it("rejects a missing totalGoals", () => {
    expect(
      ResultDataSchema.safeParse({ homeScore: 1, awayScore: 1 }).success,
    ).toBe(false);
  });

  it("rejects a non-integer totalGoals", () => {
    expect(
      ResultDataSchema.safeParse({
        homeScore: 1,
        awayScore: 1,
        totalGoals: 2.5,
      }).success,
    ).toBe(false);
  });
});

describe("resultDataFromRegulationScore", () => {
  it("never degrades the split — the live 90' score is canonical", () => {
    expect(resultDataFromRegulationScore({ home: 1, away: 1 })).toEqual({
      homeScore: 1,
      awayScore: 1,
      totalGoals: 2,
    });
    expect(resultDataFromRegulationScore({ home: 3, away: 0 })).toEqual({
      homeScore: 3,
      awayScore: 0,
      totalGoals: 3,
    });
  });
});
