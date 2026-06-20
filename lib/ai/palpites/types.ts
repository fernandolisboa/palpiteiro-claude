import type { ZodType } from "zod";

import type { ToolDef } from "@/lib/ai/providers/types";
import type { AIModelId } from "@/lib/ai/models";
import type { DbPalpite, DbPalpiteSet } from "@/lib/db/queries/palpites";

import type { MarketAnalysisSummary } from "./synthesis-input";

// Re-export pra os tipos do cartucho resolverem sem ciclo cross-layer (lib/ai/palpites
// já importa lib/providers/sports-data; lib/providers/news é a mesma direção). ADR 0032.
export type { NewsResult } from "@/lib/providers/news/types";

// ─── Cartridge contract (disjunto do MarketCartridge) ─────────────────────────
//
// O cartucho de palpite é um tipo NOVO MENOR que MarketCartridge (ADR 0028): SEM
// descriptor/selections/selectionProbs/resolveParams/marketKey/BuildInputError —
// palpite não tem odds/edge nem gate de "dados insuficientes" (degrada para menos
// linhas, nunca throw). O `tool` é um ToolDef NEUTRO (ADR 0027).
export type PalpiteCartridge<Input = unknown, Output = unknown, Args = unknown> = {
  // "palpites_v2" (ADR 0017) → grava em ai_calls.promptVersion + palpite_sets.promptVersion.
  version: string;
  systemPrompt: string;
  tool: ToolDef;
  toolName: string;
  inputSchema: ZodType<Input>;
  outputSchema: ZodType<Output>;
  buildPredictionInput: (args: Args) => Input;
  buildUserMessage: (input: Input, ctx: { daysToKickoff: number }) => string;
};

// ─── Gerador ──────────────────────────────────────────────────────────────────

export type GeneratePalpiteArgs = {
  matchId: string;
  userId: string;
  // As N análises multi-mercado já apuradas pelo fan-out (ADR 0030 §2 / #353). É o
  // INSUMO central da síntese — a manchete deriva delas. REQUIRED (sem ela não há o
  // que sintetizar); o caller (analyzeBestBet) passa
  // summarizeAnalysesForSynthesis(outcomes).
  analyses: MarketAnalysisSummary[];
  // Default Haiku (econômico). NÃO admin-gated; NÃO cascateia preferência do usuário
  // (palpite é universal). Arg só p/ testabilidade — o caller sempre passa "claude-haiku-4-5".
  modelOverride?: AIModelId;
};

export type PalpiteGenerationResult = {
  palpiteSet: DbPalpiteSet;
  palpites: DbPalpite[];
  // NULLABLE: o log do ai_call da síntese (#353) pode falhar (aiCallId é nullable
  // em palpite_sets). O set ainda é válido. No caminho ok, é não-null.
  aiCall: { id: string } | null;
};

export class PalpiteError extends Error {
  readonly context: Record<string, unknown>;
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = "PalpiteError";
    this.context = context;
  }
}
