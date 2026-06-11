import { z } from "zod";

import { matchStatusEnum } from "@/db/schema";
import type { DbMatch } from "@/lib/db/queries/matches";

export type RangePreset = "today5" | "today14" | "season" | "custom";

export type ResolvedRange = {
  from: Date | null;
  to: Date | null;
  preset: RangePreset;
  statuses: DbMatch["status"][];
  order: "asc" | "desc";
};

// Reuse the schema enum as the single source of truth for "all statuses"
// (`season`/`custom` impose no status filter, so they get the full set). The
// cast keeps the element type as `DbMatch["status"]` instead of `string`.
const ALL_STATUSES = matchStatusEnum.enumValues as DbMatch["status"][];

const UPCOMING_STATUSES: DbMatch["status"][] = ["scheduled", "live"];

const HOUR_MS = 60 * 60 * 1000;

const presetSchema = z.enum(["today5", "today14", "season", "custom"]);

// `YYYY-MM-DD` shape AND a real calendar date (rejects e.g. 2026-02-30).
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    );
  });

function startOfUtcDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function endOfUtcDay(value: string): Date {
  return new Date(`${value}T23:59:59.999Z`);
}

function today5(now: Date): ResolvedRange {
  return {
    from: now,
    to: new Date(now.getTime() + 120 * HOUR_MS),
    preset: "today5",
    statuses: UPCOMING_STATUSES,
    order: "asc",
  };
}

/**
 * Pure resolver: turns URL searchParams into a concrete date range. Never
 * throws — any invalid/missing input clamps to the `today5` default, since a
 * throwing Server Component would 500 the page. Mirrors `parseLeagueFilter`.
 *
 * `now` is injectable for deterministic tests. `new Date()` is only ever called
 * inside this function (default param), never at module top-level.
 */
export function parseRangeParams(
  sp: { preset?: string; from?: string; to?: string },
  now: Date = new Date(),
): ResolvedRange {
  const preset = presetSchema.safeParse(sp.preset);

  // Missing/garbage preset → today5 default.
  if (!preset.success) return today5(now);

  switch (preset.data) {
    case "today5":
      return today5(now);
    case "today14":
      return {
        from: now,
        to: new Date(now.getTime() + 14 * 24 * HOUR_MS),
        preset: "today14",
        statuses: [...UPCOMING_STATUSES],
        order: "asc",
      };
    case "season":
      return {
        from: null,
        to: null,
        preset: "season",
        statuses: [...ALL_STATUSES],
        order: "asc",
      };
    case "custom": {
      const fromParsed = isoDateSchema.safeParse(sp.from);
      const toParsed = isoDateSchema.safeParse(sp.to);

      // `from`/`to` honored ONLY for custom; if either is missing/invalid,
      // fall back to the today5 default.
      if (!fromParsed.success || !toParsed.success) return today5(now);

      // Swap the raw day strings (not the computed instants) when inverted, so
      // `from` always lands on start-of-day and `to` on end-of-day.
      let fromDay = fromParsed.data;
      let toDay = toParsed.data;
      if (fromDay > toDay) {
        [fromDay, toDay] = [toDay, fromDay];
      }

      return {
        from: startOfUtcDay(fromDay),
        to: endOfUtcDay(toDay),
        preset: "custom",
        statuses: [...ALL_STATUSES],
        order: "asc",
      };
    }
  }
}
