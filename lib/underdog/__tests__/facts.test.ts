import { describe, expect, it } from "vitest";

import {
  computeUnderdogFacts,
  underdogBaseFromSnapshot,
} from "@/lib/underdog/compute";
import {
  buildFactsBlock,
  complementPct,
  scorelineKey,
} from "@/lib/underdog/facts";
import { favoriteWeakenedMax } from "@/lib/underdog/scenarios";
import type { UnderdogFacts } from "@/lib/underdog/types";
import { NEWS_EVIDENCE_VERSION } from "@/lib/match-news/apply";
import { combineAnswers } from "@/lib/user-palpite/evidence";

import { answers, KICKOFF, NOW, snapshot } from "./fixtures";

const CTX = {
  teams: { home: "Palmeiras", away: "Flamengo" },
  competition: "Brasileirão Série A",
  kickoffLabel: "sáb, 21 nov, 16:30",
};

function facts(): UnderdogFacts {
  const base = underdogBaseFromSnapshot(snapshot(), KICKOFF, NOW)!;
  return computeUnderdogFacts(base, [
    { kind: "h2h", games: 5, underdogWins: 3, favoriteWins: 1 },
  ]);
}

describe("computeUnderdogFacts", () => {
  it("lado, chances, 3 placares, cenários e o modelo", () => {
    const f = facts();
    expect(f.side).toBe("away");
    expect(f.scorelines).toHaveLength(3);
    expect(f.scenarios.length).toBeGreaterThan(0);
    expect(f.model).toEqual({ source: "dixon_coles", jevApplied: false });
  });

  it("sinais do JEV da base entram depois dos de dado", () => {
    const snap = snapshot({
      jevStatus: "applied",
      judgments: {
        applied: true,
        answers: answers({ rotation_risk_home: 0.9 }),
        multipliers: null,
        versions: {
          judgments: "j",
          weights: "w",
          jevModel: "m",
          jevModelServed: "m",
        },
        failure: null,
        stateHash: "h",
        aiCallId: null,
        reusedFromPredictionId: null,
        reusedFromModelSnapshotId: null,
      },
    });
    const f = computeUnderdogFacts(
      underdogBaseFromSnapshot(snap, KICKOFF, NOW)!,
      [{ kind: "absences", favorite: 4, underdog: 0 }]
    );
    expect(f.signals.map((s) => s.kind)).toEqual(["absences", "jev"]);
    expect(f.model.jevApplied).toBe(true);
  });
});

describe("notícia da base (#672, ajuste 4)", () => {
  // Azarão = Flamengo (visitante). A notícia põe 0,7 no ataque do favorito (Palmeiras) e
  // no do azarão; o JEV respondeu 0,2 em tudo.
  const jev = answers();
  const evidence = { attack_weakened_home: 0.7, attack_weakened_away: 0.7 };
  const snap = () =>
    snapshot({
      jevStatus: "applied",
      judgments: {
        applied: true,
        answers: jev,
        multipliers: null,
        versions: { judgments: "j", weights: "w", jevModel: "m", jevModelServed: "m" },
        failure: null,
        stateHash: "h",
        aiCallId: null,
        reusedFromPredictionId: null,
        reusedFromModelSnapshotId: null,
        news: {
          batchId: "b-1",
          itemsRead: 2,
          claims: [],
          sources: [],
          evidence,
          moved: ["attack_weakened_home", "attack_weakened_away"],
          notes: [],
          versions: { extract: "match_news_extract_v1", newsEvidence: NEWS_EVIDENCE_VERSION },
        },
      },
    });

  it("o 0,7 só da notícia não vira sinal do JEV (jevSignals segue só JEV)", () => {
    const f = computeUnderdogFacts(underdogBaseFromSnapshot(snap(), KICKOFF, NOW)!);
    expect(f.signals.filter((s) => s.kind === "jev")).toEqual([]);
    expect(f.model.jevApplied).toBe(true);
  });

  it("cenário C (absences_max) parte do que a base aplicou: JEV ∨ notícia", () => {
    const s = snap();
    const f = computeUnderdogFacts(underdogBaseFromSnapshot(s, KICKOFF, NOW)!);
    const c = f.scenarios.find((x) => x.id === "absences_max");
    const args = {
      lambdaHomeBase: s.lambdaHomeBase,
      lambdaAwayBase: s.lambdaAwayBase,
      rho: s.rho ?? undefined,
      side: "away" as const,
    };
    const withNews = favoriteWeakenedMax({ ...args, answers: combineAnswers(jev, evidence) })!;
    const jevOnly = favoriteWeakenedMax({ ...args, answers: jev })!;
    expect(c?.afterPct).toBe(Math.round(withNews * 10) / 10);
    expect(Math.round(withNews * 10)).not.toBe(Math.round(jevOnly * 10));
  });
});

