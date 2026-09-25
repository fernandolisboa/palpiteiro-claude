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
// answers don't carry one"). Não fabrico uma: fica null, e só é número se a API
// passar a enviar. O ajuste de λ (apply.ts) usa só o noul.
function toJudgment(answer: TypeSafeNoulAnswer): Judgment {
  return { value: answer.noul, confidence: answer.confidence ?? null };
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
