import { describe, expect, it } from "vitest";

import {
  JEV_STALE_MS,
  orderJevQueue,
} from "@/lib/model-base/compute-match-models";
import type { MatchModelSnapshot } from "@/lib/model-base/types";

const NOW = new Date("2026-05-14T12:00:00Z");
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

function latest(
  matchId: string,
  jevStatus: MatchModelSnapshot["jevStatus"],
  checkedAt: Date,
): MatchModelSnapshot {
  return { matchId, jevStatus, checkedAt } as MatchModelSnapshot;
}

describe("orderJevQueue (puro)", () => {
  it("sem base / not_attempted / JEV velho vêm antes do JEV fresco, mesmo com kickoff posterior", () => {
    const items = [
      { matchId: "fresh", kickoffAt: at(2) },
      { matchId: "none", kickoffAt: at(40) },
      { matchId: "not-attempted", kickoffAt: at(30) },
      { matchId: "stale", kickoffAt: at(20) },
      { matchId: "failed-fresh", kickoffAt: at(1) },
    ];
    const byMatch = new Map<string, MatchModelSnapshot>([
      ["fresh", latest("fresh", "applied", at(-1))],
      ["not-attempted", latest("not-attempted", "not_attempted", at(-1))],
      [
        "stale",
        latest(
          "stale",
          "applied",
          new Date(NOW.getTime() - JEV_STALE_MS - 60_000),
        ),
      ],
      ["failed-fresh", latest("failed-fresh", "failed", at(-1))],
    ]);
    expect(orderJevQueue(items, byMatch, NOW).map((i) => i.matchId)).toEqual([
      "stale",
      "not-attempted",
      "none",
      "failed-fresh",
      "fresh",
    ]);
  });

  it("não muta a entrada", () => {
    const items = [
      { matchId: "b", kickoffAt: at(5) },
      { matchId: "a", kickoffAt: at(1) },
    ];
    const out = orderJevQueue(items, new Map(), NOW);
    expect(out.map((i) => i.matchId)).toEqual(["a", "b"]);
    expect(items.map((i) => i.matchId)).toEqual(["b", "a"]);
  });
});
