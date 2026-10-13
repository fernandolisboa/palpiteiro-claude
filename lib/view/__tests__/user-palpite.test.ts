import { describe, expect, it } from "vitest";

import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";
import type { UserPalpiteAnalysisRecord } from "@/lib/db/queries/user-palpite-analyses";
import { computeReadings, evidenceFromClaims } from "@/lib/user-palpite/evidence";
import { lambdasFor } from "@/lib/user-palpite/lambdas";
import type { PalpiteModelBase } from "@/lib/user-palpite/model-base";
import { readingMatrix, readPalpite } from "@/lib/user-palpite/reading";
import type { CheckedClaim, UserPalpite } from "@/lib/user-palpite/types";
import {
  toReadingRowsView,
  toSeuPalpiteModelView,
  toUserPalpiteAnalysisView,
  verdictHeadline,
} from "@/lib/view/user-palpite";

const TEAMS = { home: "Flamengo", away: "Palmeiras" };
const NOW = new Date("2026-05-14T12:00:00Z");

function answers(over: Partial<Record<string, number>> = {}): JudgmentAnswers {
  return Object.fromEntries(
    JUDGMENT_QUESTION_IDS.map((id) => [id, { value: over[id] ?? 0.3, confidence: null }]),
  ) as JudgmentAnswers;
}

function base(jev: JudgmentAnswers | null, over: Partial<PalpiteModelBase> = {}) {
  return {
    origin: "snapshot",
    snapshotId: "s1",
    modelVersion: "match_model_v1",
    snapshotWeightsVersion: jev ? "judgment_weights_v1" : null,
    source: "dixon_coles",
    degraded: false,
    fallbackReason: null,
    staleBase: false,
    lambdaHomeBase: 1.6,
    lambdaAwayBase: 1.1,
    rho: -0.07,
    jevAnswers: jev,
    ...over,
  } satisfies PalpiteModelBase;
}

function claim(over: Partial<CheckedClaim> = {}): CheckedClaim {
  return {
    team: "away",
    topic: "absence",
    text: "o jogador citado, atacante, está fora",
    players: ["Fulano"],
    role: "attack",
    index: 0,
    status: "unverifiable",
    evidence: "Não está na nossa lista de desfalques do Palmeiras.",
    sides: [{ side: "away", status: "unverifiable" }],
    playerChecks: [{ name: "Fulano", status: "unverifiable", questionId: null }],
    signals: [{ questionId: "attack_weakened_away", strength: "unverified" }],
    ...over,
  };
}

function record(
  b: PalpiteModelBase,
  claims: CheckedClaim[],
  palpite: UserPalpite = { kind: "score", home: 2, away: 0 },
): UserPalpiteAnalysisRecord {
  const jevApplied = b.jevAnswers !== null;
  const ev = evidenceFromClaims(claims, { jevApplied });
  const r = computeReadings(b, ev, palpite);
  return {
    id: "a1",
    createdAt: new Date("2026-05-14T11:00:00Z"),
    palpite,
    palpiteSource: "buttons",
    claims,
    model: {
      origin: b.origin,
      snapshotId: b.snapshotId,
      source: b.source,
      degraded: b.degraded,
      staleBase: b.staleBase,
      rho: b.rho,
      lambdaBase: { home: b.lambdaHomeBase, away: b.lambdaAwayBase },
      lambdaWithout: { home: r.lambdaWithout.lambdaHome, away: r.lambdaWithout.lambdaAway },
      lambdaWith: { home: r.lambdaWith.lambdaHome, away: r.lambdaWith.lambdaAway },
      jevApplied,
      jevAnswers: b.jevAnswers,
      userEvidence: ev,
      combinedAnswers: r.combined,
      multipliersWith: r.lambdaWith.multipliers,
      modelLabel: jevApplied ? "Dixon-Coles · JEV aplicado" : "Dixon-Coles · JEV não aplicado",
      versions: {
        matchModel: "match_model_v1",
        judgments: "jev_judgments_v1",
        weights: "judgment_weights_v1",
        snapshotWeights: null,
        userEvidence: "user_evidence_v1",
        verdict: "palpite_verdict_v1",
        extract: "user_palpite_extract_v1",
        narrate: "user_palpite_narrate_v1",
      },
    },
    reading: { without: r.without, with: r.with },
    narration: {
      codeVerdict: "em_parte",
      veredito: "concordo",
      resumo: "Resumo.",
      pontos: ["Ponto."],
      discordancias: [{ claimIndex: 0, texto: "Discordo disso." }],
      warnings: [],
    },
    narrationSource: "llm",
  };
}

