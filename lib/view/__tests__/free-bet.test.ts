import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  computeBreakEvenProbPct,
  computeEvPerUnit,
} from "@/lib/odds/scenario";
import { toFreeBetLegView } from "@/lib/view/free-bet";

describe("toFreeBetLegView (mapper CAMINHO B)", () => {
  it("graded com odd: EV/break-even batem as primitivas puras; edge é SEMPRE '—'", () => {
    const modelProbPct = 12.5;
    const userOdd = 9;
    const view = toFreeBetLegView({
      status: "graded",
      selectionLabel: "Placar exato: 2 a 0",
      modelProbPct,
      degradedData: false,
      userOdd,
    });
    expect(view.kind).toBe("grade-modelo-simplificado");
    if (view.kind !== "grade-modelo-simplificado") return;
    expect(view.edgeLabel).toBe("—");
    expect(view.sourceLabel).toBe("modelo simplificado");
    expect(view.settleBadge).toBe("conferimos após o jogo");
    expect(view.value).not.toBeNull();
    expect(view.value?.evPerUnit).toBeCloseTo(
      computeEvPerUnit(modelProbPct, userOdd),
      9,
    );
    expect(view.value?.breakEvenProbPct).toBeCloseTo(
      computeBreakEvenProbPct(userOdd),
      9,
    );
  });

  it("graded sem odd: prob-only, value=null, edge '—'", () => {
    const view = toFreeBetLegView({
      status: "graded",
      selectionLabel: "Placar exato: 1 a 1",
      modelProbPct: 8,
      degradedData: false,
      userOdd: null,
    });
    if (view.kind !== "grade-modelo-simplificado") throw new Error("kind");
    expect(view.value).toBeNull();
    expect(view.edgeLabel).toBe("—");
  });

  it("degradedData → rótulo 'dados limitados'", () => {
    const view = toFreeBetLegView({
      status: "graded",
      selectionLabel: "Placar exato: 0 a 0",
      modelProbPct: 9,
      degradedData: true,
      userOdd: 12,
    });
    if (view.kind !== "grade-modelo-simplificado") throw new Error("kind");
    expect(view.sourceLabel).toBe("modelo simplificado (dados limitados)");
  });

  it("no_data → nao-avalio com motivo", () => {
    const view = toFreeBetLegView({
      status: "no_data",
      selectionLabel: "Placar exato: 3 a 1",
      reason: "sem tabela",
    });
    expect(view.kind).toBe("nao-avalio");
  });

  it("valueReading ∈ conjunto FINITO de 3 (positivo/zero/negativo)", () => {
    const readings = new Set<string>();
    for (const [prob, odd] of [
      [50, 9], // EV+
      [10, 10], // EV=0 (10% × 10 = 1)
      [5, 9], // EV-
    ] as const) {
      const v = toFreeBetLegView({
        status: "graded",
        selectionLabel: "x",
        modelProbPct: prob,
        degradedData: false,
        userOdd: odd,
      });
      if (v.kind === "grade-modelo-simplificado" && v.value) {
        readings.add(v.value.valueReading);
      }
    }
    expect(readings.size).toBe(3);
  });

  // LANDMINE PINADO (Decisão 3): a perna B NUNCA deriva pseudo-implícita de 1/userOdd.
  // O mapper NÃO pode importar computeMarketImpliedProbabilities (canal de edge) — de-vig
  // exige o board completo, ausente aqui. Guard estático sobre o source.
  it("o mapper NÃO importa computeMarketImpliedProbabilities (sem canal de edge)", () => {
    // cwd = raiz do projeto (vitest). Evita URL non-file scheme sob a config do repo.
    const src = readFileSync(resolve("lib/view/free-bet.ts"), "utf8");
    // Só as linhas de import (comentários podem citar o nome de propósito, na doc).
    const imports = src
      .split("\n")
      .filter((l) => l.trimStart().startsWith("import"))
      .join("\n");
    expect(imports).not.toContain("computeMarketImpliedProbabilities");
    expect(imports).not.toContain("implied-probability");
    expect(imports).not.toContain("computeMarketScenarios");
  });
});