describe("buildFactsBlock", () => {
  it("ids estáveis e o texto delimitado", () => {
    const f = facts();
    const b = buildFactsBlock(f, CTX);
    const expected = [
      "P1",
      "P2",
      "P3",
      "S1",
      "S2",
      "S3",
      ...f.scenarios.map((_, i) => `C${i + 1}`),
      "F1",
      "M1",
    ];
    expect([...b.ids]).toEqual(expected);
    expect(b.text).toContain("<<<FATOS>>>");
    expect(b.text).toContain("<<<FIM_FATOS>>>");
    for (const id of expected) expect(b.text).toContain(`[${id}]`);
    expect(b.text).toContain("Flamengo venceu 3 dos últimos 5 confrontos");
    expect(b.text).toContain("Dixon-Coles");
  });

  it("allowed completo: chances, complemento, placares, cenários, minutos e o N", () => {
    const f = facts();
    const b = buildFactsBlock(f, CTX);
    expect(b.allowed.percents).toEqual(
      expect.arrayContaining([
        Math.round(f.chances.underdog),
        Math.round(f.chances.draw),
        Math.round(f.chances.favorite),
        complementPct(f),
        ...f.scorelines.map((s) => s.pct),
        ...f.scenarios.flatMap((c) => [
          Math.round(c.beforePct),
          Math.round(c.afterPct),
        ]),
      ])
    );
    expect(b.allowed.scorelines).toEqual(
      expect.arrayContaining([
        ...f.scorelines.map((s) => scorelineKey(s.home, s.away)),
        "0-1",
      ])
    );
    expect(b.allowed.minutes).toEqual([30, 60]);
    expect(b.allowed.ratios).toEqual([Math.round(100 / f.chances.underdog)]);
  });

  it("números soltos e pares 'N dos últimos M' vêm só dos sinais e do bloco", () => {
    const b = buildFactsBlock(facts(), CTX);
    // Confronto 5 jogos: Flamengo 3, Palmeiras 1, empate 1; minutos 30 e 60.
    expect(b.allowed.numbers).toEqual(
      expect.arrayContaining([5, 3, 1, 30, 60])
    );
    expect(b.allowed.numbers).not.toContain(7);
    expect(b.allowed.pairs).toEqual(
      expect.arrayContaining([
        { who: "underdog", result: "W", n: 3, of: 5 },
        { who: "favorite", result: "W", n: 1, of: 5 },
        { who: "any", result: "D", n: 1, of: 5 },
      ])
    );
    expect(b.allowed.teams).toEqual({
      home: "Palmeiras",
      away: "Flamengo",
      underdog: "Flamengo",
      favorite: "Palmeiras",
    });
  });

  it("percentuais como o bloco os mostra (sem o valor cru)", () => {
    const f = facts();
    const b = buildFactsBlock(f, CTX);
    expect(Number.isInteger(f.chances.underdog)).toBe(false);
    expect(b.allowed.percents).toContain(Math.round(f.chances.underdog));
    expect(b.allowed.percents).not.toContain(f.chances.underdog);
    expect(
      complementPct({ chances: { underdog: 20.2, draw: 25.4, favorite: 54.4 } })
    ).toBe(79);
  });

  it("modelo simplificado sem JEV", () => {
    const f = {
      ...facts(),
      model: { source: "heuristic" as const, jevApplied: false },
    };
    const b = buildFactsBlock(f, CTX);
    expect(b.text).toContain("modelo simplificado");
    expect(b.text).not.toContain("Dixon-Coles");
    expect(b.text).toContain("sem ajuste do JEV");
  });
});