function allStrings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(allStrings);
  if (v && typeof v === "object") return Object.values(v).flatMap(allStrings);
  return [];
}

describe("toSeuPalpiteModelView", () => {
  it("serializa o λ base × JEV; o cliente refaz a MESMA leitura gravada (paridade)", () => {
    const b = base(answers({ attack_weakened_home: 0.9 }));
    const view = toSeuPalpiteModelView(b);
    const l = lambdasFor(b, b.jevAnswers);
    expect(view).toMatchObject({
      lambdaHome: l.lambdaHome,
      lambdaAway: l.lambdaAway,
      rho: -0.07,
      jevApplied: true,
      modelLabel: "Dixon-Coles · JEV aplicado",
    });
    for (const p of [
      { kind: "score", home: 2, away: 0 },
      { kind: "score", home: 1, away: 1 },
      { kind: "result", selection: "away" },
    ] as UserPalpite[]) {
      const client = readPalpite(
        { matrix: readingMatrix(view), lambdaHome: view.lambdaHome, lambdaAway: view.lambdaAway },
        p,
      );
      expect(client).toEqual(computeReadings(b, {}, p).without);
    }
  });

  it("rótulos: sem JEV, base velha e dados limitados", () => {
    expect(toSeuPalpiteModelView(base(null)).modelLabel).toBe("Dixon-Coles · JEV não aplicado");
    expect(
      toSeuPalpiteModelView(
        base(null, {
          origin: "live",
          source: "heuristic",
          fallbackReason: "no_fit",
          degraded: true,
          staleBase: true,
        }),
      ).modelLabel,
    ).toBe(
      "heurístico da tabela (liga sem ajuste) · dados limitados · base do jogo desatualizada · JEV não aplicado",
    );
  });
});

describe("toReadingRowsView", () => {
  it("placar exato: posição, chance do resultado e o palpite marcado no top 5", () => {
    const b = base(null);
    const p: UserPalpite = { kind: "score", home: 1, away: 0 };
    const rows = toReadingRowsView(computeReadings(b, {}, p).without, p, TEAMS);
    expect(rows.palpiteTitle).toBe("Chance desse placar");
    expect(rows.rank).toMatch(/placar mais provável$/);
    expect(rows.result?.title).toBe("Chance de vitória do Flamengo");
    expect(rows.top).toHaveLength(5);
    expect(rows.top.filter((c) => c.isPalpite)).toHaveLength(1);
  });

  it("resultado: sem posição, top 3 dentro do resultado", () => {
    const p: UserPalpite = { kind: "result", selection: "draw" };
    const rows = toReadingRowsView(computeReadings(base(null), {}, p).without, p, TEAMS);
    expect(rows.palpiteTitle).toBe("Chance de empate");
    expect(rows.rank).toBeNull();
    expect(rows.result).toBeNull();
    expect(rows.top).toHaveLength(3);
    expect(rows.top.every((c) => c.label.split(" × ")[0] === c.label.split(" × ")[1])).toBe(true);
  });
});

