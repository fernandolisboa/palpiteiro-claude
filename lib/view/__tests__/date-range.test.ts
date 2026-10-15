import { describe, expect, it } from "vitest";

import { matchStatusEnum } from "@/db/schema";
import {
  IN_PROGRESS_WINDOW_MS,
  parseRangeParams,
  windowedQueryFrom,
} from "@/lib/view/date-range";

// Fixed, non-midnight UTC anchor so window math is unambiguous.
const NOW = new Date("2026-06-11T09:30:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

const ALL_STATUSES = [...matchStatusEnum.enumValues];

describe("parseRangeParams", () => {
  it("defaults to today5 when no params are given", () => {
    const r = parseRangeParams({}, NOW);

    expect(r.preset).toBe("today5");
    expect(r.order).toBe("asc");
    expect(r.from).toEqual(NOW);
    expect(r.to).toEqual(new Date(NOW.getTime() + 120 * HOUR_MS));
    expect(r.statuses).toEqual(["scheduled", "live"]);
  });

  it("resolves today14 to a 14-day upcoming window", () => {
    const r = parseRangeParams({ preset: "today14" }, NOW);

    expect(r.preset).toBe("today14");
    expect(r.order).toBe("asc");
    expect(r.from).toEqual(NOW);
    expect(r.to).toEqual(new Date(NOW.getTime() + 14 * 24 * HOUR_MS));
    expect(r.statuses).toEqual(["scheduled", "live"]);
  });

  it("resolves season to unbounded range with all statuses", () => {
    const r = parseRangeParams({ preset: "season" }, NOW);

    expect(r.preset).toBe("season");
    expect(r.from).toBeNull();
    expect(r.to).toBeNull();
    expect(r.order).toBe("asc");
    expect(r.statuses).toEqual(ALL_STATUSES);
    // sanity: full set, not the upcoming subset
    expect(r.statuses).toEqual([
      "scheduled",
      "live",
      "finished",
      "postponed",
      "cancelled",
    ]);
  });

  it("resolves custom with valid from/to to exact UTC day boundaries", () => {
    const r = parseRangeParams(
      { preset: "custom", from: "2026-03-01", to: "2026-03-15" },
      NOW,
    );

    expect(r.preset).toBe("custom");
    expect(r.order).toBe("asc");
    expect(r.from).toEqual(new Date("2026-03-01T00:00:00.000Z"));
    expect(r.to).toEqual(new Date("2026-03-15T23:59:59.999Z"));
    expect(r.statuses).toEqual(ALL_STATUSES);
  });

  it("swaps from/to when custom range is inverted", () => {
    const r = parseRangeParams(
      { preset: "custom", from: "2026-03-15", to: "2026-03-01" },
      NOW,
    );

    expect(r.preset).toBe("custom");
    expect(r.from).toEqual(new Date("2026-03-01T00:00:00.000Z"));
    expect(r.to).toEqual(new Date("2026-03-15T23:59:59.999Z"));
  });

  it("allows a same-day custom range (00:00:00.000 → 23:59:59.999)", () => {
    const r = parseRangeParams(
      { preset: "custom", from: "2026-03-01", to: "2026-03-01" },
      NOW,
    );

    expect(r.from).toEqual(new Date("2026-03-01T00:00:00.000Z"));
    expect(r.to).toEqual(new Date("2026-03-01T23:59:59.999Z"));
  });

  it("falls back to today5 when custom is missing from/to", () => {
    const r = parseRangeParams({ preset: "custom" }, NOW);

    expect(r.preset).toBe("today5");
    expect(r.from).toEqual(NOW);
    expect(r.to).toEqual(new Date(NOW.getTime() + 120 * HOUR_MS));
    expect(r.statuses).toEqual(["scheduled", "live"]);
  });

  it("falls back to today5 when custom has only one of from/to", () => {
    const onlyFrom = parseRangeParams(
      { preset: "custom", from: "2026-03-01" },
      NOW,
    );
    const onlyTo = parseRangeParams({ preset: "custom", to: "2026-03-15" }, NOW);

    expect(onlyFrom.preset).toBe("today5");
    expect(onlyTo.preset).toBe("today5");
  });

  it("falls back to today5 when custom dates have bad shape", () => {
    const r = parseRangeParams(
      { preset: "custom", from: "03/01/2026", to: "2026-03-15" },
      NOW,
    );

    expect(r.preset).toBe("today5");
  });

  it("falls back to today5 when custom date is not a real calendar date", () => {
    // Right shape, impossible day → must be rejected, not silently rolled over.
    const r = parseRangeParams(
      { preset: "custom", from: "2026-02-30", to: "2026-03-15" },
      NOW,
    );

    expect(r.preset).toBe("today5");
  });

  it("never throws and clamps garbage preset to today5", () => {
    expect(() =>
      parseRangeParams({ preset: "🤡 not-a-preset" }, NOW),
    ).not.toThrow();

    const r = parseRangeParams({ preset: "weekend" }, NOW);
    expect(r.preset).toBe("today5");
    expect(r.from).toEqual(NOW);
    expect(r.to).toEqual(new Date(NOW.getTime() + 120 * HOUR_MS));
  });

  it("ignores from/to unless preset is custom", () => {
    const r = parseRangeParams(
      { preset: "today14", from: "2026-03-01", to: "2026-03-15" },
      NOW,
    );

    expect(r.preset).toBe("today14");
    expect(r.from).toEqual(NOW);
    expect(r.to).toEqual(new Date(NOW.getTime() + 14 * 24 * HOUR_MS));
  });

  it("anchors custom boundaries to UTC regardless of host timezone offset", () => {
    // A negative-offset (e.g. America/...) host would shift a naive
    // `new Date('2026-12-31')` into the prior day; assert the UTC instants.
    const r = parseRangeParams(
      { preset: "custom", from: "2026-12-31", to: "2027-01-01" },
      NOW,
    );

    expect(r.from?.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(r.to?.toISOString()).toBe("2027-01-01T23:59:59.999Z");
  });

  it("does not mutate the injected now", () => {
    const before = NOW.getTime();
    parseRangeParams({ preset: "today5" }, NOW);
    expect(NOW.getTime()).toBe(before);
  });
});

describe("parseRangeParams custom no fuso do usuário (#577)", () => {
  const SP = "America/Sao_Paulo";
  const LONDON = "Europe/London";

  it("São Paulo: 18/10–25/10 cobre [18/10 00:00, 26/10 00:00) BRT", () => {
    const r = parseRangeParams(
      { preset: "custom", from: "2026-10-18", to: "2026-10-25" },
      NOW,
      SP,
    );
    expect(r.from?.toISOString()).toBe("2026-10-18T03:00:00.000Z");
    expect(r.to?.toISOString()).toBe("2026-10-26T02:59:59.999Z");
    expect(r.days).toEqual({ from: "2026-10-18", to: "2026-10-25" });
  });

  it("São Paulo: o jogo de 17/10 21:30 fica fora e o de 25/10 21:00 entra", () => {
    const r = parseRangeParams(
      { preset: "custom", from: "2026-10-18", to: "2026-10-25" },
      NOW,
      SP,
    );
    const inRange = (iso: string) => {
      const t = new Date(iso).getTime();
      return t >= r.from!.getTime() && t <= r.to!.getTime();
    };
    expect(inRange("2026-10-18T00:30:00.000Z")).toBe(false); // 17/10 21:30 BRT
    expect(inRange("2026-10-18T03:00:00.000Z")).toBe(true); // 18/10 00:00 BRT
    expect(inRange("2026-10-26T00:00:00.000Z")).toBe(true); // 25/10 21:00 BRT
    expect(inRange("2026-10-26T03:00:00.000Z")).toBe(false); // 26/10 00:00 BRT
  });

  it("dia invertido troca as pontas também no fuso", () => {
    const r = parseRangeParams(
      { preset: "custom", from: "2026-10-25", to: "2026-10-18" },
      NOW,
      SP,
    );
    expect(r.from?.toISOString()).toBe("2026-10-18T03:00:00.000Z");
    expect(r.days).toEqual({ from: "2026-10-18", to: "2026-10-25" });
  });

  it("Londres, volta do horário (25/10/2026): o dia tem 25h", () => {
    const r = parseRangeParams(
      { preset: "custom", from: "2026-10-25", to: "2026-10-25" },
      NOW,
      LONDON,
    );
    expect(r.from?.toISOString()).toBe("2026-10-24T23:00:00.000Z"); // 00:00 BST
    expect(r.to?.toISOString()).toBe("2026-10-25T23:59:59.999Z"); // 23:59:59 GMT
    expect(r.to!.getTime() + 1 - r.from!.getTime()).toBe(25 * HOUR_MS);
  });

  it("Londres, ida do horário (29/03/2026): o dia tem 23h", () => {
    const r = parseRangeParams(
      { preset: "custom", from: "2026-03-29", to: "2026-03-29" },
      NOW,
      LONDON,
    );
    expect(r.from?.toISOString()).toBe("2026-03-29T00:00:00.000Z"); // 00:00 GMT
    expect(r.to?.toISOString()).toBe("2026-03-29T22:59:59.999Z"); // 23:59:59 BST
    expect(r.to!.getTime() + 1 - r.from!.getTime()).toBe(23 * HOUR_MS);
  });

  it("troca de horário na meia-noite (São Paulo, 04/11/2018): começa às 01:00 local", () => {
    // 00:00 não existiu nesse dia (o relógio pulou de 23:59:59 para 01:00).
    const r = parseRangeParams(
      { preset: "custom", from: "2018-11-04", to: "2018-11-04" },
      NOW,
      SP,
    );
    expect(r.from?.toISOString()).toBe("2018-11-04T03:00:00.000Z");
    expect(r.to?.toISOString()).toBe("2018-11-05T01:59:59.999Z");
  });

  it("fuso adiante do UTC (Tóquio): o dia começa na véspera em UTC", () => {
    const r = parseRangeParams(
      { preset: "custom", from: "2026-10-18", to: "2026-10-18" },
      NOW,
      "Asia/Tokyo",
    );
    expect(r.from?.toISOString()).toBe("2026-10-17T15:00:00.000Z");
    expect(r.to?.toISOString()).toBe("2026-10-18T14:59:59.999Z");
  });

  it("as presets não mudam com o fuso", () => {
    for (const preset of ["today5", "today14", "season"]) {
      expect(parseRangeParams({ preset }, NOW, SP)).toEqual(
        parseRangeParams({ preset }, NOW),
      );
    }
  });
});

describe("IN_PROGRESS_WINDOW_MS (#385)", () => {
  it("is exported and equals 3 hours in ms", () => {
    expect(IN_PROGRESS_WINDOW_MS).toBe(3 * 60 * 60 * 1000);
  });
});

describe("windowedQueryFrom (#385): query bound recuado 3h só nas presets de janela", () => {
  it("today5 recua o from em IN_PROGRESS_WINDOW_MS", () => {
    const range = parseRangeParams({ preset: "today5" }, NOW);
    const queryFrom = windowedQueryFrom(range);
    expect(queryFrom).toEqual(
      new Date(NOW.getTime() - IN_PROGRESS_WINDOW_MS),
    );
  });

  it("today14 recua o from em IN_PROGRESS_WINDOW_MS", () => {
    const range = parseRangeParams({ preset: "today14" }, NOW);
    const queryFrom = windowedQueryFrom(range);
    expect(queryFrom).toEqual(
      new Date(NOW.getTime() - IN_PROGRESS_WINDOW_MS),
    );
  });

  it("season mantém from null (sem recuo)", () => {
    const range = parseRangeParams({ preset: "season" }, NOW);
    expect(windowedQueryFrom(range)).toBeNull();
  });

  it("custom mantém o from original (sem recuo)", () => {
    const range = parseRangeParams(
      { preset: "custom", from: "2026-03-01", to: "2026-03-15" },
      NOW,
    );
    expect(windowedQueryFrom(range)).toEqual(range.from);
    expect(windowedQueryFrom(range)).toEqual(
      new Date("2026-03-01T00:00:00.000Z"),
    );
  });

  it("NÃO muta ResolvedRange.from (nav/labels leem o original)", () => {
    const range = parseRangeParams({ preset: "today5" }, NOW);
    windowedQueryFrom(range);
    expect(range.from).toEqual(NOW);
  });

  it("um jogo apitado há 20min ENTRA na janela today5 (kickoff >= queryFrom)", () => {
    const range = parseRangeParams({ preset: "today5" }, NOW);
    const queryFrom = windowedQueryFrom(range)!;
    const kickoff20minAgo = new Date(NOW.getTime() - 20 * 60 * 1000);
    expect(kickoff20minAgo.getTime()).toBeGreaterThanOrEqual(
      queryFrom.getTime(),
    );
  });

  it("um jogo apitado há 4h SAI da janela today5 (não fica pendurado pra sempre)", () => {
    const range = parseRangeParams({ preset: "today5" }, NOW);
    const queryFrom = windowedQueryFrom(range)!;
    const kickoff4hAgo = new Date(NOW.getTime() - 4 * 60 * 60 * 1000);
    expect(kickoff4hAgo.getTime()).toBeLessThan(queryFrom.getTime());
  });
});
