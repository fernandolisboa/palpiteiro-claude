import { describe, expect, it } from "vitest";

import {
  classifyStatusShort,
  isMinuteKnown,
  isTerminalStatusShort,
  liveMinuteLabel,
  type LiveStatusClass,
} from "@/lib/live/phase";

describe("classifyStatusShort", () => {
  it.each<[string, LiveStatusClass]>([
    ["TBD", "pre_match"],
    ["NS", "pre_match"],
    ["1H", "in_play"],
    ["2H", "in_play"],
    ["LIVE", "in_play"],
    ["HT", "half_time"],
    ["ET", "extra_time"],
    ["BT", "extra_time"],
    ["P", "extra_time"],
    ["INT", "interrupted"],
    ["SUSP", "interrupted"],
    ["FT", "finished"],
    ["AET", "finished"],
    ["PEN", "finished"],
    ["AWD", "finished"],
    ["WO", "finished"],
    ["PST", "postponed"],
    ["CANC", "cancelled"],
    ["ABD", "cancelled"],
    ["XYZ", "unknown"],
  ])("%s → %s", (short, cls) => {
    expect(classifyStatusShort(short)).toBe(cls);
  });

  it("sem status → unknown (fail-closed)", () => {
    expect(classifyStatusShort(null)).toBe("unknown");
  });

  it("terminais não são buscados de novo", () => {
    for (const s of ["FT", "AET", "PEN", "AWD", "WO", "PST", "CANC", "ABD"]) {
      expect(isTerminalStatusShort(s)).toBe(true);
    }
    for (const s of ["NS", "1H", "HT", "2H", "ET", "P", "INT", null]) {
      expect(isTerminalStatusShort(s)).toBe(false);
    }
  });
});

describe("minuto", () => {
  const s = (
    statusShort: string,
    elapsed: number | null,
    extra: number | null = null
  ) => ({
    statusShort,
    elapsed,
    extra,
  });

  it("minuto conhecido só onde dá pra posicionar o jogo", () => {
    expect(isMinuteKnown(s("1H", 12))).toBe(true);
    expect(isMinuteKnown(s("1H", null))).toBe(false);
    expect(isMinuteKnown(s("2H", null))).toBe(false);
    expect(isMinuteKnown(s("HT", 45))).toBe(true);
    expect(isMinuteKnown(s("NS", null))).toBe(true);
    expect(isMinuteKnown(s("LIVE", 30))).toBe(false);
    expect(isMinuteKnown(s("ET", 95))).toBe(false);
  });

  it.each<[string, number | null, number | null, string | null]>([
    ["1H", 0, null, "0'"],
    ["1H", 12, null, "12'"],
    ["1H", 45, 2, "45+2'"],
    ["1H", 47, null, "45+2'"],
    ["2H", 45, null, "45'"],
    ["2H", 63, null, "63'"],
    ["2H", 90, 5, "90+5'"],
    ["2H", 93, null, "90+3'"],
    ["HT", 45, null, "intervalo"],
    ["NS", null, null, "0'"],
    ["2H", null, null, null],
    ["LIVE", 30, null, null],
    ["ET", 100, null, null],
  ])("%s elapsed=%s extra=%s → %s", (status, elapsed, extra, label) => {
    expect(liveMinuteLabel(s(status, elapsed, extra))).toBe(label);
  });
});
