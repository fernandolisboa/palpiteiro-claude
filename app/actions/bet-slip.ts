"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { auth } from "@/auth";
import { aiCalls } from "@/db/schema";
import { latestAnalysisByMarket } from "@/lib/bets/analysis-probs";
import {
  evaluateSlip,
  type EvaluatedLeg,
  type ReferenceOdds,
} from "@/lib/bets/evaluate-slip";
import { liveSlipRefusal } from "@/lib/bets/live-slip";
import { parseSlipPayload, type SlipValidationError } from "@/lib/bets/slip-schema";
import { resolveInPlaySlipModel, resolveSlipModel } from "@/lib/bets/slip-model";
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
import { loadActionLiveContext } from "@/lib/live/action-state";
import { matchPhase } from "@/lib/live/phase";
import { liveColumns, liveStampFromState, type LiveStamp } from "@/lib/live/stamp";
import { isInPlayScoreline } from "@/lib/quant/in-play";
import type { ModelScoreline } from "@/lib/quant/match-model";
import { checkBetSlipsRateLimit } from "@/lib/rate-limit";
import {
  deriveBetLegSettleable,
  type BetLegKind,
} from "@/lib/settlement/rules/user-bet-dispatch";
import { leagueToKey } from "@/lib/format";
import { toSlipEvaluationView, type SlipEvaluationView } from "@/lib/view/bet-slip";
import { displayMatchTeams } from "@/lib/view/team";

import { capabilityGateMessage } from "./not-analyzable";

// Registro das apostas do usuário (Fase 2, #556). O cupom manda as pernas que ele
// escolheu na grade (ou que o atalho "digite sua aposta" preencheu); aqui elas são
// re-validadas (Zod fail-closed), avaliadas EM CÓDIGO (evaluateSlip: sem LLM, sem
// limite de análises, sem Odds API) e gravadas congeladas. "Simples" = um slip por
// perna; "Combinada" = um slip com todas as pernas e a conjunta da matriz.
//
// Ao vivo (#580, PLAN-580 §9.2): o estado é relido AQUI (≤ 2 min, senão tenta buscar,
// senão recusa); só os tipos da tabela ao vivo; seleção já decidida é recusada; a
// avaliação usa o modelo em jogo, sem referência (a odd é de antes do jogo), sem análise
// salva e sem stake sugerido; o slip grava `is_live` + o carimbo do momento.

const LIVE_UNAVAILABLE_COPY =
  "Placar ao vivo indisponível agora. Tente em um minuto.";

// Página aberta antes do apito: a tabela pré-preencheu a odd de pré-jogo e não sabe o
// placar. Registrar ao vivo dali gravaria a odd de antes do jogo como a que a pessoa pegou.
const STALE_GRID_COPY =
  "O jogo começou. Atualize a página para registrar ao vivo.";

export type RegisterBetSlipResult =
  | { ok: true; registered: number; evaluation: SlipEvaluationView }
  | {
      ok: false;
      error: string;
      kind?:
        | "slip-invalido"
        | "nao-analisavel"
        | "mercado-ao-vivo"
        | "limite-de-slips"
        | "falha-ao-salvar";
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

  // 3. Jogo existe e aceita registro: antes do apito, ou ao vivo com o estado relido
  //    no servidor (nunca o minuto/placar do cliente).
  const match = await getMatchById(slip.matchId);
  if (!match) return { ok: false, error: "Jogo não encontrado." };
  const live = await loadActionLiveContext(match);
  const notAnalyzable = capabilityGateMessage("registerBets", match, {
    now: live.now,
    state: live.state,
    liveMode: live.liveMode,
  });
  if (notAnalyzable) {
    return { ok: false, error: notAnalyzable, kind: "nao-analisavel" };
  }
  const phase = matchPhase(match, live.state, live.now, {
    liveMode: live.liveMode,
  });
  // Liberado depois do apito = estado acionável (≤ 2 min, minuto conhecido).
  const liveState = phase.kind === "pre" ? null : live.state;
  if (phase.kind !== "pre" && (liveState === null || liveState.score === null)) {
    return { ok: false, error: LIVE_UNAVAILABLE_COPY, kind: "nao-analisavel" };
  }
  // O contrário (tabela ao vivo, jogo de volta ao pré-jogo no servidor) é inofensivo: o
  // caminho de pré-jogo segue igual.
  if (liveState !== null && !slip.gridLive) {
    return { ok: false, error: STALE_GRID_COPY, kind: "nao-analisavel" };
  }
  if (liveState?.score) {
    const refusal = liveSlipRefusal(slip.legs, liveState.score);
    if (refusal) return { ok: false, error: refusal, kind: "mercado-ao-vivo" };
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
          : rl.remaining > 0
            ? `Hoje você ainda pode registrar ${rl.remaining} ${rl.remaining === 1 ? "aposta" : "apostas"}. Tire algumas da lista ou use a combinada.`
            : "Você atingiu o limite diário de apostas registradas. Tente amanhã.",
      kind: "limite-de-slips",
    };
  }

  // 6. Modelo do jogo (porta única), odds de referência (só DB) e a sua análise por
  //    mercado, em paralelo. Ao vivo: só o modelo em jogo (a referência é de antes do
  //    jogo e a análise salva já está obsoleta, PLAN-580 achado 4).
  let model: ModelScoreline | null;
  let references: ReferenceOdds;
  let analysis: ReturnType<typeof latestAnalysisByMarket>;
  if (liveState) {
    model = await resolveInPlaySlipModel(match, liveState);
    references = new Map();
    analysis = new Map();
  } else {
    const [preModel, refs, history] = await Promise.all([
      resolveSlipModel(match),
      getReferenceOddsForMatch(match.id),
      getPredictionHistoryForMatch(match.id, userId),
    ]);
    model = preModel;
    references = refs;
    analysis = latestAnalysisByMarket(history);
  }

  // Carimbo do momento (lido no servidor), com as entradas do modelo quando houve.
  let stamp: LiveStamp | null = null;
  if (liveState) {
    try {
      stamp = liveStampFromState(
        liveState,
        live.now,
        model && isInPlayScoreline(model) ? model.inPlay : null,
      );
    } catch (err) {
      console.error("[registerBetSlip] carimbo ao vivo inválido", err);
      return { ok: false, error: LIVE_UNAVAILABLE_COPY, kind: "nao-analisavel" };
    }
  }

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
    analysis,
    comboUserOdd: slip.comboUserOdd,
    comboStakeUnits: slip.comboStakeUnits,
    // Ao vivo: sem banda nem Kelly (modelo em jogo sem calibração, ADR 0060).
    suggestStake: liveState === null,
  });

  // 7. Persiste congelado, tudo numa ida (db.batch = transação no neon-http).
  const common = {
    matchId: match.id,
    userId,
    rawInput: slip.rawInput,
    parseAiCallId,
    mode: slip.mode,
    ...liveColumns(stamp),
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
  try {
    await insertBetSlipsBatch(newSlips);
  } catch (err) {
    console.error("[registerBetSlip] insert falhou", err);
    return {
      ok: false,
      error: "Não consegui salvar suas apostas. Tente de novo.",
      kind: "falha-ao-salvar",
    };
  }

  revalidatePath(`/match/${match.id}`);
  revalidatePath("/apostas");
  return {
    ok: true,
    registered: newSlips.length,
    // Rótulo de tela (#578): nome curto. A avaliação já foi calculada com o canonical.
    evaluation: toSlipEvaluationView(
      evaluation,
      displayMatchTeams(match.homeTeam, match.awayTeam, leagueToKey(match.league)),
    ),
  };
}
