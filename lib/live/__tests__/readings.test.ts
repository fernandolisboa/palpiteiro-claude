import { describe, expect, it } from "vitest";

import {
  currentLiveReadings,
  liveMomentPhrase,
  livePalpiteLabel,
} from "@/lib/live/readings";
import {
  liveColumns,
  liveStampFromState,
  readLiveStamp,
  type StampableState,
} from "@/lib/live/stamp";

const NOW = new Date("2026-05-15T20:10:00.000Z");

function stateAt(over: Partial<StampableState> = {}): StampableState {
  return {
    statusShort: "2H",
    elapsed: 63,
    extra: null,
    minuteLabel: "63'",
    score: { home: 1, away: 0 },
    red: { home: 0, away: 0 },
    fetchedAt: new Date(NOW.getTime() - 20_000),
    ...over,
  };
}

function row(
  id: string,
  opts: { live?: boolean; recordedAt?: Date; state?: Partial<StampableState> } = {},
) {
  const cols =
    opts.live === false
      ? liveColumns(null)
      : liveColumns(liveStampFromState(stateAt(opts.state), opts.recordedAt ?? NOW));
  return { id, prediction: { isLive: cols.isLive, liveState: cols.liveState } };
}

describe("liveMomentPhrase", () => {
  it("minuto, intervalo e sem minuto", () => {
    expect(liveMomentPhrase({ statusShort: "2H", minuteLabel: "63'" })).toBe("aos 63'");
    expect(liveMomentPhrase({ statusShort: "1H", minuteLabel: "45+2'" })).toBe(
      "aos 45+2'",
    );
    expect(liveMomentPhrase({ statusShort: "HT", minuteLabel: "45'" })).toBe(
      "no intervalo",
    );
    expect(liveMomentPhrase({ statusShort: "2H", minuteLabel: null })).toBe(
      "com o jogo em andamento",
    );
  });
});

describe("livePalpiteLabel", () => {
  it("momento e placar do carimbo; ilegível cai no genérico", () => {
    const stamp = readLiveStamp(liveColumns(liveStampFromState(stateAt(), NOW)).liveState);
    expect(livePalpiteLabel(stamp)).toBe("palpite aos 63' (1–0)");
    const ht = readLiveStamp(
      liveColumns(liveStampFromState(stateAt({ statusShort: "HT" }), NOW)).liveState,
    );
    expect(livePalpiteLabel(ht)).toBe("palpite no intervalo (1–0)");
    expect(livePalpiteLabel(null)).toBe("palpite ao vivo");
  });
});

describe("currentLiveReadings", () => {
  const now = { score: { home: 1, away: 0 }, red: { home: 0, away: 0 } };

  it("só leituras ao vivo do mesmo placar e expulsões, até 10 min", () => {
    const history = [
      row("fresh"),
      row("pre", { live: false }),
      row("other-score", { state: { score: { home: 1, away: 1 } } }),
      row("other-red", { state: { red: { home: 0, away: 1 } } }),
      row("old", { recordedAt: new Date(NOW.getTime() - 11 * 60_000) }),
    ];
    expect(currentLiveReadings(history, now, NOW).map((r) => r.id)).toEqual(["fresh"]);
  });

  it("expulsões sem dado contam como zero; sem placar agora, nada", () => {
    const history = [row("null-red", { state: { red: null } })];
    expect(currentLiveReadings(history, now, NOW)).toHaveLength(1);
    expect(currentLiveReadings(history, { score: null, red: null }, NOW)).toEqual([]);
  });

  it("carimbo do futuro (relógio torto) fica de fora", () => {
    const history = [row("future", { recordedAt: new Date(NOW.getTime() + 60_000) })];
    expect(currentLiveReadings(history, now, NOW)).toEqual([]);
  });
});
