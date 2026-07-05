"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/auth";
import { aiCalls } from "@/db/schema";
import { parseBetText } from "@/lib/ai/bet-parse/parse";
import {
  ConfirmedSlipSchema,
  MAX_RAW_INPUT,
  type ConfirmBetLeg,
} from "@/lib/ai/bet-parse/schema";
import { isEmailAllowed } from "@/lib/auth/whitelist";
import { gradeExactScoreFromStandings } from "@/lib/bets/grade-exact-score";
import { db } from "@/lib/db";
import { getMatchById } from "@/lib/db/queries/matches";
import { getUserAccessState } from "@/lib/db/queries/users";
import {
  insertBetSlipWithLegs,
  type NewBetLeg,
} from "@/lib/db/queries/user-bets";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type { NormalizedStanding } from "@/lib/providers/sports-data/types";
import {
  checkBetParseRateLimit,
  checkBetSlipsRateLimit,
} from "@/lib/rate-limit";
import { deriveBetLegSettleable } from "@/lib/settlement/rules/user-bet-dispatch";
import {
  exactScoreLabel,
  toFreeBetLegView,
  SETTLE_BADGE_PT_BR,
} from "@/lib/view/free-bet";
import type { FreeBetLegView } from "@/lib/view/types";

import { notAnalyzableMessage } from "./not-analyzable";

// Actions da "aposta livre" (ADR 0036, tracer Fase 1 #471). DUAS portas:
//   parseBet   — NL → pernas tipadas (echo em chips). SEM persistência.
//   confirmBet — slip confirmado (Zod fail-closed) → grade CAMINHO B + persiste.
// O NL é açúcar na FRENTE do boundary fail-closed; o que entra no motor de valor é
// EXCLUSIVAMENTE o slip re-validado server-side no confirm (Decisão 1).

// ─── parseBet ────────────────────────────────────────────────────────────────

// Chip de perna ecoado de volta pro cliente (editável). Fase 1: só exact_score.
export type ParsedLegChip = {
  kind: "exact_score";
  selectionLabel: string;
  params: { home: number; away: number };
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
  const notAnalyzable = notAnalyzableMessage(match.status, match.kickoffAt);
  if (notAnalyzable) {
    return { ok: false, error: notAnalyzable, kind: "nao-analisavel" };
  }

  // Boundary Zod: cap ~280 chars (fecha o custo pior-caso do parse + minimiza o
  // rawInput persistido — LGPD). Rejeição com mensagem clara.
  const raw = RawInputSchema.safeParse(formData.get("text") ?? "");
  if (!raw.success) {
    return {
      ok: false,
      error: `Escreva sua aposta em até ${MAX_RAW_INPUT} caracteres.`,
      kind: "input-invalido",
    };
  }

  // Limiter próprio do parse (fail-closed pra não-admin): gatilho spammable, NÃO
  // consome os slots de análise (Decisão 8a).
  const role = session.user.role;
  const rl = await checkBetParseRateLimit(session.user.id, role);
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

  const legs: ParsedLegChip[] = parsed.legs.map((l) => ({
    kind: "exact_score",
    selectionLabel: exactScoreLabel(l.params.home, l.params.away),
    params: l.params,
    userOdd: l.userOdd ?? null,
    settleable: deriveBetLegSettleable(l.kind),
    settleBadge: SETTLE_BADGE_PT_BR,
  }));

  return {
    ok: true,
    legs,
    warnings: parsed.warnings.map((w) => w.message),
    rawInput: raw.data,
    parseAiCallId: parsed.aiCallId,
    comboUserOdd: parsed.comboUserOdd ?? null,
  };
}

// ─── confirmBet ──────────────────────────────────────────────────────────────

export type ConfirmBetResult =
  | { ok: true; legs: FreeBetLegView[] }
  | {
      ok: false;
      error: string;
      kind?:
        | "rate-limited"
        | "slip-invalido"
        | "nao-analisavel"
        | "limite-de-slips";
    };

