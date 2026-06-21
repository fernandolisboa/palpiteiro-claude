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

// Janela em que um jogo que JÁ apitou ainda conta como "em andamento": ~90' +
// acréscimos + intervalo (mata-mata com prorrogação/pênaltis ≈ teto de 3h). É o
// ÚNICO dono deste limite — consumido por (a) o bound inferior da QUERY em
// app/jogos/page.tsx (admite a cauda de 3h de jogos já apitados nas presets de
// janela), (b) a derivação de `isInProgress` em lib/view/match.ts (a badge "ao
// vivo") E (c) o bound inferior de getUpcomingMatches em lib/db/queries/matches.ts
// (#418, mesmo concern de query). Todos DEVEM ler esta constante (nunca um
// `3*HOUR_MS` inline), senão pertinência-na-lista e elegibilidade-da-badge
// dessincronizam na borda. NÃO altera ResolvedRange.from (continua = início da
// janela do usuário p/ nav/labels).
export const IN_PROGRESS_WINDOW_MS = 3 * HOUR_MS;

/**
 * Bound inferior da QUERY (NÃO o início da janela do usuário). Só as presets de
 * janela (today5/today14) recuam o `from` em IN_PROGRESS_WINDOW_MS pra admitir a
 * cauda de jogos que JÁ apitaram (status DB fica stale `scheduled` até o cron 6h
 * virar): matches.ts gte(kickoffAt, from) de outra forma dropava-os ANTES do
 * filtro de status. season (from=null) e custom mantêm seus próprios bounds. É
 * CONCERN de query — ResolvedRange.from segue intocado (rangeNavProps/labels/
 * listKey leem o original, sem flip no boundary 21:00 UTC). Pura/testável; usa a
 * MESMA constante da badge (match.ts) → pertinência-na-lista ⟺ elegibilidade-badge.
 */
export function windowedQueryFrom(range: ResolvedRange): Date | null {
  if (range.preset === "today5" || range.preset === "today14") {
    return range.from
      ? new Date(range.from.getTime() - IN_PROGRESS_WINDOW_MS)
      : null;
  }
  return range.from;
}

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
