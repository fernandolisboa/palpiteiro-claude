import { z } from "zod";

import type { JudgmentMultipliers } from "@/lib/ai/judgments/apply";
import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type {
  JudgmentAnswers,
  JudgmentQuestionId,
} from "@/lib/ai/judgments/types";
import type {
  DixonColesFallbackReason,
  ModelScorelineSource,
} from "@/lib/quant/match-model";

// Tipos e schemas da base do modelo por jogo (#555, ADR 0052). As colunas jsonb de
// `match_model_snapshots` são tipadas por `$type<>` no schema, mas o Postgres não
// garante a forma: toda leitura passa pelos schemas Zod daqui (row inválida → omitida
// com log, nunca derruba a página).

const pp = z.number().finite();

const overUnderSideSchema = z.object({ over: pp, under: pp });

// Probabilidades em pontos percentuais (0..100, 2 casas), a mesma escala de
// `selectionProbsFromMatrix` (code-jev.ts). Dupla chance é cobertura sobreposta
// (Σ ≈ 200).
export const matchModelProbabilitiesSchema = z.object({
  match_result: z.object({ home: pp, draw: pp, away: pp }),
  double_chance: z.object({
    home_or_draw: pp,
    away_or_draw: pp,
    home_or_away: pp,
  }),
  btts: z.object({ yes: pp, no: pp }),
  over_under: z.object({
    "1.5": overUnderSideSchema,
    "2.5": overUnderSideSchema,
    "3.5": overUnderSideSchema,
  }),
});
export type MatchModelProbabilities = z.infer<
  typeof matchModelProbabilitiesSchema
>;

export const topScorelineSchema = z.object({
  home: z.number().int().nonnegative(),
  away: z.number().int().nonnegative(),
  pct: pp,
});
export type TopScoreline = z.infer<typeof topScorelineSchema>;

const judgmentSchema = z.object({
  value: z.number(),
  confidence: z.number().nullable(),
});

// Todas as perguntas do conjunto atual, nem mais nem menos chaves conhecidas: uma
// resposta parcial não pode ser aplicada (applyJudgments lê cada id).
const judgmentAnswersSchema = z.object(
  Object.fromEntries(JUDGMENT_QUESTION_IDS.map((id) => [id, judgmentSchema])) as Record<
    JudgmentQuestionId,
    typeof judgmentSchema
  >,
);

const lambdaMultipliersSchema = z.object({
  factors: z.partialRecord(
    z.enum(JUDGMENT_QUESTION_IDS as [JudgmentQuestionId, ...JudgmentQuestionId[]]),
    z.number(),
  ),
  product: z.number(),
  applied: z.number(),
});

// Subconjunto de PredictionJudgments (lib/ai/engine/types.ts) com os MESMOS caminhos
// jsonb que o reuso filtra (applied, stateHash, versions.judgments/weights/jevModel),
// sem engine/lambda/narrator: o λ da base vive nas colunas da row.
export type MatchModelJudgments = {
  applied: boolean;
  answers: JudgmentAnswers | null;
  multipliers: JudgmentMultipliers | null;
  versions: {
    judgments: string;
    weights: string;
    // Modelo JEV PEDIDO (pin) quando o JEV respondeu; null quando não respondeu.
    jevModel: string | null;
    // Modelo ecoado pela API (auditoria).
    jevModelServed: string | null;
  };
  failure: { kind: string; message: string } | null;
  stateHash: string;
  // Row de ai_calls da chamada JEV que produziu `answers` (num reuso, a da origem).
  aiCallId: string | null;
  // Origem das respostas quando reusadas (no máximo um dos dois é não-null).
  reusedFromPredictionId: string | null;
  reusedFromModelSnapshotId: string | null;
};

export const matchModelJudgmentsSchema: z.ZodType<MatchModelJudgments> =
  z.object({
    applied: z.boolean(),
    answers: judgmentAnswersSchema.nullable(),
    multipliers: z
      .object({ home: lambdaMultipliersSchema, away: lambdaMultipliersSchema })
      .nullable(),
    versions: z.object({
      judgments: z.string(),
      weights: z.string(),
      jevModel: z.string().nullable(),
      jevModelServed: z.string().nullable(),
    }),
    failure: z.object({ kind: z.string(), message: z.string() }).nullable(),
    stateHash: z.string(),
    aiCallId: z.string().nullable(),
    reusedFromPredictionId: z.string().nullable(),
    reusedFromModelSnapshotId: z.string().nullable(),
  });

export const JEV_STATUSES = ["not_attempted", "applied", "failed"] as const;
export type MatchModelJevStatus = (typeof JEV_STATUSES)[number];

const LAMBDA_SOURCES = ["dixon_coles", "heuristic"] as const satisfies readonly ModelScorelineSource[];

const FALLBACK_REASONS = [
  "flag_off",
  "no_fit",
  "stale_fit",
  "team_missing",
  "few_matches",
  "error",
] as const satisfies readonly DixonColesFallbackReason[];

// Row de `match_model_snapshots` validada (colunas escalares + jsonb).
export const matchModelSnapshotSchema = z.object({
  id: z.string(),
  matchId: z.string(),
  computedAt: z.date(),
  checkedAt: z.date(),
  modelVersion: z.string(),
  fingerprint: z.string(),
  lambdaSource: z.enum(LAMBDA_SOURCES),
  lambdaDegraded: z.boolean(),
  lambdaFallbackReason: z.enum(FALLBACK_REASONS).nullable(),
  rho: z.number().finite().nullable(),
  neutral: z.boolean(),
  lambdaHomeBase: z.number().finite(),
  lambdaAwayBase: z.number().finite(),
  lambdaHome: z.number().finite(),
  lambdaAway: z.number().finite(),
  jevStatus: z.enum(JEV_STATUSES),
  judgments: matchModelJudgmentsSchema.nullable(),
  probabilities: matchModelProbabilitiesSchema,
  topScorelines: z.array(topScorelineSchema),
});
export type MatchModelSnapshot = z.infer<typeof matchModelSnapshotSchema>;
