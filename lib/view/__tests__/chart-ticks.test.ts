import { describe, expect, it } from "vitest";

import { dayTicks, formatTick } from "@/lib/view/chart-ticks";

const SP = "America/Sao_Paulo";

describe("dayTicks (#574 linha 28d)", () => {
  it("um tick por dia civil, no primeiro ponto do dia", () => {
    const points = [
      { t: "2026-10-03T13:00:00Z" },
      { t: "2026-10-03T18:00:00Z" },
      { t: "2026-10-03T22:00:00Z" },
      { t: "2026-10-04T15:00:00Z" },
      { t: "2026-10-04T20:00:00Z" },
    ];
    expect(dayTicks(points, SP)).toEqual(["2026-10-03T13:00:00Z", "2026-10-04T15:00:00Z"]);
  });

  it("agrupa pelo dia do fuso do usuário, não pelo dia em UTC", () => {
    // 01:30Z do dia 04 ainda é dia 03 em São Paulo (UTC-3).
    const points = [{ t: "2026-10-03T20:00:00Z" }, { t: "2026-10-04T01:30:00Z" }];
    expect(dayTicks(points, SP)).toEqual(["2026-10-03T20:00:00Z"]);
    expect(dayTicks(points, "UTC")).toEqual(["2026-10-03T20:00:00Z", "2026-10-04T01:30:00Z"]);
  });

  it("série vazia não tem ticks", () => {
    expect(dayTicks([], SP)).toEqual([]);
  });
});

describe("formatTick", () => {
  it("dia com dois dígitos e mês abreviado em português, no fuso", () => {
    expect(formatTick("2026-10-04T01:30:00Z", SP)).toBe("03 out");
    expect(formatTick("2026-10-04T01:30:00Z", "UTC")).toBe("04 out");
    expect(formatTick("2026-02-15T12:00:00Z", SP)).toBe("15 fev");
  });
});
