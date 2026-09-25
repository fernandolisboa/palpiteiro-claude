// Backtest histórico (ADR 0039 D2, #502) — parser PURO do snapshot versionado do
// football-data.co.uk (`data/backtest/BRA-<data>.csv`). Sem fs, sem fetch: o script
// lê o arquivo e entrega o texto; o resultado é reproduzível pelo snapshot.
// Colunas usadas: Season, Date (dd/mm/yyyy), Home, Away, HG, AG e as odds de
// FECHAMENTO 1X2 — PSC* (Pinnacle) e AvgC* (média do mercado).

export type Odds1x2 = { home: number; draw: number; away: number };

export type HistoricalMatch = {
  season: number;
  date: Date; // meia-noite UTC do dia do jogo (a hora do CSV não entra)
  home: string; // nome como no CSV (ver team-names.ts pro catálogo)
  away: string;
  homeGoals: number;
  awayGoals: number;
  closingPinnacle: Odds1x2 | null;
  closingAvg: Odds1x2 | null;
};

// Split simples por vírgula: o CSV do football-data não tem campos entre aspas.
function parseLine(line: string): string[] {
  return line.split(",").map((c) => c.trim());
}

function parseDate(ddmmyyyy: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmmyyyy);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
}

function odd(v: string | undefined): number | null {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 1 ? n : null;
}

function odds1x2(row: Record<string, string>, prefix: string): Odds1x2 | null {
  const home = odd(row[`${prefix}H`]);
  const draw = odd(row[`${prefix}D`]);
  const away = odd(row[`${prefix}A`]);
  return home && draw && away ? { home, draw, away } : null;
}

/**
 * Parseia o CSV inteiro em jogos ordenados por data (estável dentro do dia).
 * Linhas sem placar inteiro ou sem data válida são descartadas (jogo não
 * disputado / linha corrompida) — nunca um placar fabricado.
 */
export function parseFootballDataCsv(text: string): HistoricalMatch[] {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = parseLine(lines[0]);

  const out: HistoricalMatch[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));

    const date = parseDate(row.Date);
    const season = Number(row.Season);
    const homeGoals = Number(row.HG);
    const awayGoals = Number(row.AG);
    if (
      !date ||
      !Number.isInteger(season) ||
      !Number.isInteger(homeGoals) ||
      !Number.isInteger(awayGoals) ||
      row.HG === "" ||
      row.AG === "" ||
      !row.Home ||
      !row.Away
    ) {
      continue;
    }
    out.push({
      season,
      date,
      home: row.Home,
      away: row.Away,
      homeGoals,
      awayGoals,
      closingPinnacle: odds1x2(row, "PSC"),
      closingAvg: odds1x2(row, "AvgC"),
    });
  }
  // sort estável: preserva a ordem do CSV dentro do mesmo dia.
  return out
    .map((m, i) => ({ m, i }))
    .sort((a, b) => a.m.date.getTime() - b.m.date.getTime() || a.i - b.i)
    .map(({ m }) => m);
}
