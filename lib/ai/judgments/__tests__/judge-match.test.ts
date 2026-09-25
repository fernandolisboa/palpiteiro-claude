import { afterEach, describe, expect, it, vi } from "vitest";

import { judgeMatch, type JudgmentFailure } from "../judge-match";
import { createTypeSafeJudgmentProvider } from "../provider";
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

  it("resposta sem alguma das 8 perguntas → null; falha paga reporta custo", async () => {
    const onFailure = vi.fn();
    const provider: JudgmentProvider = {
      hasKey: () => true,
      judge: async () => ({
        answers: { attack_weakened_home: { value: 1, confidence: null } },
        model: "jev-1.13.0",
        inputTokens: 1_000,
        latencyMs: 5,
        requestPayload: { model: "jev-1.13.0" },
        responsePayload: {},
      }),
    };
    await expect(
      judgeMatch(provider, STATE_INPUT, { onFailure })
    ).resolves.toBeNull();
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "bad_response",
        inputTokens: 1_000,
        costUsd: (1_000 * 0.042) / 1_000_000,
        requestPayload: { model: "jev-1.13.0" },
      })
    );
  });

  it("2xx fora do schema no provider real → bad_response com tokens e payload", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "k");
    const onFailure = vi.fn();
    const body = okBody(0.9);
    const provider = createTypeSafeJudgmentProvider({
      fetchImpl: async () =>
        jsonResponse(200, {
          ...body,
          answers: { ...body.answers, rotation_risk_home: { type: "noul" } },
        }),
    });
    await expect(
      judgeMatch(provider, STATE_INPUT, { onFailure })
    ).resolves.toBeNull();
    const failure = onFailure.mock.calls[0][0] as JudgmentFailure;
    expect(failure.kind).toBe("bad_response");
    expect(failure.httpStatus).toBe(200);
    expect(failure.inputTokens).toBe(2_000);
    expect(failure.costUsd).toBeCloseTo((2_000 * 0.042) / 1_000_000, 12);
    expect(failure.requestPayload).toMatchObject({ model: "jev-1.13.0" });
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
    // Noul não traz confidence na API → null (nada fabricado).
    expect(r?.answers.high_stakes_away.confidence).toBeNull();
    expect(r?.model).toBe("jev-1.13.0");
    expect(r?.inputTokens).toBe(2_000);
    expect(r?.costUsd).toBeCloseTo((2_000 * 0.042) / 1_000_000, 12);
    expect(r?.requestPayload).toMatchObject({ model: "jev-1.13.0" });
    expect(r?.state.home_team.name).toBe("Home FC");
  });
});
