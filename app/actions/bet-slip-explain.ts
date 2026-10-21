"use server";

import { z } from "zod";

import { auth } from "@/auth";
import { explainBetSlipWithAI } from "@/lib/ai/bet-slip-explain/explain";
import { templatedBetExplanation } from "@/lib/ai/bet-slip-explain/fallback";
import { ANALYSES_UNAVAILABLE_MESSAGE } from "@/lib/ai/best-bet";
import { actionDeadline } from "@/lib/ai/deadline";
import { isEmailAllowed } from "@/lib/auth/whitelist";
import {
  buildBetExplainInput,
  type BetExplainInput,
} from "@/lib/bets/explain-input";
import { MAX_SLIP_SELECTIONS } from "@/lib/bets/slip-markets";
import { getEnableBetSlipExplain } from "@/lib/db/queries/ai-config";
import { getMatchModelSnapshotById } from "@/lib/db/queries/match-model-snapshots";
import { getMatchById } from "@/lib/db/queries/matches";
import { getUserBetSlipsByIds } from "@/lib/db/queries/user-bets";
import { getUserAccessState } from "@/lib/db/queries/users";
import { formatKickoffAbsolute, LEAGUE_LABEL, leagueToKey } from "@/lib/format";
import { checkPalpitesRateLimit } from "@/lib/rate-limit";
import { getRequestTimeZone } from "@/lib/server/request-timezone";
import {
  toBetSlipExplanationView,
  type BetSlipExplanationView,
} from "@/lib/view/bet-slip-explain";
import { displayMatchTeams } from "@/lib/view/team";

// "Explicar com IA" na avaliação das apostas recém-registradas (#562, ADR 0063). O
// cliente manda SÓ os ids dos slips; os números vêm das rows congeladas do registro
// (nunca do cliente, nunca reavaliando) e a base do jogo vem do id gravado no slip.
// Todos os portões grátis antes da cobrança (1 unidade do limite de palpites); depois
// dela o pedido nunca falha: LLM que falha vira o template, e uma exceção inesperada
// também. Pré-jogo só: registro ao vivo é recusado. Efêmero: nada é gravado além da
// row de ai_calls.

export type ExplainBetSlipResult =
  | { ok: true; slipIds: string[]; explanation: BetSlipExplanationView }
  | {
      ok: false;
      slipIds: string[];
      error: string;
      kind?:
        | "invalido"
        | "desligado"
        | "nao-encontrado"
        | "ao-vivo"
        | "sem-avaliacao"
        | "limite";
    };

const SlipIdsSchema = z
  .array(z.uuid())
  .min(1)
  .max(MAX_SLIP_SELECTIONS)
  .refine((ids) => new Set(ids).size === ids.length);

function parseSlipIds(formData: FormData): string[] | null {
  try {
    const parsed = SlipIdsSchema.safeParse(
      JSON.parse(String(formData.get("slipIds") ?? ""))
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const NOT_FOUND =
  "Não encontrei essas apostas. Registre de novo para pedir a explicação.";

export async function explainBetSlip(
  _prev: ExplainBetSlipResult | null,
  formData: FormData
): Promise<ExplainBetSlipResult> {
  const deadlineAt = actionDeadline();
  const slipIds = parseSlipIds(formData);
  if (!slipIds) {
    return {
      ok: false,
      slipIds: [],
      error: "Pedido inválido.",
      kind: "invalido",
    };
  }
  const refuse = (
    error: string,
    kind?: Extract<ExplainBetSlipResult, { ok: false }>["kind"]
  ) => ({ ok: false, slipIds, error, ...(kind ? { kind } : {}) }) as const;

  const session = await auth();
  if (!session?.user?.id) return refuse("Faça login para pedir a explicação.");
  const userId = session.user.id;
  const access = await getUserAccessState(userId);
  if (!access) return refuse("Sua sessão expirou. Faça login novamente.");
  if (!access.allowed && !isEmailAllowed(session.user.email)) {
    return refuse("Seu acesso está bloqueado. Fale com o administrador.");
  }
  if (!(await getEnableBetSlipExplain())) {
    return refuse(
      "A explicação com IA está desligada no momento. A avaliação acima continua valendo.",
      "desligado"
    );
  }

  // Anti-IDOR: só os slips do usuário voltam; faltou algum = não encontrado.
  const slips = await getUserBetSlipsByIds(userId, slipIds);
  if (slips.length !== slipIds.length)
    return refuse(NOT_FOUND, "nao-encontrado");
  const matchId = slips[0].matchId;
  const oneRegistration =
    slips.every((s) => s.matchId === matchId) &&
    (slips.every((s) => s.mode !== "combinada") || slips.length === 1);
  if (!oneRegistration) return refuse(NOT_FOUND, "nao-encontrado");
  if (slips.some((s) => s.isLive)) {
    return refuse(
      "A explicação com IA é só para apostas registradas antes do jogo.",
      "ao-vivo"
    );
  }
  const match = await getMatchById(matchId);
  if (!match) return refuse("Jogo não encontrado.", "nao-encontrado");

  const snapshotId = slips[0].modelSnapshotId;
  const [snapshot, timeZone] = await Promise.all([
    snapshotId ? getMatchModelSnapshotById(snapshotId) : Promise.resolve(null),
    getRequestTimeZone().catch(() => undefined),
  ]);
  const input: BetExplainInput = buildBetExplainInput({
    slips,
    teams: displayMatchTeams(
      match.homeTeam,
      match.awayTeam,
      leagueToKey(match.league)
    ),
    competition: LEAGUE_LABEL[leagueToKey(match.league)],
    kickoffLabel: formatKickoffAbsolute(match.kickoffAt, new Date(), timeZone),
    snapshot,
  });
  if (input.legs.length === 0) {
    return refuse(
      "Estas apostas ficaram sem número do modelo, então não há o que explicar.",
      "sem-avaliacao"
    );
  }

  const isAdmin = session.user.role === "admin";
  const rl = await checkPalpitesRateLimit(userId, { failClosed: !isAdmin });
  if (rl.reason === "fail-closed") return refuse(ANALYSES_UNAVAILABLE_MESSAGE);
  if (!rl.ok) {
    return refuse(
      `Você atingiu o limite de ${rl.limit} usos por dia (palpites, Seu palpite e explicações). Tente novamente amanhã.`,
      "limite"
    );
  }

  // ─── Depois da cobrança: nada daqui pra baixo falha ───
  try {
    const { explanation, source } = await explainBetSlipWithAI({
      input,
      userId,
      matchId,
      isAdmin,
      deadlineAt,
    });
    return {
      ok: true,
      slipIds,
      explanation: toBetSlipExplanationView(explanation, input, source),
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "explainBetSlip",
        matchId,
        error: "unexpected",
        message: err instanceof Error ? err.message : String(err),
      })
    );
    return {
      ok: true,
      slipIds,
      explanation: toBetSlipExplanationView(
        templatedBetExplanation(input),
        input,
        "template"
      ),
    };
  }
}