describe("verdictHeadline", () => {
  it("placar exato fala da posição sempre junto do percentual", () => {
    const p: UserPalpite = { kind: "score", home: 1, away: 0 };
    const r = computeReadings(base(null), {}, p).without;
    expect(r.scoreRank).not.toBeNull();
    expect(r.scoreRank!).toBeLessThanOrEqual(3);
    expect(verdictHeadline(r, p, TEAMS)).toMatch(
      /^Flamengo 1 × 0 Palmeiras está entre os 3 placares mais prováveis \(\d+,\d%\)$/,
    );
    const far: UserPalpite = { kind: "score", home: 0, away: 4 };
    const rf = computeReadings(base(null), {}, far).without;
    expect(verdictHeadline(rf, far, TEAMS)).toMatch(/é o \d+º placar mais provável \(\d+,\d%\)$/);
  });
});

describe("toUserPalpiteAnalysisView", () => {
  it("não verificável com efeito: rótulos, efeito, nota e discordância ligada à afirmação", () => {
    const v = toUserPalpiteAnalysisView(record(base(null), [claim()]), TEAMS, NOW);
    expect(v.createdAgo).toBe("há 1h");
    expect(v.verdict).toBe("em_parte");
    expect(v.verdictLabel).toBe("o modelo concorda em parte");
    expect(v.palpiteLabel).toBe("Flamengo 2 × 0 Palmeiras");
    expect(v.claims[0]).toMatchObject({
      statusLabel: "não verificável",
      topicLabel: "desfalque",
      effect: "efeito no modelo: ataque do Palmeiras ajustado para baixo",
      players: [],
    });
    expect(v.showUnverifiedNote).toBe(true);
    expect(v.showFullSquadNote).toBe(false);
    expect(v.changed).toBe(true);
    expect(v.discordancias).toEqual([
      { claimText: "o jogador citado, atacante, está fora", texto: "Discordo disso." },
    ]);
  });

  it("confirmada com JEV presente: 'já considerado pelo modelo', leitura não muda", () => {
    const c = claim({
      status: "confirmed",
      signals: [{ questionId: "attack_weakened_away", strength: "confirmed" }],
    });
    const v = toUserPalpiteAnalysisView(record(base(answers()), [c]), TEAMS, NOW);
    expect(v.claims[0].effect).toBe("já considerado pelo modelo");
    expect(v.changed).toBe(false);
    expect(v.showUnverifiedNote).toBe(false);
  });

  it("time completo e afirmação sem sinal: nota do time completo e 'sem efeito no modelo'", () => {
    const c = claim({
      topic: "full_squad",
      team: "home",
      players: undefined,
      role: undefined,
      signals: [],
      playerChecks: [],
    });
    const v = toUserPalpiteAnalysisView(record(base(null), [c]), TEAMS, NOW);
    expect(v.claims[0].effect).toBe("sem efeito no modelo");
    expect(v.showFullSquadNote).toBe(true);
  });

  it("vários jogadores: resultado por jogador", () => {
    const c = claim({
      players: ["Fulano", "Beltrano"],
      playerChecks: [
        { name: "Fulano", status: "confirmed", questionId: "attack_weakened_away" },
        { name: "Beltrano", status: "unverifiable", questionId: null },
      ],
    });
    const v = toUserPalpiteAnalysisView(record(base(null), [c]), TEAMS, NOW);
    expect(v.claims[0].players).toEqual([
      { name: "Fulano", statusLabel: "confirmada" },
      { name: "Beltrano", statusLabel: "não verificável" },
    ]);
  });

  it("nenhuma string do view tem linguagem de valor", () => {
    const views = [
      toUserPalpiteAnalysisView(record(base(null), [claim()]), TEAMS, NOW),
      toUserPalpiteAnalysisView(
        record(base(answers()), [claim()], { kind: "result", selection: "away" }),
        TEAMS,
        NOW,
      ),
    ];
    for (const s of views.flatMap(allStrings)) {
      expect(containsValueLanguage(s), s).toBe(false);
    }
  });
});
