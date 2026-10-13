"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { auth } from "@/auth";
import { aiCalls } from "@/db/schema";
import { latestAnalysisByMarket } from "@/lib/bets/analysis-probs";
import { evaluateSlip, type EvaluatedLeg } from "@/lib/bets/evaluate-slip";
import { parseSlipPayload, type SlipValidationError } from "@/lib/bets/slip-schema";
import { resolveSlipModel } from "@/lib/bets/slip-model";
import { isEmailAllowed } from "@/lib/auth/whitelist";
import { db } from "@/lib/db";
import { getMatchById } from "@/lib/db/queries/matches";
import { getPredictionHistoryForMatch } from "@/lib/db/queries/predictions";
import { getReferenceOddsForMatch } from "@/lib/db/queries/reference-odds";
import {
  insertBetSlipsBatch,
  type NewBetLeg,
  type NewBetSlip,
} from "@/lib/db/queries/user-bets";
import { getUserAccessState } from "@/lib/db/queries/users";
import { checkBetSlipsRateLimit } from "@/lib/rate-limit";
import {
  deriveBetLegSettleable,
  type BetLegKind,
} from "@/lib/settlement/rules/user-bet-dispatch";
import { toSlipEvaluationView, type SlipEvaluationView } from "@/lib/view/bet-slip";

import { notAnalyzableMessage } from "./not-analyzable";

// Registro das apostas do usuário (Fase 2, #556). O cupom manda as pernas que ele
// escolheu na grade (ou que o atalho "digite sua aposta" preencheu); aqui elas são
// re-validadas (Zod fail-closed), avaliadas EM CÓDIGO (evaluateSlip: sem LLM, sem
// limite de análises, sem Odds API) e gravadas congeladas. "Simples" = um slip por
// perna; "Combinada" = um slip com todas as pernas e a conjunta da matriz.

export type RegisterBetSlipResult =
  | { ok: true; registered: number; evaluation: SlipEvaluationView }
  | {
      ok: false;
      error: string;
      kind?: "slip-invalido" | "nao-analisavel" | "limite-de-slips";
    };

const INVALID_COPY: Record<SlipValidationError, string> = {
  payload: "Apostas inválidas. Confira as odds (maiores que 1) e os stakes.",
  perna: "Uma das apostas está inválida. Remova e escolha de novo.",
  "combinada-curta": "A combinada precisa de pelo menos 2 seleções.",
  "combinada-longa": "A combinada aceita no máximo 4 seleções.",
  "perna-repetida": "A mesma seleção apareceu duas vezes.",
};

function toNewLeg(leg: EvaluatedLeg): NewBetLeg {
  const base = {
    kind: leg.kind as BetLegKind,
    params: leg.params,
    userOdd: leg.userOdd,
    settleable: deriveBetLegSettleable(leg.kind as BetLegKind),
    stakeUnits: leg.stakeUnits,
  };
  if (leg.status !== "graded") {
    return {
      ...base,
      modelProbPct: null,
      gradeSource: "none",
      gradeStatus: leg.status,
      pinnedPredictionId: null,
    };
  }
  return {
    ...base,
    modelProbPct: leg.modelProbPct,
    // "cartridge" = o número veio da análise daquele mercado (pinnedPredictionId);
    // "scoreline_model" = modelo de placar, com o motor gravado em modelSource.
    gradeSource: leg.origin === "analysis" ? "cartridge" : "scoreline_model",
    gradeStatus: "graded",
    pinnedPredictionId: leg.predictionId,
    modelSource: leg.source,
    referenceOdd: leg.reference?.odd ?? null,
    marketImpliedPct: leg.reference?.impliedPct ?? null,
    suggestedStakeUnits: leg.suggestedStake?.units ?? null,
  };
}

