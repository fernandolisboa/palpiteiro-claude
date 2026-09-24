import {
  callSystemOne,
  hasTypeSafeKey,
  type TypeSafeNoulAnswer,
} from "@/lib/ai/providers/typesafe/client";

import type {
  Judgment,
  JudgmentProvider,
  JudgmentQuestionSet,
  JudgmentState,
} from "./types";

// A API não devolve `confidence` pra Noul (docs.typesafe.ai/confidence: "Noul
// answers don't carry one" — o noul já descreve a distribuição sim/não). Derivo
// pela MESMA fórmula que a doc usa pra Choice, `(n·pico − 1)/(n − 1)`, com n = 2:
// |2·noul − 1|. Assim o gating de confiança (ADR 0041 §3) vira uma zona morta em
// torno de 0.5 em vez de nunca disparar.
export function noulConfidence(noul: number): number {
  return Math.abs(2 * noul - 1);
}

function toJudgment(answer: TypeSafeNoulAnswer): Judgment {
  return {
    value: answer.noul,
    confidence: answer.confidence ?? noulConfidence(answer.noul),
  };
}

export function createTypeSafeJudgmentProvider(
  deps: { fetchImpl?: typeof fetch } = {}
): JudgmentProvider {
  return {
    hasKey: hasTypeSafeKey,
    async judge(state: JudgmentState, questions: JudgmentQuestionSet) {
      const result = await callSystemOne({
        state,
        questions,
        fetchImpl: deps.fetchImpl,
      });
      const answers: Record<string, Judgment> = {};
      for (const [id, answer] of Object.entries(result.response.answers)) {
        answers[id] = toJudgment(answer);
      }
      return {
        answers,
        model: result.response.model,
        inputTokens: result.response.usage.input_tokens,
        latencyMs: result.latencyMs,
        requestPayload: result.requestBody,
        // Já validado por Zod no cliente: é objeto.
        responsePayload: result.rawResponse as Record<string, unknown>,
      };
    },
  };
}
