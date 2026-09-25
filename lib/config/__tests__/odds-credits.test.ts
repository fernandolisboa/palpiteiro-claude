import { describe, expect, it } from "vitest";

import {
  daysInUtcMonth,
  daysLeftInUtcMonth,
  estimateMonthlyOddsCredits,
  projectRemainingMonthOddsCredits,
} from "@/lib/config/odds-credits";

// brasileirao_a (200) + premier_league (110) = 310/mês.
const ACTIVE = ["brasileirao_a", "premier_league"] as const;

describe("odds-credits — projeção do gasto até o fim do mês (UTC)", () => {
  it("estimativa mensal soma as ligas ativas", () => {
    expect(estimateMonthlyOddsCredits(ACTIVE)).toBe(310);
    expect(estimateMonthlyOddsCredits([])).toBe(0);
  });

  it("dias do mês: 30/31, fevereiro comum e bissexto", () => {
    expect(daysInUtcMonth(new Date("2026-09-15T12:00:00Z"))).toBe(30);
    expect(daysInUtcMonth(new Date("2026-10-15T12:00:00Z"))).toBe(31);
    expect(daysInUtcMonth(new Date("2026-02-10T00:00:00Z"))).toBe(28);
    expect(daysInUtcMonth(new Date("2028-02-10T00:00:00Z"))).toBe(29);
  });

  it("dia 1 (00:00Z) → mês inteiro; último dia (23:59Z) → 1 dia", () => {
    const first = new Date("2026-09-01T00:00:00Z");
    const last = new Date("2026-09-30T23:59:59Z");
    expect(daysLeftInUtcMonth(first)).toBe(30);
    expect(daysLeftInUtcMonth(last)).toBe(1);
    expect(projectRemainingMonthOddsCredits(ACTIVE, first)).toBe(310);
    // 310 × 1/30 = 10.33 → arredonda pra cima.
    expect(projectRemainingMonthOddsCredits(ACTIVE, last)).toBe(11);
  });

  it("fronteira UTC: 30/09 23:30 em BRT já é 01/10 em UTC → mês novo inteiro", () => {
    // 2026-09-30T23:30-03:00 = 2026-10-01T02:30Z.
    const now = new Date("2026-09-30T23:30:00-03:00");
    expect(daysLeftInUtcMonth(now)).toBe(31);
    expect(projectRemainingMonthOddsCredits(ACTIVE, now)).toBe(310);
  });

  it("meio do mês: proporcional aos dias restantes (contando hoje)", () => {
    // 16/09: 15 dias restantes de 30 → 310 × 0.5 = 155.
    expect(
      projectRemainingMonthOddsCredits(ACTIVE, new Date("2026-09-16T08:00:00Z"))
    ).toBe(155);
    // 29/02/2028 (bissexto, último dia) → 1/29.
    expect(
      projectRemainingMonthOddsCredits(
        ["brasileirao_a"],
        new Date("2028-02-29T10:00:00Z")
      )
    ).toBe(Math.ceil(200 / 29));
  });

  it("sem liga ativa → zero", () => {
    expect(
      projectRemainingMonthOddsCredits([], new Date("2026-09-16T08:00:00Z"))
    ).toBe(0);
  });
});
