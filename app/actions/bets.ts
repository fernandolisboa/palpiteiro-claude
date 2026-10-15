"use server";

import { z } from "zod";

import { auth } from "@/auth";
import type { BetLegParams } from "@/db/schema";
import { parseBetText } from "@/lib/ai/bet-parse/parse";
import { MAX_RAW_INPUT } from "@/lib/ai/bet-parse/schema";
import { isEmailAllowed } from "@/lib/auth/whitelist";
import { getMatchById } from "@/lib/db/queries/matches";
import { getUserAccessState } from "@/lib/db/queries/users";
import { checkBetParseRateLimit } from "@/lib/rate-limit";
import { deriveBetLegSettleable } from "@/lib/settlement/rules/user-bet-dispatch";
import { betLegLabel, SETTLE_BADGE_PT_BR } from "@/lib/view/free-bet";

import { capabilityGateMessage } from "./not-analyzable";

// "Digite sua aposta" (ADR 0036): parseBet lê o texto (1 chamada LLM, validada por Zod)
// e devolve pernas tipadas que PREENCHEM a lista do cupom (#556). Nada é registrado
// aqui: o que entra no motor de valor é EXCLUSIVAMENTE o payload re-validado por
// registerBetSlip (app/actions/bet-slip.ts).

// ── parseBet ─────────────────────────────────────────────────────────────────

export type ParsedLegChip = {
  kind: string;
  selectionLabel: string;
  params: BetLegParams;
  userOdd: number | null;
  settleable: boolean;
  settleBadge: string;
};

export type ParseBetResult =
  | {
      ok: true;
      legs: ParsedLegChip[];
      warnings: string[];
      rawInput: string;
      parseAiCallId: string | null;
      comboUserOdd: number | null;
    }
  | {
      ok: false;
      error: string;
      kind?: "rate-limited" | "parse-falhou" | "nao-analisavel" | "input-invalido";
    };

const RawInputSchema = z.string().trim().min(1).max(MAX_RAW_INPUT);

function settleBadgeFor(kind: string, settleable: boolean): string {
  if (settleable) return SETTLE_BADGE_PT_BR;
  if (kind === "corners") return "não conferimos escanteios";
  if (kind === "cards") return "não conferimos cartões por ora";
  return "não conferimos essa aposta";
}

export async function parseBet(
  _prev: ParseBetResult | null,
  formData: FormData,
): Promise<ParseBetResult> {
  const matchId = String(formData.get("matchId") ?? "");
  if (!z.uuid().safeParse(matchId).success) {
    return { ok: false, error: "Identificador de jogo inválido." };
  }
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Faça login para analisar." };
  }
  const access = await getUserAccessState(session.user.id);
  if (!access) {
    return { ok: false, error: "Sua sessão expirou. Faça login novamente." };
  }
  if (!access.allowed && !isEmailAllowed(session.user.email)) {
    return {
      ok: false,
      error: "Seu acesso está bloqueado. Fale com o administrador.",
    };
  }
  const match = await getMatchById(matchId);
  if (!match) {
    return { ok: false, error: "Jogo não encontrado." };
  }
  const notAnalyzable = capabilityGateMessage("registerBets", match);
  if (notAnalyzable) {
    return { ok: false, error: notAnalyzable, kind: "nao-analisavel" };
  }

  const raw = RawInputSchema.safeParse(formData.get("text") ?? "");
  if (!raw.success) {
    return {
      ok: false,
      error: `Escreva sua aposta em até ${MAX_RAW_INPUT} caracteres.`,
      kind: "input-invalido",
    };
  }

  const rl = await checkBetParseRateLimit(session.user.id, session.user.role);
  if (!rl.ok) {
    return {
      ok: false,
      error:
        rl.reason === "fail-closed"
          ? "Análise de apostas indisponível no momento. Tente mais tarde."
          : "Você atingiu o limite diário de análises de aposta. Tente amanhã.",
      kind: "rate-limited",
    };
  }

  const parsed = await parseBetText({
    rawInput: raw.data,
    matchId,
    userId: session.user.id,
  });
  if (!parsed.ok) {
    return {
      ok: false,
      error:
        "Não consegui entender a aposta. Tente algo como “Palmeiras 2 a 0, odd 9.00”.",
      kind: "parse-falhou",
    };
  }

  const legs: ParsedLegChip[] = parsed.legs.map((l) => {
    const settleable = deriveBetLegSettleable(l.kind);
    return {
      kind: l.kind,
      selectionLabel: betLegLabel(l.kind, l.params as Record<string, unknown>),
      params: l.params as BetLegParams,
      userOdd: l.userOdd ?? null,
      settleable,
      settleBadge: settleBadgeFor(l.kind, settleable),
    };
  });

  return {
    ok: true,
    legs,
    warnings: parsed.warnings.map((w) => w.message),
    rawInput: raw.data,
    parseAiCallId: parsed.aiCallId,
    comboUserOdd: parsed.comboUserOdd ?? null,
  };
}