// Grade de UMA perna exact_score pelo CAMINHO B, dado o standings já buscado.
function gradeLeg(
  leg: ConfirmBetLeg,
  standing: NormalizedStanding | undefined,
  homeTeam: string,
  awayTeam: string,
  neutral: boolean,
): { newLeg: NewBetLeg; view: FreeBetLegView } {
  const selectionLabel = exactScoreLabel(leg.params.home, leg.params.away);
  const grade = gradeExactScoreFromStandings({
    standing,
    homeTeam,
    awayTeam,
    home: leg.params.home,
    away: leg.params.away,
    neutral,
  });
  const settleable = deriveBetLegSettleable(leg.kind);
  const userOdd = leg.userOdd ?? null;

  if (grade.status === "no_data") {
    return {
      newLeg: {
        kind: leg.kind,
        params: leg.params,
        userOdd,
        modelProbPct: null,
        gradeSource: "none",
        gradeStatus: "no_data",
        settleable,
        pinnedPredictionId: null,
      },
      view: toFreeBetLegView({
        status: "no_data",
        selectionLabel,
        reason:
          "Não avalio essa aposta agora — sem tabela de classificação disponível pra estimar o placar.",
      }),
    };
  }

  return {
    newLeg: {
      kind: leg.kind,
      params: leg.params,
      userOdd,
      modelProbPct: grade.modelProbPct,
      gradeSource: "scoreline_model",
      gradeStatus: "graded",
      settleable,
      pinnedPredictionId: null,
    },
    view: toFreeBetLegView({
      status: "graded",
      selectionLabel,
      modelProbPct: grade.modelProbPct,
      degradedData: grade.degradedData,
      userOdd,
    }),
  };
}

export async function confirmBet(
  _prev: ConfirmBetResult | null,
  formData: FormData,
): Promise<ConfirmBetResult> {
  // 1. Boundary Zod fail-closed: o slip confirmado é o ÚNICO contrato (Decisão 1). O
  //    cliente reposta rawInput + parseAiCallId + pernas + odds. JSON malformado ou
  //    fora do schema → slip-invalido.
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(String(formData.get("slip") ?? ""));
  } catch {
    return { ok: false, error: "Aposta inválida.", kind: "slip-invalido" };
  }
  const parsed = ConfirmedSlipSchema.safeParse(rawJson);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Aposta inválida. Confira as pernas e a odd (> 1).",
      kind: "slip-invalido",
    };
  }
  const slip = parsed.data;

  // 2. auth + acesso.
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Faça login para confirmar." };
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
  // 3. match + analisabilidade.
  const match = await getMatchById(slip.matchId);
  if (!match) {
    return { ok: false, error: "Jogo não encontrado." };
  }
  const notAnalyzable = notAnalyzableMessage(match.status, match.kickoffAt);
  if (notAnalyzable) {
    return { ok: false, error: notAnalyzable, kind: "nao-analisavel" };
  }

  // 4. parseAiCallId (metadado de auditoria, do cliente NÃO-confiável): coalesce pra
  //    null se o uuid não existir/não for do usuário — evita violar a FK e um 500.
  let safeParseAiCallId: string | null = null;
  if (slip.parseAiCallId) {
    const rows = await db
      .select({ id: aiCalls.id })
      .from(aiCalls)
      .where(
        and(
          eq(aiCalls.id, slip.parseAiCallId),
          eq(aiCalls.userId, session.user.id),
        ),
      )
      .limit(1);
    safeParseAiCallId = rows.length > 0 ? slip.parseAiCallId : null;
  }

  // 5. Limiter de criação de slips ANTES de gastar (writes + getStandings). Fail-closed
  //    pra não-admin. Cobre também slips editor-only (Decisão 8f).
  const rl = await checkBetSlipsRateLimit(session.user.id, session.user.role);
  if (!rl.ok) {
    return {
      ok: false,
      error:
        rl.reason === "fail-closed"
          ? "Confirmação de apostas indisponível no momento. Tente mais tarde."
          : "Você atingiu o limite diário de apostas registradas. Tente amanhã.",
      kind: "limite-de-slips",
    };
  }

  // 6. Grade CAMINHO B: getStandings UMA vez (novo 3º call-site), reusado por todas
  //    as pernas. Falha do provider → undefined → no_data (prefer-skip).
  let standing: NormalizedStanding | undefined;
  try {
    standing = await getSportsDataProvider().getStandings(match.league);
  } catch {
    standing = undefined;
  }
  const neutral = match.league === "world_cup";

  const graded = slip.legs.map((leg) =>
    gradeLeg(leg, standing, match.homeTeam, match.awayTeam, neutral),
  );

  // 7. Persiste slip + pernas (congelado, no confirm). Slip imutável depois.
  await insertBetSlipWithLegs({
    matchId: slip.matchId,
    userId: session.user.id,
    rawInput: slip.rawInput,
    parseAiCallId: safeParseAiCallId,
    comboUserOdd: slip.comboUserOdd ?? null,
    legs: graded.map((g) => g.newLeg),
  });

  revalidatePath(`/match/${slip.matchId}`);

  return { ok: true, legs: graded.map((g) => g.view) };
}
