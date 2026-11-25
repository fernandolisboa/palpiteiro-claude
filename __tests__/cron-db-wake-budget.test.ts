import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Orçamento de acordadas do Postgres pelos crons (#680, ADR 0074). O Neon do plano Free
// tem 100 CU-h/mês e só suspende o compute 5 min depois da última query: cada run de
// cron que toca o banco custa ≥ 5 min de compute, mesmo sem trabalho. Em novembro de
// 2026 um cron de 10 min + um de 30 min seguraram o banco acordado ~40 min por hora e
// estouraram a cota no dia 25, com o app parado.
//
// Regra: cron mais frequente que de hora em hora só entra com portão no KV (consulta o
// índice antes de qualquer query; ver lib/sync/analyzed-kickoffs.ts). Os demais somam
// no orçamento diário abaixo. Subir o orçamento exige rever a conta do ADR 0074.

const ROOT = process.cwd();

// Rota → arquivo onde mora o portão (chamado antes da 1ª query).
const KV_GATED: Record<string, string> = {
  "/api/cron/recheck-lineups": "lib/lineup-recheck/run.ts",
  "/api/cron/capture-closing-odds": "lib/odds/closing-line.ts",
};

// Runs por dia, somados, dos crons SEM portão (cada um acorda o banco). Hoje: 16.
const UNGATED_WAKES_PER_DAY_BUDGET = 24;

type Cron = { path: string; schedule: string };

function fieldCount(field: string, size: number, start: number): number {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [range, stepRaw] = part.split("/");
    const step = stepRaw ? Number(stepRaw) : 1;
    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = start;
      hi = start + size - 1;
    } else if (range.includes("-")) {
      [lo, hi] = range.split("-").map(Number);
    } else {
      lo = Number(range);
      hi = stepRaw ? start + size - 1 : lo;
    }
    if (![lo, hi, step].every(Number.isInteger)) {
      throw new Error(`campo de cron não suportado pelo teste: "${field}"`);
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values.size;
}

function runsPerDay(schedule: string): number {
  // Dia/mês/semana restritos só deixam o cron mais raro: a conta diária é o pior caso.
  const [min, hour] = schedule.trim().split(/\s+/);
  return fieldCount(min, 60, 0) * fieldCount(hour, 24, 0);
}

const crons: Cron[] = JSON.parse(
  readFileSync(join(ROOT, "vercel.json"), "utf8"),
).crons;

describe("orçamento de acordadas do Postgres pelos crons (ADR 0074)", () => {
  it("o parser conta os formatos usados", () => {
    expect(runsPerDay("5,15,25,35,45,55 * * * *")).toBe(144);
    expect(runsPerDay("*/30 * * * *")).toBe(48);
    expect(runsPerDay("0 */6 * * *")).toBe(4);
    expect(runsPerDay("30 1,7,13,19 * * *")).toBe(4);
    expect(runsPerDay("15 8 * * *")).toBe(1);
  });

  it("cron mais frequente que de hora em hora tem portão no KV antes de tocar no banco", () => {
    const frequent = crons.filter((c) => runsPerDay(c.schedule) > 24);
    for (const c of frequent) {
      const gateFile = KV_GATED[c.path];
      expect(
        gateFile,
        `${c.path} (${c.schedule}) roda mais que 24×/dia sem portão no KV: cada run acorda o Neon por ≥ 5 min (ADR 0074)`,
      ).toBeDefined();
      // Aqui só a presença da chamada. Que ela vem ANTES de qualquer query é provado
      // nos testes de cada cron (lib/lineup-recheck/__tests__/run.test.ts,
      // lib/odds/closing-line.test.ts: portão fechado, flag e candidatos não chamados).
      expect(readFileSync(join(ROOT, gateFile), "utf8")).toContain(
        "hasAnalyzedKickoffBetween(",
      );
    }
  });

  it("todo cron com portão declarado existe no vercel.json", () => {
    const paths = new Set(crons.map((c) => c.path));
    for (const path of Object.keys(KV_GATED)) expect(paths.has(path)).toBe(true);
  });

  it(`crons sem portão somam no máximo ${UNGATED_WAKES_PER_DAY_BUDGET} acordadas/dia`, () => {
    const total = crons
      .filter((c) => !(c.path in KV_GATED))
      .reduce((sum, c) => sum + runsPerDay(c.schedule), 0);
    expect(total).toBeLessThanOrEqual(UNGATED_WAKES_PER_DAY_BUDGET);
  });
});
