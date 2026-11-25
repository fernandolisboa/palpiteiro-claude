import { describe, expect, it } from "vitest";

import {
  JEV_STALE_MS,
  orderJevQueue,
} from "@/lib/model-base/compute-match-models";
import { JUDGMENTS_VERSION } from "@/lib/ai/judgments/questions";
import type { MatchModelSnapshot } from "@/lib/model-base/types";

const NOW = new Date("2026-05-14T12:00:00Z");
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

function latest(
  matchId: string,
  jevStatus: MatchModelSnapshot["jevStatus"],
  checkedAt: Date,
  judgmentsVersion: string = JUDGMENTS_VERSION,
): MatchModelSnapshot {
  return {
    matchId,
    jevStatus,
    checkedAt,
    judgments: { versions: { judgments: judgmentsVersion } },
  } as MatchModelSnapshot;
}

describe("orderJevQueue (puro)", () => {
  it("sem base / not_attempted / failed / JEV velho vêm antes do JEV fresco, mesmo com kickoff posterior", () => {
    const items = [
      { matchId: "fresh", kickoffAt: at(2) },
      { matchId: "none", kickoffAt: at(40) },
      { matchId: "not-attempted", kickoffAt: at(30) },
      { matchId: "stale", kickoffAt: at(20) },
      { matchId: "failed-fresh", kickoffAt: at(50) },
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
      // `failed` recente tenta de novo antes do `applied` fresco (kickoff mais perto).
      "stale",
      "not-attempted",
      "none",
      "failed-fresh",
      "fresh",
    ]);
  });

  it("JEV fresco de outra versão das perguntas volta pro começo da fila (#617)", () => {
    const items = [
      { matchId: "fresh", kickoffAt: at(2) },
      { matchId: "old-version", kickoffAt: at(30) },
    ];
    const byMatch = new Map<string, MatchModelSnapshot>([
      ["fresh", latest("fresh", "applied", at(-1))],
      ["old-version", latest("old-version", "applied", at(-1), "jev_judgments_v1")],
    ]);
    expect(orderJevQueue(items, byMatch, NOW).map((i) => i.matchId)).toEqual([
      "old-version",
      "fresh",
    ]);
  });

  it("lote de notícias que a base ainda não viu volta pro bucket 0 (#672, ajuste 1)", () => {
    const items = [
      { matchId: "fresh", kickoffAt: at(2) },
      { matchId: "new-batch", kickoffAt: at(30) },
      { matchId: "same-batch", kickoffAt: at(10) },
      { matchId: "old-batch", kickoffAt: at(20) },
    ];
    const withNews = (id: string, batchId: string) => {
      const s = latest(id, "applied", at(-1));
      return {
        ...s,
        judgments: { ...s.judgments, news: { batchId } },
      } as MatchModelSnapshot;
    };
    const byMatch = new Map<string, MatchModelSnapshot>([
      ["fresh", latest("fresh", "applied", at(-1))],
      ["new-batch", withNews("new-batch", "b-1")],
      ["same-batch", withNews("same-batch", "b-2")],
      // Lote diferente, mas criado ANTES do último checked_at: a base já o viu (mesma
      // evidência, só heartbeat) e não volta pra frente.
      ["old-batch", latest("old-batch", "applied", at(-1))],
    ]);
    const batches = new Map([
      ["new-batch", { id: "b-9", createdAt: at(-0.5) }],
      ["same-batch", { id: "b-2", createdAt: at(-0.5) }],
      ["old-batch", { id: "b-3", createdAt: at(-2) }],
    ]);
    expect(orderJevQueue(items, byMatch, NOW, batches).map((i) => i.matchId)).toEqual([
      "new-batch",
      "fresh",
      "same-batch",
      "old-batch",
    ]);
    // Sem o mapa de lotes (flag de notícias off), a ordem de hoje.
    expect(orderJevQueue(items, byMatch, NOW).map((i) => i.matchId)).toEqual([
      "fresh",
      "same-batch",
      "old-batch",
      "new-batch",
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
