import { z } from "zod";

import { matchStatusEnum } from "@/db/schema";
import type { DbMatch } from "@/lib/db/queries/matches";
import { dayKeyOf } from "@/lib/format";

export type RangePreset = "upcoming" | "custom";

export type ResolvedRange = {
  from: Date | null;
  to: Date | null;
  preset: RangePreset;
  statuses: DbMatch["status"][];
  order: "asc" | "desc";
  // Só no `custom`: os dias civis escolhidos ("2026-10-18"), como vieram da URL (já em
  // ordem). `from`/`to` são instantes no fuso do usuário; o dia deles em UTC pode ser
  // outro, então rótulo e links leem daqui.
  days?: { from: string; to: string };
};

// Reuse the schema enum as the single source of truth for "all statuses"
// (`custom` imposes no status filter, so they get the full set). The
// cast keeps the element type as `DbMatch["status"]` instead of `string`.
const ALL_STATUSES = matchStatusEnum.enumValues as DbMatch["status"][];

const UPCOMING_STATUSES: DbMatch["status"][] = ["scheduled", "live"];

const HOUR_MS = 60 * 60 * 1000;

// Janela em que um jogo que JÁ apitou ainda conta como "em andamento": ~90' +
// acréscimos + intervalo (mata-mata com prorrogação/pênaltis ≈ teto de 3h). É o
// ÚNICO dono deste limite — consumido por (a) o bound inferior da QUERY em
// app/(app)/jogos/page.tsx (admite a cauda de 3h de jogos já apitados na lista
// padrão), (b) a derivação de `isInProgress` em lib/view/match.ts (a badge "ao
// vivo") E (c) o bound inferior de getUpcomingMatches em lib/db/queries/matches.ts
// (#418, mesmo concern de query). Todos DEVEM ler esta constante (nunca um
// `3*HOUR_MS` inline), senão pertinência-na-lista e elegibilidade-da-badge
// dessincronizam na borda. NÃO altera ResolvedRange.from (continua = início da
// janela do usuário p/ nav/labels).
export const IN_PROGRESS_WINDOW_MS = 3 * HOUR_MS;

/**
 * Bound inferior da QUERY (NÃO o início da janela do usuário). Só a lista a
 * partir de agora (upcoming) recua o `from` em IN_PROGRESS_WINDOW_MS pra admitir a
 * cauda de jogos que JÁ apitaram (status DB fica stale `scheduled` até o cron 6h
 * virar): matches.ts gte(kickoffAt, from) de outra forma dropava-os ANTES do
 * filtro de status. custom mantém seus próprios bounds. É
 * CONCERN de query — ResolvedRange.from segue intocado (rangeNavProps/labels/
 * listKey leem o original, sem flip no boundary 21:00 UTC). Pura/testável; usa a
 * MESMA constante da badge (match.ts) → pertinência-na-lista ⟺ elegibilidade-badge.
 */
export function windowedQueryFrom(range: ResolvedRange): Date | null {
  if (range.preset === "upcoming") {
    return range.from
      ? new Date(range.from.getTime() - IN_PROGRESS_WINDOW_MS)
      : null;
  }
  return range.from;
}

// Os chips antigos de período (5 dias, 14 dias e "Competição", #577) deram lugar a
// uma lista só, de agora em diante, que cresce com "Carregar mais". Links salvos com
// eles abrem essa lista.
const LEGACY_PRESETS = new Set(["today5", "today14", "season"]);
const presetSchema = z.preprocess(
  (value) => (typeof value === "string" && LEGACY_PRESETS.has(value) ? "upcoming" : value),
  z.enum(["upcoming", "custom"]),
);

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

// Relógio de parede em `timeZone` menos o UTC, no instante `t` (ms).
function zoneOffsetMs(t: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(t));
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    pick("year"),
    pick("month") - 1,
    pick("day"),
    pick("hour"),
    pick("minute"),
    pick("second"),
  );
  return wall - Math.floor(t / 1000) * 1000;
}

