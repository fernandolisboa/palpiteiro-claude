import { z } from "zod";

import { ExactScoreParamsSchema } from "@/lib/settlement/rules/exact_score_palpite";
import { parsePtBrOdd } from "@/lib/view/grade-my-bet-input";

// Schemas do parse da "aposta livre" (ADR 0036, Decisão 2). Módulo SEM "use server"
// — importável pelo client (o form) e pelo server (parse + confirm actions). Fase 1
// (tracer #471) reconhece SÓ `exact_score`; a união é extensível na Fase 2.

// Texto NL cru capado (Decisão 1): fecha o custo pior-caso do parse E minimiza o
// rawInput persistido (LGPD). MAX_LEGS limita o blast radius de um slip (Decisão 3).
export const MAX_RAW_INPUT = 280;
export const MAX_LEGS = 4;

// Odd decimal numérica (o LLM devolve number no parse; > 1 como 0034 §7d).
const NumericOddSchema = z.number().finite().gt(1);
// Odd PT-BR string (o form devolve string; vírgula → ponto no confirm).
const PtBrOddSchema = z
  .string()
  .transform(parsePtBrOdd)
  .pipe(z.number().finite().gt(1));

// ── Lado do PARSE (o que o LLM emite) ────────────────────────────────────────
// Perna exact_score: params REUSAM o schema da regra de settlement (guard
// anti-drift Decisão 2b). `.strict()` rejeita chave extra (kind alucinado com lixo
// junto) — item inválido é DROPADO-com-aviso na validação por-item, nunca aceito.
export const ExactScoreLegSchema = z
  .object({
    kind: z.literal("exact_score"),
    params: ExactScoreParamsSchema,
    userOdd: NumericOddSchema.optional(),
  })
  .strict();

// União discriminada por kind (1 membro no tracer; a Fase 2 acrescenta os demais).
export const BetLegSchema = z.discriminatedUnion("kind", [ExactScoreLegSchema]);
export type BetLeg = z.infer<typeof BetLegSchema>;

// Envelope do tool. `legs` é array de `unknown` DE PROPÓSITO: a validação é
// POR-ITEM (safeParse individual contra BetLegSchema) — um item inválido vira aviso
// e é dropado, e o slip segue com as pernas válidas; o parse inteiro só falha se o
// envelope for malformado ou `legs` vier vazio (Decisão 2, mecânica do drop-por-perna).
export const BetParseEnvelopeSchema = z
  .object({
    legs: z.array(z.unknown()),
    comboUserOdd: NumericOddSchema.optional(),
  })
  .strict();
export type BetParseEnvelope = z.infer<typeof BetParseEnvelopeSchema>;

// ── Lado do CONFIRM (o contrato fail-closed re-validado server-side) ─────────
// O slip confirmado é a ÚNICA coisa que entra no motor de valor (Decisão 1). O
// cliente reposta as pernas confirmadas + rawInput + parseAiCallId; o servidor
// re-valida TUDO aqui. userOdd chega como string PT-BR editável do form.
export const ConfirmBetLegSchema = z
  .object({
    kind: z.literal("exact_score"),
    params: ExactScoreParamsSchema,
    userOdd: PtBrOddSchema.optional(),
  })
  .strict();
export type ConfirmBetLeg = z.infer<typeof ConfirmBetLegSchema>;

export const ConfirmedSlipSchema = z
  .object({
    matchId: z.uuid(),
    // rawInput/parseAiCallId viajam do cliente (Decisão 5); null = slip editor-only.
    rawInput: z.string().max(MAX_RAW_INPUT).nullable(),
    parseAiCallId: z.uuid().nullable(),
    legs: z.array(ConfirmBetLegSchema).min(1).max(MAX_LEGS),
    comboUserOdd: PtBrOddSchema.optional(),
  })
  .strict();
export type ConfirmedSlip = z.infer<typeof ConfirmedSlipSchema>;
