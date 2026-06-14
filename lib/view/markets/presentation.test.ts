import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { getMarketPresentation } from "./presentation";

describe("getMarketPresentation", () => {
  it("over_under: outcome label composes seed label + linha; frase leiga verbatim", () => {
    const p = getMarketPresentation("over_under");
    expect(p.marketKey).toBe("over_under");
    expect(p.marketLabel).toBe("Over/Under gols");
    expect(p.defaultLine).toBe(2.5);
    expect(p.selectionLabel("over")).toBe("Over");
    expect(p.selectionLabel("under")).toBe("Under");
    expect(p.outcomeLabel("over", 2.5)).toBe("Over 2.5");
    expect(p.outcomeLabel("under", 2.5)).toBe("Under 2.5");
    // sem linha → só o label da seleção (defensivo).
    expect(p.outcomeLabel("over", null)).toBe("Over");
    // scenarioLabel: header LEIGO da coluna de cenário — VERBATIM do SIDE_LABEL
    // pré-pivot (paridade VISUAL), distinto de outcomeLabel ("Over 2.5").
    expect(p.scenarioLabel("over", 2.5)).toBe("mais de 2.5 gols");
    expect(p.scenarioLabel("under", 2.5)).toBe("menos de 2.5 gols");
    expect(p.betSummary("over", 2.5)).toEqual({
      market: "Mais de 2.5 gols",
      plain: "pelo menos 3 gols no jogo",
    });
    expect(p.betSummary("under", 2.5)).toEqual({
      market: "Menos de 2.5 gols",
      plain: "no máximo 2 gols no jogo",
    });
    expect(p.framingLabel("over", 2.5)).toBe("pelo menos 3 gols");
    expect(p.framingLabel("under", 2.5)).toBe("menos de 3 gols");
    expect(p.settlementMetricLabel).toBe("gols (90')");
    // cut do over/under: total > linha → "over" (3 gols na linha 2.5).
    expect(p.classifyH2H?.(2, 1, 2.5)).toBe("over");
    expect(p.classifyH2H?.(1, 1, 2.5)).toBe("under");
  });

  it("match_result: labels home/draw/away, sem linha, sem lente de gols", () => {
    const p = getMarketPresentation("match_result");
    expect(p.defaultLine).toBeNull();
    expect(p.selectionLabel("home")).toBe("Casa");
    expect(p.outcomeLabel("draw", null)).toBe("Empate");
    expect(p.outcomeLabel("away", null)).toBe("Fora");
    // scenarioLabel 1X2: Casa/Empate/Fora (sem linha, igual ao outcomeLabel).
    expect(p.scenarioLabel("home", null)).toBe("Casa");
    expect(p.scenarioLabel("draw", null)).toBe("Empate");
    expect(p.scenarioLabel("away", null)).toBe("Fora");
    expect(p.classifyH2H).toBeNull();
  });

  it("btts: labels Sim/Não, sem linha, sub-linha leiga, sem lente de gols", () => {
    const p = getMarketPresentation("btts");
    expect(p.marketKey).toBe("btts");
    // Labels CURTOS espelham o seed (pinados por seed-parity).
    expect(p.marketLabel).toBe("Ambas marcam");
    expect(p.defaultLine).toBeNull();
    expect(p.selectionLabel("yes")).toBe("Sim");
    expect(p.selectionLabel("no")).toBe("Não");
    expect(p.outcomeLabel("yes", null)).toBe("Sim");
    expect(p.scenarioLabel("no", null)).toBe("Não");
    expect(p.betSummary("yes", null)).toEqual({
      market: "Ambos os times marcam",
      plain: "os dois times marcam no jogo",
    });
    expect(p.settlementMetricLabel).toBe("ambas marcam (90')");
    expect(p.classifyH2H).toBeNull();
  });

  it("double_chance: labels das 3 duplas, sem linha, sem lente de gols", () => {
    const p = getMarketPresentation("double_chance");
    expect(p.marketKey).toBe("double_chance");
    // Labels CURTOS espelham o seed (pinados por seed-parity).
    expect(p.marketLabel).toBe("Dupla chance");
    expect(p.defaultLine).toBeNull();
    expect(p.selectionLabel("home_or_draw")).toBe("Casa ou empate");
    expect(p.selectionLabel("away_or_draw")).toBe("Empate ou fora");
    expect(p.selectionLabel("home_or_away")).toBe("Casa ou fora");
    expect(p.outcomeLabel("home_or_draw", null)).toBe("Casa ou empate");
    expect(p.scenarioLabel("home_or_away", null)).toBe("Casa ou fora");
    expect(p.settlementMetricLabel).toBe("resultado (90')");
    expect(p.classifyH2H).toBeNull();
  });

  it("settlementMetricValue é registry-driven por mercado", () => {
    const rd = (homeScore: number, awayScore: number) => ({
      homeScore,
      awayScore,
      totalGoals: homeScore + awayScore,
    });
    // over_under: total de gols (byte-idêntico ao legado); fallback quando rd null.
    const ou = getMarketPresentation("over_under");
    expect(ou.settlementMetricValue(rd(2, 1), 3)).toBe("3");
    expect(ou.settlementMetricValue(null, 4)).toBe("4");
    // match_result: placar "2-1"; split nulo → fallback total.
    const mr = getMarketPresentation("match_result");
    expect(mr.settlementMetricValue(rd(2, 1), 3)).toBe("2-1");
    expect(
      mr.settlementMetricValue({ homeScore: null, awayScore: null, totalGoals: 3 }, 3),
    ).toBe("3");
    // btts: Sim quando ambos marcaram, Não senão; split nulo → "—".
    const btts = getMarketPresentation("btts");
    expect(btts.settlementMetricValue(rd(1, 1), 2)).toBe("Sim");
    expect(btts.settlementMetricValue(rd(2, 0), 2)).toBe("Não");
    expect(btts.settlementMetricValue(rd(0, 0), 0)).toBe("Não");
    expect(
      btts.settlementMetricValue({ homeScore: null, awayScore: 1, totalGoals: 1 }, 1),
    ).toBe("—");
    // double_chance: placar "2-1" (como 1X2); split nulo → fallback total.
    const dc = getMarketPresentation("double_chance");
    expect(dc.settlementMetricValue(rd(2, 1), 3)).toBe("2-1");
    expect(
      dc.settlementMetricValue({ homeScore: null, awayScore: null, totalGoals: 3 }, 3),
    ).toBe("3");
  });

  it("lança em mercado desconhecido (bug de chamada, não degrada)", () => {
    expect(() => getMarketPresentation("nope")).toThrow(
      /unknown market presentation/,
    );
  });

  it("é seguro pro bundle do cliente: sem import de @/lib/ai, @/lib/db ou market-descriptor", () => {
    // Guard-test do inegociável de bundle do cliente (#170 importa este módulo
    // num componente "use client"). Converte a convenção num teste que falha.
    // Caminho relativo à raiz do pacote (cwd do vitest). Olha só os ESPECIFICADORES
    // de `from "…"` (não comentários, que citam esses paths de propósito).
    const src = readFileSync("lib/view/markets/presentation.ts", "utf8");
    const specifiers = [...src.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(
      (m) => m[1],
    );
    expect(specifiers.some((s) => s.startsWith("@/lib/ai"))).toBe(false);
    expect(specifiers.some((s) => s.startsWith("@/lib/db"))).toBe(false);
    expect(specifiers.some((s) => s.includes("market-descriptor"))).toBe(false);
  });
});
