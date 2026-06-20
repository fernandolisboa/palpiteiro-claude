import { describe, expect, it } from "vitest";

import {
  formatCostUsd,
  formatCostUsdTotal,
  formatCountdown,
  formatEdge,
  formatEvPct,
  formatGeneratedAt,
  formatGeneratedAtSeconds,
  formatKickoffAbsolute,
  formatKickoffRelative,
  formatModelName,
  formatOdd,
  formatPct,
  formatRelativeAgo,
  leagueToKey,
  LEAGUE_LABEL,
} from "./format";

describe("formatOdd", () => {
  it("formats numbers with 2 decimals", () => {
    expect(formatOdd(1.92)).toBe("1.92");
    expect(formatOdd(2)).toBe("2.00");
    expect(formatOdd("1.871")).toBe("1.87");
  });
  it("returns em-dash for null/undefined/NaN", () => {
    expect(formatOdd(null)).toBe("—");
    expect(formatOdd(undefined)).toBe("—");
    expect(formatOdd("abc")).toBe("—");
  });
});

describe("formatPct", () => {
  it("rounds to 0 decimals when close to integer", () => {
    expect(formatPct(58)).toBe("58%");
    expect(formatPct(58.02)).toBe("58%");
  });
  it("uses 1 decimal when meaningfully fractional", () => {
    expect(formatPct(50.7)).toBe("50.7%");
  });
  it("supports forced decimals option", () => {
    expect(formatPct(58, { decimals: 1 })).toBe("58.0%");
    expect(formatPct(58, { decimals: 2 })).toBe("58.00%");
  });
});

describe("formatEdge", () => {
  it("prefixes positive with +", () => {
    expect(formatEdge(7.3)).toBe("+7.3");
    expect(formatEdge("7.3")).toBe("+7.3");
  });
  it("keeps negative as-is", () => {
    expect(formatEdge(-2.1)).toBe("-2.1");
  });
  it("returns null when null/undefined", () => {
    expect(formatEdge(null)).toBeNull();
    expect(formatEdge(undefined)).toBeNull();
  });
});

describe("formatEvPct", () => {
  it("multiplies the raw fraction by 100 and prefixes positive with +", () => {
    expect(formatEvPct(0.1136)).toBe("+11.4%");
  });
  it("keeps the ASCII hyphen from toFixed for negatives", () => {
    expect(formatEvPct(-0.04)).toBe("-4.0%");
  });
  it("renders exact zero without sign", () => {
    expect(formatEvPct(0)).toBe("0.0%");
  });
  it("normalizes values that round to zero — never '+0.0%' nor '-0.0%'", () => {
    expect(formatEvPct(0.0004)).toBe("0.0%");
    expect(formatEvPct(-0.0004)).toBe("0.0%");
  });
  it("returns em-dash for null/NaN", () => {
    expect(formatEvPct(null)).toBe("—");
    expect(formatEvPct(NaN)).toBe("—");
  });
});

describe("formatCostUsd", () => {
  it("preserves preview #33 format ($X.XXX)", () => {
    expect(formatCostUsd(0.014)).toBe("$0.014");
    expect(formatCostUsd("0.014")).toBe("$0.014");
    expect(formatCostUsd(1.5)).toBe("$1.500");
  });
  it("falls back to $0.000 for invalid input", () => {
    expect(formatCostUsd(null)).toBe("$0.000");
    expect(formatCostUsd("abc")).toBe("$0.000");
  });
});

describe("formatCostUsdTotal", () => {
  it("uses 2 decimals for aggregate totals ($X.XX)", () => {
    expect(formatCostUsdTotal(1.234567)).toBe("$1.23");
    expect(formatCostUsdTotal(0)).toBe("$0.00");
  });
  it("accepts string input (numeric SUM from Drizzle)", () => {
    expect(formatCostUsdTotal("1.5")).toBe("$1.50");
    expect(formatCostUsdTotal("0")).toBe("$0.00");
  });
  it("falls back to $0.00 for null/undefined/NaN", () => {
    expect(formatCostUsdTotal(null)).toBe("$0.00");
    expect(formatCostUsdTotal(undefined)).toBe("$0.00");
    expect(formatCostUsdTotal("abc")).toBe("$0.00");
  });
});

describe("formatGeneratedAt", () => {
  it("uses DD mmm · HH:MM format in pt-BR", () => {
    // 19 may 2026 14:22 local
    const d = new Date(2026, 4, 19, 14, 22);
    expect(formatGeneratedAt(d)).toBe("19 mai · 14:22");
  });
});

describe("formatGeneratedAtSeconds", () => {
  it("appends zero-padded seconds (desambigua reanálises do mesmo minuto, #204)", () => {
    const d = new Date(2026, 4, 19, 14, 22, 7);
    expect(formatGeneratedAtSeconds(d)).toBe("19 mai · 14:22:07");
  });

  it("two analyses in the same minute differ only by the seconds suffix", () => {
    const a = new Date(2026, 4, 19, 14, 22, 5);
    const b = new Date(2026, 4, 19, 14, 22, 41);
    expect(formatGeneratedAtSeconds(a)).toBe("19 mai · 14:22:05");
    expect(formatGeneratedAtSeconds(b)).toBe("19 mai · 14:22:41");
    expect(formatGeneratedAtSeconds(a)).not.toBe(formatGeneratedAtSeconds(b));
  });
});

