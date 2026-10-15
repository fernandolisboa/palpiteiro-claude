import { z } from "zod";

import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type {
  JudgmentAnswers,
  JudgmentQuestionId,
  TeamSide,
} from "@/lib/ai/judgments/types";

// Tipos e schemas do "Seu palpite" (#564, ADR 0055). Módulo seguro no cliente: só Zod
// e tipos (o componente importa os schemas e o BridgeLeg daqui). Toda leitura das
// colunas jsonb de `user_palpite_analyses` passa pelos schemas Stored* (padrão de
// lib/model-base/types.ts): o Postgres não garante a forma.

export const MAX_REASON_CHARS = 1000;
export const MIN_REASON_CHARS = 3;
// = MAX_EXACT_SCORE_GOALS (lib/bets/slip-markets.ts): a matriz vai até 10.
export const MAX_PALPITE_GOALS = 9;
export const MAX_CLAIMS = 8;
// Contexto extra da análise com IA (#565): mesmo teto e piso do motivo do palpite.
export const MAX_CONTEXT_CHARS = MAX_REASON_CHARS;
export const MIN_CONTEXT_CHARS = MIN_REASON_CHARS;

// ─── Palpite ────────────────────────────────────────────────────────────────

export const PALPITE_RESULTS = ["home", "draw", "away"] as const;
export type PalpiteResult = (typeof PALPITE_RESULTS)[number];

export const UserPalpiteSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("score"),
      home: z.number().int().min(0).max(MAX_PALPITE_GOALS),
      away: z.number().int().min(0).max(MAX_PALPITE_GOALS),
    })
    .strict(),
  z
    .object({
      kind: z.literal("result"),
      selection: z.enum(PALPITE_RESULTS),
    })
    .strict(),
]);
export type UserPalpite = z.infer<typeof UserPalpiteSchema>;

// Perna que o "Seu palpite" manda pra lista "Suas apostas" (ponte de contexto,
// components/bet-slip/bet-slip-provider.tsx).
export type BridgeLeg =
  | { kind: "exact_score"; params: { home: number; away: number } }
  | { kind: "match_result"; params: { selection: PalpiteResult } };

// ─── Afirmações ─────────────────────────────────────────────────────────────

export const CLAIM_TOPICS = [
  "absence",
  "full_squad",
  "form",
  "rotation",
  "stakes",
  "other",
] as const;
export type ClaimTopic = (typeof CLAIM_TOPICS)[number];

export const CLAIM_TEAMS = ["home", "away", "both"] as const;
export const CLAIM_ROLES = ["attack", "defense", "goalkeeper", "unknown"] as const;
export const CLAIM_DIRECTIONS = ["good", "bad"] as const;
export const CLAIM_SCOPES = ["injuries", "suspensions", "all"] as const;

export const ClaimSchema = z
  .object({
    team: z.enum(CLAIM_TEAMS),
    topic: z.enum(CLAIM_TOPICS),
    text: z.string().trim().min(1).max(200),
    players: z.array(z.string().trim().min(2).max(60)).min(1).max(5).optional(),
    role: z.enum(CLAIM_ROLES).optional(),
    direction: z.enum(CLAIM_DIRECTIONS).optional(),
    scope: z.enum(CLAIM_SCOPES).optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    // Desfalque sem nome ("o Palmeiras está sem o artilheiro") vale se a função vier:
    // fica não verificável, com o peso de não verificável (check-claims.ts).
    if (c.topic === "absence" && !c.players?.length && !c.role) {
      ctx.addIssue({ code: "custom", message: "absence sem players nem role" });
    }
    if ((c.topic === "form" || c.topic === "stakes") && !c.direction) {
      ctx.addIssue({ code: "custom", message: "sem direction" });
    }
    // Desfalque e rodízio são de um time só: "both" não tem lado pra conferir.
    if ((c.topic === "absence" || c.topic === "rotation") && c.team === "both") {
      ctx.addIssue({ code: "custom", message: `${c.topic} com team both` });
    }
  });
