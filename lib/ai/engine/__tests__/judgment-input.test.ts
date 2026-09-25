import { describe, expect, it } from "vitest";

import {
  judgmentInputFingerprint,
  type MatchJudgmentData,
} from "@/lib/ai/engine/judgment-input";
import type { NormalizedFixture } from "@/lib/providers/sports-data/types";

// Impressão digital dos insumos do state JEV (#512): chave do memo do best bet,
// calculada ANTES de buscar a escalação do jogo anterior.

const KICKOFF = new Date("2026-05-15T19:00:00.000Z");

const previous = (kickoffAt: string): NormalizedFixture => ({
  id: `prev-${kickoffAt}`,
  league: "brasileirao_a",
  kickoffAt,
  kickoffTimestampMs: Date.parse(kickoffAt),
  homeTeam: "SE Palmeiras",
  awayTeam: "Fluminense FC",
  status: "finished",
  score: { home: 1, away: 0 },
});

function data(
  overrides: Partial<Omit<MatchJudgmentData, "previousLineups">> = {}
): Omit<MatchJudgmentData, "previousLineups"> {
  return {
    league: "brasileirao_a",
    kickoffAt: KICKOFF,
    homeTeam: "CR Flamengo",
    awayTeam: "Fluminense FC",
    injuries: {
      home: [],
      away: [
        { player: { name: "Germán Cano" }, type: "injury", status: "injured" },
      ],
    },
    lineups: undefined,
    homeForm: [],
    awayForm: [previous("2026-05-08T19:00:00.000Z")],
    standings: undefined,
    ...overrides,
  };
}

describe("judgmentInputFingerprint", () => {
  it("mesmos insumos → mesma impressão; não depende de acento/caixa do nome", () => {
    const a = judgmentInputFingerprint(data());
    expect(judgmentInputFingerprint(data())).toBe(a);
    expect(
      judgmentInputFingerprint(
        data({
          injuries: {
            home: [],
            away: [
              {
                player: { name: "GERMAN CANO" },
                type: "injury",
                status: "injured",
              },
            ],
          },
        })
      )
    ).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("outro desfalcado com o MESMO papel no state muda a impressão (o papel vem da escalação anterior)", () => {
    const a = judgmentInputFingerprint(data());
    const b = judgmentInputFingerprint(
      data({
        injuries: {
          home: [],
          away: [
            { player: { name: "Keno" }, type: "injury", status: "injured" },
          ],
        },
      })
    );
    expect(b).not.toBe(a);
  });

  it("status do desfalque e jogo anterior diferentes mudam a impressão", () => {
    const a = judgmentInputFingerprint(data());
    expect(
      judgmentInputFingerprint(
        data({
          injuries: {
            home: [],
            away: [
              {
                player: { name: "Germán Cano" },
                type: "injury",
                status: "doubtful",
              },
            ],
          },
        })
      )
    ).not.toBe(a);
    expect(
      judgmentInputFingerprint(
        data({ awayForm: [previous("2026-05-11T19:00:00.000Z")] })
      )
    ).not.toBe(a);
  });
});