describe("formatRelativeAgo", () => {
  const now = new Date("2026-05-22T12:00:00Z");
  it("returns 'agora' for <1min", () => {
    expect(formatRelativeAgo(new Date(now.getTime() - 30_000), now)).toBe(
      "agora",
    );
  });
  it("returns Xmin for minutes", () => {
    expect(formatRelativeAgo(new Date(now.getTime() - 2 * 60_000), now)).toBe(
      "2min",
    );
  });
  it("returns Xh for hours", () => {
    expect(
      formatRelativeAgo(new Date(now.getTime() - 3 * 60 * 60_000), now),
    ).toBe("3h");
  });
  it("returns Xd for days", () => {
    expect(
      formatRelativeAgo(new Date(now.getTime() - 2 * 24 * 60 * 60_000), now),
    ).toBe("2d");
  });
});

describe("formatKickoffRelative", () => {
  it("returns 'em Xh Ymin' for kickoffs within the same day", () => {
    const now = new Date(2026, 4, 22, 18, 6);
    const kickoff = new Date(2026, 4, 22, 21, 30);
    expect(formatKickoffRelative(kickoff, now)).toBe("em 3h 24min");
  });
  it("returns 'amanhã, HH:MM' for next-day kickoffs", () => {
    const now = new Date(2026, 4, 22, 18, 0);
    const kickoff = new Date(2026, 4, 23, 16, 0);
    expect(formatKickoffRelative(kickoff, now)).toBe("amanhã, 16:00");
  });
  it("returns 'weekday, HH:MM' for this-week kickoffs", () => {
    const now = new Date(2026, 4, 22, 12, 0); // Friday
    const kickoff = new Date(2026, 4, 25, 19, 0); // Monday
    const out = formatKickoffRelative(kickoff, now);
    expect(out).toMatch(/^(seg|ter|qua|qui|sex|sáb|dom), \d{2}:\d{2}$/);
  });
});

describe("formatKickoffAbsolute", () => {
  it("'hoje, HH:MM' when same day", () => {
    const now = new Date(2026, 4, 22, 18, 6);
    const kickoff = new Date(2026, 4, 22, 21, 30);
    expect(formatKickoffAbsolute(kickoff, now)).toBe("hoje, 21:30");
  });
  it("'amanhã, HH:MM' next day", () => {
    const now = new Date(2026, 4, 22, 18, 0);
    const kickoff = new Date(2026, 4, 23, 16, 0);
    expect(formatKickoffAbsolute(kickoff, now)).toBe("amanhã, 16:00");
  });
});

describe("formatCountdown", () => {
  it("returns countdown only when <24h same day", () => {
    const now = new Date(2026, 4, 22, 18, 0);
    expect(formatCountdown(new Date(2026, 4, 22, 21, 0), now)).toBe(
      "em 3h 00min",
    );
    expect(formatCountdown(new Date(2026, 4, 23, 16, 0), now)).toBeUndefined();
  });
});

describe("formatKickoff* com timeZone (fuso do usuário, #1)", () => {
  // Mesmo INSTANTE (00:30 UTC) → hora local por fuso: 21:30 BRT (UTC-3, dia
  // anterior), 01:30 em Lisboa (UTC+1), 09:30 em Tóquio (UTC+9). Era o bug: o
  // app mostrava 00:30 (UTC do runtime) em vez de 21:30 (BRT).
  const kickoff = new Date("2026-06-20T00:30:00Z");
  const now = new Date("2026-06-19T23:00:00Z");

  it("absolute em BRT mostra 21:30 (não 00:30 UTC)", () => {
    expect(formatKickoffAbsolute(kickoff, now, "America/Sao_Paulo")).toBe(
      "hoje, 21:30",
    );
  });

  it("absolute: o MESMO instante muda por fuso", () => {
    expect(formatKickoffAbsolute(kickoff, now, "Europe/Lisbon")).toBe(
      "hoje, 01:30",
    );
    expect(formatKickoffAbsolute(kickoff, now, "Asia/Tokyo")).toBe(
      "hoje, 09:30",
    );
    // UTC explícito reproduz o comportamento antigo (00:30, vira "amanhã").
    expect(formatKickoffAbsolute(kickoff, now, "UTC")).toBe("amanhã, 00:30");
  });

  it("relative em BRT: <24h no mesmo dia → 'em 1h 30min'", () => {
    expect(formatKickoffRelative(kickoff, now, "America/Sao_Paulo")).toBe(
      "em 1h 30min",
    );
  });

  it("countdown em BRT: <24h mesmo dia BRT → 'em 1h 30min'", () => {
    expect(formatCountdown(kickoff, now, "America/Sao_Paulo")).toBe(
      "em 1h 30min",
    );
  });
});

describe("formatModelName", () => {
  it("compacts version sufix", () => {
    expect(formatModelName("claude-sonnet-4-5-20250929")).toBe(
      "claude-sonnet-4.5",
    );
  });
  it("passes through unknown format", () => {
    expect(formatModelName("custom-model")).toBe("custom-model");
  });
});

describe("leagueToKey + LEAGUE_LABEL", () => {
  it("maps db enum to ui key and label", () => {
    expect(leagueToKey("brasileirao_a")).toBe("bsa");
    expect(leagueToKey("champions_league")).toBe("ucl");
    expect(leagueToKey("world_cup")).toBe("wc");
    expect(LEAGUE_LABEL.bsa).toBe("Brasileirão");
    expect(LEAGUE_LABEL.ucl).toBe("Champions");
    expect(LEAGUE_LABEL.wc).toBe("Copa do Mundo");
  });
});