export type Claim = z.infer<typeof ClaimSchema>;

export const CLAIM_STATUSES = ["confirmed", "contradicted", "unverifiable"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

// Força do sinal que uma afirmação manda pro fator do JEV (lib/user-palpite/evidence.ts):
// "confirmed" = o dado é nosso (e já estava no state que o JEV julgou); "unverified" =
// o dado é do usuário (não conferido, ou conferido mas com o papel dito por ele).
export const SIGNAL_STRENGTHS = ["confirmed", "unverified"] as const;
export type SignalStrength = (typeof SIGNAL_STRENGTHS)[number];

const questionIdSchema = z.enum(
  JUDGMENT_QUESTION_IDS as [JudgmentQuestionId, ...JudgmentQuestionId[]],
);
const sideSchema = z.enum(["home", "away"]);

export type ClaimSignal = { questionId: JudgmentQuestionId; strength: SignalStrength };
export type ClaimSideCheck = { side: TeamSide; status: ClaimStatus };
// Resultado por jogador de uma afirmação de desfalque. O nome é o que o USUÁRIO
// digitou; fica só no registro dele e nunca vai ao narrador.
export type PlayerCheck = {
  name: string;
  status: ClaimStatus;
  questionId: JudgmentQuestionId | null;
};

export type CheckedClaim = Claim & {
  index: number;
  status: ClaimStatus;
  // PT-BR, cita o dado; nunca nome de jogador (nem do provider, nem do usuário).
  evidence: string;
  sides: ClaimSideCheck[];
  playerChecks: PlayerCheck[];
  signals: ClaimSignal[];
};

const checkedClaimSchema = z.object({
  team: z.enum(CLAIM_TEAMS),
  topic: z.enum(CLAIM_TOPICS),
  text: z.string(),
  players: z.array(z.string()).optional(),
  role: z.enum(CLAIM_ROLES).optional(),
  direction: z.enum(CLAIM_DIRECTIONS).optional(),
  scope: z.enum(CLAIM_SCOPES).optional(),
  index: z.number().int().nonnegative(),
  status: z.enum(CLAIM_STATUSES),
  evidence: z.string(),
  sides: z.array(z.object({ side: sideSchema, status: z.enum(CLAIM_STATUSES) })),
  playerChecks: z.array(
    z.object({
      name: z.string(),
      status: z.enum(CLAIM_STATUSES),
      questionId: questionIdSchema.nullable(),
    }),
  ),
  signals: z.array(
    z.object({ questionId: questionIdSchema, strength: z.enum(SIGNAL_STRENGTHS) }),
  ),
});
export const StoredClaimsSchema: z.ZodType<CheckedClaim[]> = z.array(
  checkedClaimSchema,
);

// ─── Leitura do modelo ──────────────────────────────────────────────────────

const pp = z.number().finite();
const scoreCellSchema = z.object({
  home: z.number().int().nonnegative(),
  away: z.number().int().nonnegative(),
  pct: pp,
});

// Percentuais em pontos percentuais (0..100, 2 casas).
export const ReadingSchema = z.object({
  palpitePct: pp,
  resultPct: pp,
  scoreRank: z.number().int().positive().nullable(),
  oneXTwo: z.object({ home: pp, draw: pp, away: pp }),
  topScorelines: z.array(scoreCellSchema),
  topWithinResult: z.array(scoreCellSchema),
  lambdaHome: pp,
  lambdaAway: pp,
});
export type PalpiteReading = z.infer<typeof ReadingSchema>;

export const StoredReadingSchema = z.object({
  without: ReadingSchema,
  with: ReadingSchema,
});
export type StoredReading = z.infer<typeof StoredReadingSchema>;

// ─── Narração ───────────────────────────────────────────────────────────────

export const PALPITE_VERDICTS = ["concordo", "discordo", "em_parte"] as const;
export type PalpiteVerdict = (typeof PALPITE_VERDICTS)[number];

export const PalpiteNarrationSchema = z
  .object({
    veredito: z.enum(PALPITE_VERDICTS),
    resumo: z.string().trim().min(1).max(400),
    pontos: z.array(z.string().trim().min(1).max(160)).max(4),
    discordancias: z
      .array(
        z
          .object({
            claimIndex: z.number().int().min(0).max(MAX_CLAIMS - 1),
            texto: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .max(MAX_CLAIMS),
  })
  .strict();
export type PalpiteNarration = z.infer<typeof PalpiteNarrationSchema>;

// O veredito que vale na tela é o do código (codeVerdict); o do LLM fica pra auditoria.
export type StoredNarration = PalpiteNarration & {
  codeVerdict: PalpiteVerdict;
  warnings: string[];
};
export const StoredNarrationSchema: z.ZodType<StoredNarration> = z.object({
  codeVerdict: z.enum(PALPITE_VERDICTS),
  veredito: z.enum(PALPITE_VERDICTS),
  resumo: z.string(),
  pontos: z.array(z.string()),
  discordancias: z.array(z.object({ claimIndex: z.number().int(), texto: z.string() })),
  warnings: z.array(z.string()),
});

// ─── Modelo gravado ─────────────────────────────────────────────────────────

export type UserEvidence = Partial<Record<JudgmentQuestionId, number>>;

const judgmentSchema = z.object({ value: z.number(), confidence: z.number().nullable() });
const judgmentAnswersSchema = z.object(
  Object.fromEntries(JUDGMENT_QUESTION_IDS.map((id) => [id, judgmentSchema])) as Record<
    JudgmentQuestionId,
    typeof judgmentSchema
  >,
) as unknown as z.ZodType<JudgmentAnswers>;

const lambdaPairSchema = z.object({ home: pp, away: pp });
const lambdaMultipliersSchema = z.object({
  factors: z.partialRecord(questionIdSchema, z.number()),
  product: z.number(),
  applied: z.number(),
});

export type StoredPalpiteModel = {
  origin: "snapshot" | "live";
  snapshotId: string | null;
  source: "dixon_coles" | "heuristic";
  degraded: boolean;
  staleBase: boolean;
  rho: number | null;
  lambdaBase: { home: number; away: number };
  lambdaWithout: { home: number; away: number };
  lambdaWith: { home: number; away: number };
  jevApplied: boolean;
  jevAnswers: JudgmentAnswers | null;
  userEvidence: UserEvidence;
  combinedAnswers: JudgmentAnswers | null;
  multipliersWith: {
    home: { factors: Partial<Record<JudgmentQuestionId, number>>; product: number; applied: number };
    away: { factors: Partial<Record<JudgmentQuestionId, number>>; product: number; applied: number };
  } | null;
  modelLabel: string;
  versions: {
    matchModel: string | null;
    judgments: string;
    weights: string;
    snapshotWeights: string | null;
    userEvidence: string;
    verdict: string;
    extract: string;
    narrate: string;
  };
};

export const StoredModelSchema: z.ZodType<StoredPalpiteModel> = z.object({
  origin: z.enum(["snapshot", "live"]),
  snapshotId: z.string().nullable(),
  source: z.enum(["dixon_coles", "heuristic"]),
  degraded: z.boolean(),
  staleBase: z.boolean(),
  rho: z.number().nullable(),
  lambdaBase: lambdaPairSchema,
  lambdaWithout: lambdaPairSchema,
  lambdaWith: lambdaPairSchema,
  jevApplied: z.boolean(),
  jevAnswers: judgmentAnswersSchema.nullable(),
  userEvidence: z.partialRecord(questionIdSchema, z.number()),
  combinedAnswers: judgmentAnswersSchema.nullable(),
  multipliersWith: z
    .object({ home: lambdaMultipliersSchema, away: lambdaMultipliersSchema })
    .nullable(),
  modelLabel: z.string(),
  versions: z.object({
    matchModel: z.string().nullable(),
    judgments: z.string(),
    weights: z.string(),
    snapshotWeights: z.string().nullable(),
    userEvidence: z.string(),
    verdict: z.string(),
    extract: z.string(),
    narrate: z.string(),
  }),
});

export const PALPITE_SOURCES = ["buttons"] as const;
export type PalpiteSource = (typeof PALPITE_SOURCES)[number];
export const NARRATION_SOURCES = ["llm", "template"] as const;
export type NarrationSource = (typeof NARRATION_SOURCES)[number];

// ─── Contexto extra da análise com IA (#565) ─────────────────────────────────

// Afirmação conferida SEM texto livre e SEM nome de jogador: é o que vai pra
// `predictions.judgments.userContext`, que fica depois da exclusão de conta (ADR 0046).
// A tela descreve a afirmação pelos campos tipados (claimDescription).
export type StoredContextClaim = Omit<CheckedClaim, "text" | "players" | "playerChecks"> & {
  playersCount?: number;
  playerChecks: { status: ClaimStatus; questionId: JudgmentQuestionId | null }[];
};

export type PredictionUserContext = {
  claims: StoredContextClaim[];
  // Nouls por pergunta que entraram no combine (evidenceFromClaims). JEV ∨ isto = o
  // que o motor aplicou; as respostas do JEV seguem sozinhas em `judgments.answers`.
  evidence: UserEvidence;
  extractionAiCallId: string | null;
  warnings: string[];
  versions: { userEvidence: string; extract: string };
};

export const StoredContextClaimSchema: z.ZodType<StoredContextClaim> = z.object({
  team: z.enum(CLAIM_TEAMS),
  topic: z.enum(CLAIM_TOPICS),
  role: z.enum(CLAIM_ROLES).optional(),
  direction: z.enum(CLAIM_DIRECTIONS).optional(),
  scope: z.enum(CLAIM_SCOPES).optional(),
  playersCount: z.number().int().nonnegative().optional(),
  index: z.number().int().nonnegative(),
  status: z.enum(CLAIM_STATUSES),
  evidence: z.string(),
  sides: z.array(z.object({ side: sideSchema, status: z.enum(CLAIM_STATUSES) })),
  playerChecks: z.array(
    z.object({ status: z.enum(CLAIM_STATUSES), questionId: questionIdSchema.nullable() }),
  ),
  signals: z.array(
    z.object({ questionId: questionIdSchema, strength: z.enum(SIGNAL_STRENGTHS) }),
  ),
});

export const PredictionUserContextSchema: z.ZodType<PredictionUserContext> = z.object({
  claims: z.array(StoredContextClaimSchema).max(MAX_CLAIMS),
  evidence: z.partialRecord(questionIdSchema, z.number()),
  extractionAiCallId: z.string().nullable(),
  warnings: z.array(z.string()),
  versions: z.object({ userEvidence: z.string(), extract: z.string() }),
});

// ─── Input da server action ─────────────────────────────────────────────────

/**
 * O navegador manda o textarea com CRLF, mas o contador do cliente conta LF (o `value`
 * do DOM): normaliza antes de medir, pra os dois lados contarem igual.
 */
export function normalizeReasonText(v: unknown): unknown {
  return typeof v === "string" ? v.replace(/\r\n?/g, "\n") : v;
}

// O palpite vem SEMPRE dos botões (o form só habilita o envio com palpite escolhido).
export const AnalyzeUserPalpiteInputSchema = z
  .object({
    matchId: z.uuid(),
    palpite: UserPalpiteSchema,
    reason: z.preprocess(
      normalizeReasonText,
      z.string().trim().min(MIN_REASON_CHARS).max(MAX_REASON_CHARS),
    ),
  })
  .strict();
export type AnalyzeUserPalpiteInput = z.infer<typeof AnalyzeUserPalpiteInputSchema>;
