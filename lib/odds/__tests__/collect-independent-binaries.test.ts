import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  collectIndependentBinaries,
  deriveIndependentImplied,
} from "@/lib/odds/collect-independent-binaries";
import { ANYTIME_SCORER } from "@/lib/odds/market-descriptor";
import type { NormalizedOddsEvent } from "@/lib/providers/odds/types";

function event(
  bookmakers: NormalizedOddsEvent["bookmakers"],
): NormalizedOddsEvent {
  return {
    id: "e1",
    commenceTime: "2026-07-22T23:00:00Z",
    homeTeam: "Flamengo",
    awayTeam: "Palmeiras",
    bookmakers,
  };
}

function scorerMarket(values: { name: string; price: number }[]) {
  return {
    key: "bet_92",
    lastUpdate: "2026-07-22T20:00:00Z",
    outcomes: values,
  };
}

describe("collectIndependentBinaries (#290)", () => {
  it("mapeia cada jogador → scorer_<slug> com label = nome cru e odd", () => {
    const bundle = collectIndependentBinaries({
      event: event([
        {
          key: "apifootball_8",
          title: "Bet365",
          markets: [
            scorerMarket([
              { name: "Pedro", price: 2.5 },
              { name: "Gabriel Barbosa", price: 3.2 },
            ]),
          ],
        },
      ]),
      descriptor: ANYTIME_SCORER,
    });
    expect(bundle).toBeDefined();
    expect(bundle?.bookmakerTitle).toBe("Bet365");
    expect(bundle?.players).toEqual([
      { key: "scorer_pedro", label: "Pedro", odd: 2.5 },
      { key: "scorer_gabriel_barbosa", label: "Gabriel Barbosa", odd: 3.2 },
    ]);
  });

  it("dropa odd <= 1 / não-finita POR JOGADOR (não o book inteiro)", () => {
    const bundle = collectIndependentBinaries({
      event: event([
        {
          key: "apifootball_8",
          title: "Bet365",
          markets: [
            scorerMarket([
              { name: "Pedro", price: 1.0 }, // dropado
              { name: "Arrascaeta", price: 4.5 },
            ]),
          ],
        },
      ]),
      descriptor: ANYTIME_SCORER,
    });
    expect(bundle?.players).toEqual([
      { key: "scorer_arrascaeta", label: "Arrascaeta", odd: 4.5 },
    ]);
  });

  it("escolhe o book com MAIS jogadores cotados (sem complete-market gate)", () => {
    const bundle = collectIndependentBinaries({
      event: event([
        {
          key: "a",
          title: "BookA",
          markets: [scorerMarket([{ name: "Pedro", price: 2.5 }])],
        },
        {
          key: "b",
          title: "BookB",
          markets: [
            scorerMarket([
              { name: "Pedro", price: 2.6 },
              { name: "Gerson", price: 5.0 },
              { name: "Bruno Henrique", price: 4.0 },
            ]),
          ],
        },
      ]),
      descriptor: ANYTIME_SCORER,
    });
    expect(bundle?.bookmakerTitle).toBe("BookB");
    expect(bundle?.players).toHaveLength(3);
  });

  it("undefined quando nenhum book cota jogador válido (prefer-skip)", () => {
    const bundle = collectIndependentBinaries({
      event: event([
        {
          key: "a",
          title: "BookA",
          markets: [scorerMarket([{ name: "Pedro", price: 1.0 }])],
        },
      ]),
      descriptor: ANYTIME_SCORER,
    });
    expect(bundle).toBeUndefined();
  });
});

describe("deriveIndependentImplied (teto 1/odd, #290)", () => {
  it("implícita por jogador = (1/odd)*100 (teto, sem normalização)", () => {
    const implied = deriveIndependentImplied([
      { key: "scorer_pedro", odd: 2.5 },
      { key: "scorer_gerson", odd: 5.0 },
    ]);
    expect(implied.scorer_pedro).toBeCloseTo(40, 10); // 1/2.5*100
    expect(implied.scorer_gerson).toBeCloseTo(20, 10); // 1/5.0*100
  });

  it("Σ pode passar de 100 (contagem esperada, NÃO overround) — não normaliza", () => {
    const implied = deriveIndependentImplied([
      { key: "a", odd: 1.5 }, // 66.7
      { key: "b", odd: 2.0 }, // 50
      { key: "c", odd: 3.0 }, // 33.3
    ]);
    const sum = implied.a + implied.b + implied.c;
    // Σ ~150 — um teto agregado > 100 é correto (binários independentes yes-only).
    expect(sum).toBeGreaterThan(100);
  });
});

describe("HARD INVARIANT: caminho scorer não toca implied-probability", () => {
  it("collect-independent-binaries não IMPORTA implied-probability nem CHAMA computeMarketImpliedProbabilities", () => {
    const src = readFileSync(
      resolve(__dirname, "../collect-independent-binaries.ts"),
      "utf8",
    );
    // Strip comentários (de linha + bloco) — a invariante é sobre IMPORT/CHAMADA,
    // não sobre menções no comentário (que explicam por que NÃO normalizamos).
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/from\s+["']@\/lib\/odds\/implied-probability["']/);
    expect(code).not.toContain("computeMarketImpliedProbabilities(");
  });
});
