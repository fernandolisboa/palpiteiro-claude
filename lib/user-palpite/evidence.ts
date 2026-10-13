import type { AppliedJudgments } from "@/lib/ai/judgments/apply";
import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAnswers, JudgmentQuestionId } from "@/lib/ai/judgments/types";

import { lambdasFor, matrixFor } from "./lambdas";
import type { PalpiteModelBase } from "./model-base";
import { readPalpite } from "./reading";
import type {
  CheckedClaim,
  PalpiteReading,
  SignalStrength,
  UserEvidence,
  UserPalpite,
} from "./types";

// Evidência do usuário nos fatores do JEV (#564, ADR 0054 Decisão 3). É o ÚNICO caminho
// de uma afirmação até o número: noul por pergunta, combinado com o JEV por MÁXIMO e
// passando pelo mesmo applyJudgments (unilateral, com o clamp sobre o λ base).
//
// - Confirmada pelos nossos dados: o fato já estava no state que o JEV julgou, então com
//   JEV presente ela NÃO sobe o fator ("já considerado pelo modelo"); sem JEV vale 0.85.
// - Não verificável (ou papel dito pelo usuário): max(JEV, 0.7).
// - Contradita: nunca gera sinal (check-claims não emite).
// Mudou noul ou regra → bump USER_EVIDENCE_VERSION.
export const USER_EVIDENCE_VERSION = "user_evidence_v1";
export const USER_NOUL: Record<SignalStrength, number> = {
  confirmed: 0.85,
  unverified: 0.7,
};

const NEUTRAL = { value: 0.5, confidence: null };

/** Máximo por pergunta sobre os sinais das afirmações (várias iguais não empilham). */
export function evidenceFromClaims(
  claims: readonly CheckedClaim[],
  opts: { jevApplied: boolean },
): UserEvidence {
  const ev: UserEvidence = {};
  for (const c of claims) {
    for (const s of c.signals) {
      if (s.strength === "confirmed" && opts.jevApplied) continue;
      const noul = USER_NOUL[s.strength];
      ev[s.questionId] = Math.max(ev[s.questionId] ?? 0, noul);
    }
  }
  return ev;
}

/**
 * JEV ∨ usuário por MÁXIMO, pergunta a pergunta. Sem evidência numa pergunta fica o JEV
 * intacto (ou neutro 0.5 sem JEV). null quando não há JEV nem evidência.
 */
export function combineAnswers(
  jev: JudgmentAnswers | null,
  ev: UserEvidence,
): JudgmentAnswers | null {
  if (!jev && Object.keys(ev).length === 0) return null;
  const out = {} as JudgmentAnswers;
  for (const id of JUDGMENT_QUESTION_IDS) {
    const user = ev[id];
    const fromJev = jev?.[id];
    out[id] =
      user === undefined
        ? (fromJev ?? NEUTRAL)
        : {
            value: Math.max(fromJev?.value ?? 0, user),
            confidence: fromJev?.confidence ?? null,
          };
  }
  return out;
}

export type ComputedReadings = {
  without: PalpiteReading;
  with: PalpiteReading;
  lambdaWithout: AppliedJudgments;
  lambdaWith: AppliedJudgments;
  combined: JudgmentAnswers | null;
};

/** Leitura "sem o seu contexto" (base × JEV) e "com o seu contexto" (base × JEV∨usuário). */
export function computeReadings(
  base: PalpiteModelBase,
  ev: UserEvidence,
  p: UserPalpite,
): ComputedReadings {
  const combined = combineAnswers(base.jevAnswers, ev);
  const lambdaWithout = lambdasFor(base, base.jevAnswers);
  const lambdaWith = lambdasFor(base, combined);
  const read = (l: AppliedJudgments) =>
    readPalpite(
      { matrix: matrixFor(base, l), lambdaHome: l.lambdaHome, lambdaAway: l.lambdaAway },
      p,
    );
  return {
    without: read(lambdaWithout),
    with: read(lambdaWith),
    lambdaWithout,
    lambdaWith,
    combined,
  };
}

export type ClaimEffect = {
  // Fatores que a afirmação de fato moveu (o noul dela passou o do JEV e o neutro).
  moved: JudgmentQuestionId[];
  // Tinha sinal, mas o modelo já tinha esse fato (JEV igual ou mais forte).
  alreadyConsidered: boolean;
};

export function claimEffect(
  c: Pick<CheckedClaim, "signals">,
  ev: UserEvidence,
  jev: JudgmentAnswers | null,
): ClaimEffect {
  const moved = [
    ...new Set(
      c.signals
        .map((s) => s.questionId)
        .filter((q) => {
          const user = ev[q];
          if (user === undefined) return false;
          return user > Math.max(NEUTRAL.value, jev?.[q]?.value ?? 0);
        }),
    ),
  ];
  return { moved, alreadyConsidered: c.signals.length > 0 && moved.length === 0 };
}