/**
 * Primeiro instante do dia civil `day` ("2026-10-18") em `timeZone`: a meia-noite
 * local, ou o fim do salto quando a troca de horário pula a meia-noite (São Paulo
 * até 2018: 00:00 → 01:00). Tenta o offset de antes e o de depois e fica com o mais
 * cedo que cai no dia.
 */
function startOfZonedDay(day: string, timeZone: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const wallMidnight = Date.UTC(y, m - 1, d);
  const first = wallMidnight - zoneOffsetMs(wallMidnight, timeZone);
  const second = wallMidnight - zoneOffsetMs(first, timeZone);
  const inDay = [first, second].filter(
    (t) => dayKeyOf(new Date(t), timeZone) === day,
  );
  return new Date(inDay.length > 0 ? Math.min(...inDay) : second);
}

const LAST_QUERY_INSTANT = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

// Sem toISOString: em 9999-12-31 ele daria "+010000-01-01" e o split quebraria.
function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

// A lista padrão: de agora em diante, sem data final. Jogos passados ficam no
// `custom` (Escolher datas).
function upcoming(now: Date): ResolvedRange {
  return {
    from: now,
    to: null,
    preset: "upcoming",
    statuses: [...UPCOMING_STATUSES],
    order: "asc",
  };
}

/**
 * Pure resolver: turns URL searchParams into a concrete date range. Never
 * throws — any invalid/missing input clamps to the `upcoming` default, since a
 * throwing Server Component would 500 the page. Mirrors `parseLeagueFilter`.
 *
 * `now` is injectable for deterministic tests. `new Date()` is only ever called
 * inside this function (default param), never at module top-level.
 *
 * `timeZone` (o do request, `getRequestTimeZone`) só vale no `custom`: o intervalo
 * cobre os dias civis De 00:00 até o fim de Até naquele fuso, os mesmos dias dos
 * títulos da lista. O `upcoming` parte de `now` e não depende de fuso.
 * Default UTC só para os testes antigos; a página sempre passa o fuso.
 */
export function parseRangeParams(
  sp: { preset?: string; from?: string; to?: string },
  now: Date = new Date(),
  timeZone = "UTC",
): ResolvedRange {
  const preset = presetSchema.safeParse(sp.preset);

  // Missing/garbage preset → upcoming default.
  if (!preset.success) return upcoming(now);

  switch (preset.data) {
    case "upcoming":
      return upcoming(now);
    case "custom": {
      const fromParsed = isoDateSchema.safeParse(sp.from);
      const toParsed = isoDateSchema.safeParse(sp.to);

      // `from`/`to` honored ONLY for custom; if either is missing/invalid,
      // fall back to the upcoming default.
      if (!fromParsed.success || !toParsed.success) return upcoming(now);

      // Swap the raw day strings (not the computed instants) when inverted, so
      // `from` always lands on start-of-day and `to` on end-of-day.
      let fromDay = fromParsed.data;
      let toDay = toParsed.data;
      if (fromDay > toDay) {
        [fromDay, toDay] = [toDay, fromDay];
      }

      // [De 00:00, Até 24:00) no fuso; `to` inclusivo (a query usa lte), então o
      // último milissegundo antes da meia-noite seguinte. Dia de 23h ou 25h na troca
      // de horário sai certo porque cada ponta é calculada no próprio dia.
      const end = startOfZonedDay(nextDay(toDay), timeZone).getTime() - 1;
      return {
        from: startOfZonedDay(fromDay, timeZone),
        // Teto no fim de 9999 (UTC): o fim de 31/12/9999 a oeste do UTC cairia no ano
        // 10000, que o toISOString escreve "+010000-…" na query.
        to: new Date(Math.min(end, LAST_QUERY_INSTANT)),
        preset: "custom",
        statuses: [...ALL_STATUSES],
        order: "asc",
        days: { from: fromDay, to: toDay },
      };
    }
  }
}