export async function registerBetSlip(
  _prev: RegisterBetSlipResult | null,
  formData: FormData,
): Promise<RegisterBetSlipResult> {
  // 1. Contrato fail-closed: o payload do cliente é o ÚNICO input.
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(String(formData.get("slip") ?? ""));
  } catch {
    return { ok: false, error: INVALID_COPY.payload, kind: "slip-invalido" };
  }
  const parsed = parseSlipPayload(rawJson);
  if (!parsed.ok) {
    return { ok: false, error: INVALID_COPY[parsed.error], kind: "slip-invalido" };
  }
  const slip = parsed.slip;

  // 2. auth + acesso.
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Faça login para registrar apostas." };
  }
  const userId = session.user.id;
  const access = await getUserAccessState(userId);
  if (!access) {
    return { ok: false, error: "Sua sessão expirou. Faça login novamente." };
  }
  if (!access.allowed && !isEmailAllowed(session.user.email)) {
    return {
      ok: false,
      error: "Seu acesso está bloqueado. Fale com o administrador.",
    };
  }

  // 3. Jogo existe e ainda não começou (mesmo gate da análise).
  const match = await getMatchById(slip.matchId);
  if (!match) return { ok: false, error: "Jogo não encontrado." };
  const notAnalyzable = notAnalyzableMessage(match.status, match.kickoffAt);
  if (notAnalyzable) {
    return { ok: false, error: notAnalyzable, kind: "nao-analisavel" };
  }

  // 4. parseAiCallId vem do cliente: só vale se a chamada é do próprio usuário (evita
  //    violar a FK e ligar o slip ao parse de outra pessoa).
  let parseAiCallId: string | null = null;
  if (slip.parseAiCallId) {
    const rows = await db
      .select({ id: aiCalls.id })
      .from(aiCalls)
      .where(and(eq(aiCalls.id, slip.parseAiCallId), eq(aiCalls.userId, userId)))
      .limit(1);
    parseAiCallId = rows.length > 0 ? slip.parseAiCallId : null;
  }

  // 5. Teto diário de apostas registradas, contando cada slip que será criado.
  const slipCount = slip.mode === "simples" ? slip.legs.length : 1;
  const rl = await checkBetSlipsRateLimit(userId, session.user.role, slipCount);
  if (!rl.ok) {
    return {
      ok: false,
      error:
        rl.reason === "fail-closed"
          ? "Registro de apostas indisponível no momento. Tente mais tarde."
          : "Você atingiu o limite diário de apostas registradas. Tente amanhã.",
      kind: "limite-de-slips",
    };
  }

  // 6. Modelo do jogo (porta única), odds de referência (só DB) e a sua análise por
  //    mercado, em paralelo.
  const [model, references, history] = await Promise.all([
    resolveSlipModel(match),
    getReferenceOddsForMatch(match.id),
    getPredictionHistoryForMatch(match.id, userId),
  ]);

  const evaluation = evaluateSlip({
    mode: slip.mode,
    legs: slip.legs.map((l) => ({
      kind: l.kind,
      params: l.params,
      userOdd: l.userOdd ?? null,
      stakeUnits: l.stakeUnits,
    })),
    model,
    references,
    analysis: latestAnalysisByMarket(history),
    comboUserOdd: slip.comboUserOdd,
    comboStakeUnits: slip.comboStakeUnits,
  });

  // 7. Persiste congelado, tudo numa ida (db.batch = transação no neon-http).
  const common = {
    matchId: match.id,
    userId,
    rawInput: slip.rawInput,
    parseAiCallId,
    mode: slip.mode,
  };
  const newSlips: NewBetSlip[] =
    slip.mode === "simples"
      ? evaluation.legs.map((leg) => ({
          ...common,
          comboUserOdd: null,
          jointProbPct: null,
          stakeUnits: null,
          legs: [toNewLeg(leg)],
        }))
      : [
          {
            ...common,
            comboUserOdd: slip.comboUserOdd,
            jointProbPct:
              evaluation.combo?.status === "graded"
                ? evaluation.combo.jointProbPct
                : null,
            stakeUnits: slip.comboStakeUnits,
            legs: evaluation.legs.map(toNewLeg),
          },
        ];
  await insertBetSlipsBatch(newSlips);

  revalidatePath(`/match/${match.id}`);
  revalidatePath("/apostas");
  return {
    ok: true,
    registered: newSlips.length,
    evaluation: toSlipEvaluationView(evaluation, {
      home: match.homeTeam,
      away: match.awayTeam,
    }),
  };
}
