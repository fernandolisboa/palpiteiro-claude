import {
  formatCostUsd,
  formatEdge,
  formatGeneratedAt,
  formatModelName,
  formatOdd,
  formatPct,
} from "@/lib/format";
import type { AnalysisView, Recommendation } from "@/lib/view/types";

type PredictionInput = {
  recommendation: "over" | "under" | "pass";
  confidencePct: string | number;
  rationale: string;
  keyFactors: string[];
  minimumOdd: string | number | null;
  edgePct: string | number | null;
  modelVersion: string;
  promptVersion: string;
  createdAt: Date;
};

type AiCallInput = {
  costUsd: string | number;
};

const KIND_MAP: Record<PredictionInput["recommendation"], Recommendation> = {
  over: "OVER",
  under: "UNDER",
  pass: "PASS",
};

export function toAnalysisView(
  prediction: PredictionInput,
  aiCall: AiCallInput | null,
): AnalysisView {
  return {
    kind: KIND_MAP[prediction.recommendation],
    confidence: formatPct(prediction.confidencePct),
    edge: formatEdge(prediction.edgePct),
    minOdd: prediction.minimumOdd !== null ? formatOdd(prediction.minimumOdd) : null,
    rationale: prediction.rationale,
    factors: prediction.keyFactors,
    generatedAt: formatGeneratedAt(prediction.createdAt),
    promptVersion: prediction.promptVersion,
    model: formatModelName(prediction.modelVersion),
    costUsd: formatCostUsd(aiCall?.costUsd ?? null),
  };
}
