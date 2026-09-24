import { afterEach, describe, expect, it, vi } from "vitest";

import { judgeMatch } from "../judge-match";
import { createTypeSafeJudgmentProvider, noulConfidence } from "../provider";
import { JUDGMENT_QUESTION_IDS } from "../questions";
import type { JudgmentStateInput } from "../state";
import type { JudgmentProvider } from "../types";

const STATE_INPUT: JudgmentStateInput = {
  competition: "Brazilian Serie A",
  kickoffAt: "2026-09-24T22:00:00Z",
  home: { name: "Home FC", absences: [] },
  away: { name: "Away FC", absences: [] },
};

function okBody(noul = 0.9) {
  return {
    model: "jev-1.13.0",
    answers: Object.fromEntries(
      JUDGMENT_QUESTION_IDS.map((id) => [id, { type: "noul", noul }])
    ),
    usage: { input_tokens: 2_000, output_tokens: 40 },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("judgeMatch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sem chave → null, sem chamar judge", async () => {
    const judge = vi.fn();
    const onFailure = vi.fn();
    const provider: JudgmentProvider = { hasKey: () => false, judge };
    await expect(
      judgeMatch(provider, STATE_INPUT, { onFailure })
    ).resolves.toBeNull();
    expect(judge).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "missing_key" })
    );
  });

  it("provider TypeSafe real sem TYPESAFE_API_KEY → null", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const fetchImpl = vi.fn();
    const provider = createTypeSafeJudgmentProvider({ fetchImpl });
    await expect(judgeMatch(provider, STATE_INPUT)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("erro HTTP → null (nunca lança) e reporta o tipo", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "k");
    const onFailure = vi.fn();
    const provider = createTypeSafeJudgmentProvider({
      fetchImpl: async () => jsonResponse(429, {}),
    });
    await expect(
      judgeMatch(provider, STATE_INPUT, { onFailure })
    ).resolves.toBeNull();
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "rate_limited", httpStatus: 429 })
    );
  });

  it("judge que lança erro qualquer → null; onFailure que lança não fura", async () => {
    const provider: JudgmentProvider = {
      hasKey: () => true,
      judge: async () => {
        throw new Error("boom");
      },
    };
    await expect(
      judgeMatch(provider, STATE_INPUT, {
        onFailure: () => {
          throw new Error("logger quebrado");
        },
      })
    ).resolves.toBeNull();
  });

  it("resposta sem alguma das 8 perguntas → null", async () => {
    const provider: JudgmentProvider = {
      hasKey: () => true,
      judge: async () => ({
        answers: { attack_weakened_home: { value: 1, confidence: 1 } },
        model: "jev-1.13.0",
        inputTokens: 10,
        latencyMs: 5,
        requestPayload: {},
        responsePayload: {},
      }),
    };
    await expect(judgeMatch(provider, STATE_INPUT)).resolves.toBeNull();
  });

  it("sucesso → 8 julgamentos, custo só de input, payloads pro log", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "k");
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody(0.9)));
    const provider = createTypeSafeJudgmentProvider({ fetchImpl });
    const r = await judgeMatch(provider, STATE_INPUT);

    expect(r).not.toBeNull();
    expect(r?.version).toBe("jev_judgments_v1");
    expect(Object.keys(r!.answers)).toHaveLength(8);
    expect(r?.answers.high_stakes_away.value).toBe(0.9);
    // Noul não traz confidence na API → derivada |2p − 1|.
    expect(r?.answers.high_stakes_away.confidence).toBeCloseTo(0.8);
    expect(r?.model).toBe("jev-1.13.0");
    expect(r?.inputTokens).toBe(2_000);
    expect(r?.costUsd).toBeCloseTo((2_000 * 0.042) / 1_000_000, 12);
    expect(r?.requestPayload).toMatchObject({ model: "jev-1.13.0" });
    expect(r?.state.home_team.name).toBe("Home FC");
  });
});

describe("noulConfidence", () => {
  it("0 no ponto neutro, 1 nos extremos", () => {
    expect(noulConfidence(0.5)).toBe(0);
    expect(noulConfidence(0)).toBe(1);
    expect(noulConfidence(1)).toBe(1);
  });
});
