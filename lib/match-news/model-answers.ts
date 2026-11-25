import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import { combineAnswers } from "@/lib/user-palpite/evidence";
import type { UserEvidence } from "@/lib/user-palpite/types";

// O que a base (ou a análise) APLICOU nos fatores: JEV ∨ notícia por MÁXIMO (#672,
// ajuste 4 do PLAN-672). `judgments.answers` continua SÓ o JEV (o reuso por stateHash
// lê dali); quem refaz o λ a partir de λ base + respostas usa ESTE helper, senão perde
// a notícia. Puro e seguro no cliente. null = nada aplicado (sem JEV e sem notícia).
export function modelAnswersOf(
  judgments:
    | {
        answers: JudgmentAnswers | null;
        news?: { evidence: UserEvidence } | null;
      }
    | null
    | undefined,
): JudgmentAnswers | null {
  if (!judgments) return null;
  const evidence = judgments.news?.evidence ?? {};
  if (Object.keys(evidence).length === 0) return judgments.answers;
  return combineAnswers(judgments.answers, evidence);
}
