import { z } from "zod";

import { CleanSheetParamsSchema } from "@/lib/settlement/rules/clean_sheet_palpite";
import { ExactScoreParamsSchema } from "@/lib/settlement/rules/exact_score_palpite";
import { FirstHalfScoreParamsSchema } from "@/lib/settlement/rules/first_half_score_palpite";
import { FirstToScoreParamsSchema } from "@/lib/settlement/rules/first_to_score_palpite";
import { MarginParamsSchema } from "@/lib/settlement/rules/margin_palpite";
import {
  BttsLegParamsSchema,
  DoubleChanceLegParamsSchema,
  FirstHalfOverUnderLegParamsSchema,
  HalfLineSchema,
  MatchResultLegParamsSchema,
  OverUnderLegParamsSchema,
} from "@/lib/settlement/rules/user-bet-market";
import { parsePtBrOdd } from "@/lib/view/grade-my-bet-input";

// Schemas do parse da "aposta livre" (ADR 0036, Decisão 2). Módulo SEM "use server".
// Fase 2: união COMPLETA dos kinds. Cada `params` REUSA o schema Zod da regra de
// settlement correspondente (guard anti-drift Decisão 2b) — drift de shape entre
// boundary e regra deixaria a perna PENDING pra sempre via SettlementError.

export const MAX_RAW_INPUT = 280;
export const MAX_LEGS = 4;

const NumericOddSchema = z.number().finite().gt(1);
const PtBrOddSchema = z
  .string()
  .transform(parsePtBrOdd)
  .pipe(z.number().finite().gt(1));

// cards/corners são ACEITAS-NÃO-GRADEADAS (Decisão 3: none) — registro de intenção,
// sem grade/settlement na Fase 2. Params mínimos (linha k+0.5 como qualquer total).
export const CardsCornersParamsSchema = z.object({
  selection: z.enum(["over", "under"]),
  line: HalfLineSchema,
});

// Mapa kind → schema de params. Fonte única pros dois lados (parse/confirm).
const KIND_PARAMS = {
  exact_score: ExactScoreParamsSchema,
  margin: MarginParamsSchema,
  clean_sheet: CleanSheetParamsSchema,
  first_half_score: FirstHalfScoreParamsSchema,
  first_to_score: FirstToScoreParamsSchema,
  over_under: OverUnderLegParamsSchema,
  match_result: MatchResultLegParamsSchema,
  btts: BttsLegParamsSchema,
  double_chance: DoubleChanceLegParamsSchema,
  first_half_over_under: FirstHalfOverUnderLegParamsSchema,
  cards: CardsCornersParamsSchema,
  corners: CardsCornersParamsSchema,
} as const;

export type BetLegKindParsed = keyof typeof KIND_PARAMS;
export const PARSEABLE_KINDS = Object.keys(KIND_PARAMS) as BetLegKindParsed[];

// Membro de leg (kind + params + odd). `.strict()` rejeita chave extra (kind
// alucinado com lixo junto) — dropado-com-aviso na validação por-item.
function legMember<K extends BetLegKindParsed>(kind: K, odd: z.ZodType<number>) {
  return z
    .object({
      kind: z.literal(kind),
      params: KIND_PARAMS[kind],
      userOdd: odd.optional(),
    })
    .strict();
}

// ── Lado do PARSE (o LLM emite; odd numérica) ────────────────────────────────
export const BetLegSchema = z.discriminatedUnion("kind", [
  legMember("exact_score", NumericOddSchema),
  legMember("margin", NumericOddSchema),
  legMember("clean_sheet", NumericOddSchema),
  legMember("first_half_score", NumericOddSchema),
  legMember("first_to_score", NumericOddSchema),
  legMember("over_under", NumericOddSchema),
  legMember("match_result", NumericOddSchema),
  legMember("btts", NumericOddSchema),
  legMember("double_chance", NumericOddSchema),
  legMember("first_half_over_under", NumericOddSchema),
  legMember("cards", NumericOddSchema),
  legMember("corners", NumericOddSchema),
]);
export type BetLeg = z.infer<typeof BetLegSchema>;

// Envelope do tool. `legs` é array de `unknown` DE PROPÓSITO: validação POR-ITEM.
export const BetParseEnvelopeSchema = z
  .object({
    legs: z.array(z.unknown()),
    comboUserOdd: NumericOddSchema.optional(),
  })
  .strict();
export type BetParseEnvelope = z.infer<typeof BetParseEnvelopeSchema>;

// ── Lado do CONFIRM (contrato fail-closed; odd PT-BR string do form) ─────────
export const ConfirmBetLegSchema = z.discriminatedUnion("kind", [
  legMember("exact_score", PtBrOddSchema),
  legMember("margin", PtBrOddSchema),
  legMember("clean_sheet", PtBrOddSchema),
  legMember("first_half_score", PtBrOddSchema),
  legMember("first_to_score", PtBrOddSchema),
  legMember("over_under", PtBrOddSchema),
  legMember("match_result", PtBrOddSchema),
  legMember("btts", PtBrOddSchema),
  legMember("double_chance", PtBrOddSchema),
  legMember("first_half_over_under", PtBrOddSchema),
  legMember("cards", PtBrOddSchema),
  legMember("corners", PtBrOddSchema),
]);
export type ConfirmBetLeg = z.infer<typeof ConfirmBetLegSchema>;

export const ConfirmedSlipSchema = z
  .object({
    matchId: z.uuid(),
    rawInput: z.string().max(MAX_RAW_INPUT).nullable(),
    parseAiCallId: z.uuid().nullable(),
    legs: z.array(ConfirmBetLegSchema).min(1).max(MAX_LEGS),
    comboUserOdd: PtBrOddSchema.optional(),
  })
  .strict();
export type ConfirmedSlip = z.infer<typeof ConfirmedSlipSchema>;
