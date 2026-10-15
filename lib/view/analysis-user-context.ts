import type { PredictionWithAiCall } from "@/lib/db/queries/predictions";
import { formatRelativeAgoLabel } from "@/lib/format";
import { pickUserContext } from "@/lib/user-palpite/analysis-context";
import { claimEffect } from "@/lib/user-palpite/evidence";
import {
  STATUS_LABEL,
  TOPIC_LABEL,
  claimDescription,
} from "@/lib/user-palpite/labels";
import type { TeamNames } from "@/lib/user-palpite/reading";
import type { ClaimStatus } from "@/lib/user-palpite/types";

import { claimEffectText } from "./user-palpite";

// "O que você acrescentou" (#565): o contexto extra conferido da análise visível, dentro
// de "Ler análise completa". PURO. A afirmação aparece pelo texto que o código monta
// dos campos tipados (o mesmo que o modelo usou), nunca a paráfrase nem nome de jogador.

export type AnalysisUserContextClaimView = {
  index: number;
  text: string;
  topicLabel: string;
  status: ClaimStatus;
  statusLabel: string;
  evidence: string;
  effect: string;
};

export type AnalysisUserContextView = {
  createdAgo: string;
  claims: AnalysisUserContextClaimView[];
  showUnverifiedNote: boolean;
};

export function toAnalysisUserContextView(
  history: readonly Pick<PredictionWithAiCall, "marketKey" | "prediction">[],
  teams: TeamNames,
  now: Date,
): AnalysisUserContextView | null {
  const picked = pickUserContext(history);
  if (!picked) return null;
  const { context, jevAnswers } = picked;
  return {
    createdAgo: formatRelativeAgoLabel(picked.createdAt, now),
    claims: context.claims.map((c) => ({
      index: c.index,
      text: claimDescription(c, teams),
      topicLabel: TOPIC_LABEL[c.topic],
      status: c.status,
      statusLabel: STATUS_LABEL[c.status],
      evidence: c.evidence,
      effect: claimEffectText(c, jevAnswers, teams),
    })),
    showUnverifiedNote: context.claims.some(
      (c) => c.status === "unverifiable" && claimEffect(c, jevAnswers).moved.length > 0,
    ),
  };
}
