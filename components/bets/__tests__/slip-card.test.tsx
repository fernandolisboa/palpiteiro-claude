import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SlipCard } from "@/components/bets/slip-card";
import { deriveSlipStatus } from "@/lib/bets/slip-ledger";
import type { BetSlipHistoryRow, UserBetLegRow } from "@/lib/db/queries/user-bets";

const NOW = new Date("2026-10-15T15:00:00Z");
const TZ = "America/Sao_Paulo";

let legSeq = 0;
function leg(over: Partial<UserBetLegRow> = {}): UserBetLegRow {
  legSeq += 1;
  return {
    id: `leg-${legSeq}`,
    slipId: "slip-1",
    kind: "match_result",
    params: { selection: "home" },
    userOdd: "2.300",
    modelProbPct: "41.30",
    gradeSource: "scoreline_model",
    gradeStatus: "graded",
    pinnedPredictionId: null,
    settleable: true,
    modelSource: "dixon_coles",
    referenceOdd: "2.250",
    marketImpliedPct: "40.00",
    stakeUnits: null,
    suggestedStakeUnits: null,
    createdAt: NOW,
    outcome: null,
    ...over,
  };
}

function slip(
  legs: UserBetLegRow[],
  over: Partial<Omit<BetSlipHistoryRow, "legs" | "status">> = {},
): BetSlipHistoryRow {
  return {
    id: "slip-1",
    matchId: "m1",
    userId: "u1",
    rawInput: null,
    parseAiCallId: null,
    comboUserOdd: null,
    jointProbPct: null,
    mode: legs.length >= 2 ? "combinada" : "simples",
    stakeUnits: null,
    createdAt: NOW,
    match: {
      homeTeam: "SE Palmeiras",
      awayTeam: "CR Flamengo",
      league: "brasileirao_a",
      kickoffAt: new Date("2026-10-15T22:00:00Z"),
      status: "scheduled",
    },
    ...over,
    legs,
    status: deriveSlipStatus(legs),
  };
}

const render = (s: BetSlipHistoryRow) =>
  renderToStaticMarkup(<SlipCard slip={s} now={NOW} timeZone={TZ} />);

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("SlipCard (/apostas, #577)", () => {
  it("simples: um selo só (o do slip), sem selo na perna", () => {
    const html = render(slip([leg({ stakeUnits: "1.00" })]));
    expect(count(html, 'data-result="')).toBe(1);
    expect(count(html, "Em aberto")).toBe(1);
    expect(html).not.toContain("Combinada");
    expect(html).toContain("odd 2,30 · stake 1u · chance 41,3%");
  });

  it("combinada: eyebrow no topo, odd e stake do slip, selo por perna e sem rodapé antigo", () => {
    const html = render(
      slip(
        [leg({ outcome: null }), leg({ kind: "btts", params: { selection: "yes" } })],
        { comboUserOdd: "4.260", stakeUnits: "0.50" },
      ),
    );
    expect(html.indexOf("Combinada · 2 seleções")).toBeGreaterThan(-1);
    expect(html.indexOf("Combinada · 2 seleções")).toBeLessThan(html.indexOf("Palmeiras × Flamengo"));
    expect(html).toContain("4,26");
    expect(html).toContain("0,5u");
    expect(html).not.toContain("seu stake na combinada");
    expect(html).not.toContain("odd da combinada");
    // Slip + 2 pernas.
    expect(count(html, 'data-result="')).toBe(3);
    expect(html).toContain("Ambas marcam: sim");
  });

  it("perna 1X2 diz o nome curto do time", () => {
    const html = render(slip([leg()]));
    expect(html).toContain("Vitória do Palmeiras");
    expect(html).not.toContain("mandante");
  });

  it("detalhes: vantagem do modelo só dentro do <details>", () => {
    const html = render(slip([leg({ stakeUnits: "1.00" })]));
    const details = html.slice(html.indexOf("<details"));
    const before = html.slice(0, html.indexOf("<details"));
    expect(details).toContain("vantagem do modelo");
    expect(details).toContain("Dixon-Coles");
    expect(before).not.toContain("vantagem do modelo");
  });

  it("perna sem chance do modelo: sem <details>", () => {
    const html = render(
      slip([leg({ modelProbPct: null, gradeSource: "none", modelSource: null, marketImpliedPct: null })]),
    );
    expect(html).not.toContain("<details");
  });

  it("jogo cancelado com aposta pendente: 'Jogo cancelado', nunca 'Em aberto'", () => {
    const html = render(
      slip([leg()], {
        match: {
          homeTeam: "SE Palmeiras",
          awayTeam: "CR Flamengo",
          league: "brasileirao_a",
          kickoffAt: new Date("2026-10-15T22:00:00Z"),
          status: "cancelled",
        },
      }),
    );
    expect(html).toContain("Jogo cancelado");
    expect(html).not.toContain("Em aberto");
  });

  it("acertou e não conferida", () => {
    expect(render(slip([leg({ outcome: wonOutcome() })]))).toContain("Acertou");
    const nc = render(slip([leg({ kind: "corners", params: { selection: "over", line: 8.5 }, settleable: false })]));
    expect(nc).toContain("Não conferida");
  });
});

function wonOutcome(): UserBetLegRow["outcome"] {
  return {
    id: "o1",
    legId: "leg-x",
    result: "won",
    resultData: { homeScore: 2, awayScore: 1, totalGoals: 3 },
    overrideByUserId: null,
    settledAt: NOW,
  };
}
