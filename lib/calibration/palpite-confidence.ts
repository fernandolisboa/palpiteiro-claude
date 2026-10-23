import { z } from "zod";

import {
  scoreOutcome,
  type PalpiteConfidenceLevel,
} from "@/lib/ai/palpites/confidence";

// Acerto da confiança do palpite por faixa (#649, ADR 0069). Puro: recebe os sets
// pré-jogo liquidados (lib/db/queries/palpite-confidence.ts) e devolve, por era e faixa,
// quantos palpites, a P média que o motor previu e quanto o RESULTADO do placar provável
// (casa/empate/fora) bateu com o placar de 90 minutos. O placar exato não entra: a
// confiança fala do resultado.

export const CONFIDENCE_LEVELS: readonly PalpiteConfidenceLevel[] = [
  "baixa",
  "media",
  "alta",
];

// "motor" = confiança calculada em código (#649); "llm" = a palavra que o LLM escolhia
// antes (sets sem `confidenceSource`).
export type ConfidenceEra = "motor" | "llm";

const score = z.object({
  home: z.number().int().nonnegative(),
  away: z.number().int().nonnegative(),
});

// O jsonb não tem schema no banco: lê só o que a calibração usa, validado.
const headlineSchema = z.object({
  confidence: z.enum(["baixa", "media", "alta"]).nullable(),
  confidenceProbPct: z.number().finite().min(0).max(100).nullable().optional(),
  confidenceSource: z
    .enum(["snapshot", "analysis", "live_matrix", "none"])
    .optional(),
});

export type PalpiteConfidenceRawRow = {
  matchId: string;
  headline: unknown;
  probableScore: unknown;
  resultData: unknown;
};

export type PalpiteConfidenceRow = {
  matchId: string;
  era: ConfidenceEra;
  level: PalpiteConfidenceLevel | null;
  probPct: number | null;
  hit: boolean;
};

const resultScore = z.object({
  homeScore: z.number().int().nonnegative(),
  awayScore: z.number().int().nonnegative(),
});

/** Row inválida (jsonb fora do formato, placar ausente) sai, nunca derruba a página. */
export function toConfidenceRow(
  raw: PalpiteConfidenceRawRow,
): PalpiteConfidenceRow | null {
  const headline = headlineSchema.safeParse(raw.headline);
  const predicted = score.safeParse(raw.probableScore);
  const result = resultScore.safeParse(raw.resultData);
  if (!headline.success || !predicted.success || !result.success) return null;
  const era: ConfidenceEra =
    headline.data.confidenceSource === undefined ? "llm" : "motor";
  return {
    matchId: raw.matchId,
    era,
    level: headline.data.confidence,
    probPct: era === "motor" ? (headline.data.confidenceProbPct ?? null) : null,
    hit:
      scoreOutcome(predicted.data) ===
      scoreOutcome({ home: result.data.homeScore, away: result.data.awayScore }),
  };
}

export type ConfidenceBand = {
  level: PalpiteConfidenceLevel;
  n: number;
  matches: number;
  // P média prevista (0..1); null na era LLM (não havia número) ou sem amostra.
  meanForecast: number | null;
  // Acerto observado do resultado (0..1); null sem amostra.
  hitRate: number | null;
};

export type ConfidenceEraSummary = {
  era: ConfidenceEra;
  bands: ConfidenceBand[];
  // Palpites da era sem confiança (motor sem probabilidade): só contagem.
  withoutConfidence: number;
};

function mean(values: number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((a, b) => a + b, 0) / values.length;
}

export function deriveConfidenceCalibration(
  rows: readonly PalpiteConfidenceRow[],
): ConfidenceEraSummary[] {
  return (["motor", "llm"] as const).map((era) => {
    const ofEra = rows.filter((r) => r.era === era);
    return {
      era,
      bands: CONFIDENCE_LEVELS.map((level) => {
        const band = ofEra.filter((r) => r.level === level);
        const probs = band.flatMap((r) => (r.probPct === null ? [] : [r.probPct / 100]));
        return {
          level,
          n: band.length,
          matches: new Set(band.map((r) => r.matchId)).size,
          meanForecast: era === "motor" ? mean(probs) : null,
          hitRate: mean(band.map((r) => (r.hit ? 1 : 0))),
        };
      }),
      withoutConfidence: ofEra.filter((r) => r.level === null).length,
    };
  });
}
