"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/auth";
import { aiCalls, type BetLegParams } from "@/db/schema";
import { parseBetText } from "@/lib/ai/bet-parse/parse";
import {
  ConfirmedSlipSchema,
  MAX_RAW_INPUT,
  type ConfirmBetLeg,
} from "@/lib/ai/bet-parse/schema";
import { getCartridge } from "@/lib/ai/markets/registry";
import { isEmailAllowed } from "@/lib/auth/whitelist";
import {
  computeSlipJoint,
  gradeScorelineLeg,
  legToScorePredicate,
  type ScorelineKind,
} from "@/lib/bets/grade-scoreline";
import { db } from "@/lib/db";
import { getEnableOverUnderExtraLines } from "@/lib/db/queries/ai-config";
import {
  marketsForAudience,
  marketsForLeague,
} from "@/lib/db/queries/market-catalog";
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
  betLegLabel,
  toFreeBetComboView,
  toFreeBetLegView,
  SETTLE_BADGE_PT_BR,
} from "@/lib/view/free-bet";
import type {
  FreeBetComboView,
  FreeBetLegView,
  GradeMyBetView,
} from "@/lib/view/types";

import { gradeMyBet } from "./predictions";
import { notAnalyzableMessage } from "./not-analyzable";

// Actions da "aposta livre" (ADR 0036, Fase 2 #472). DUAS portas: parseBet (NL →
// pernas tipadas) e confirmBet (slip Zod fail-closed → grade roteado kind×gate →
// persiste congelado). O NL é açúcar na FRENTE do boundary fail-closed; o que entra
// no motor de valor é EXCLUSIVAMENTE o slip re-validado server-side no confirm.

// ── Roteamento kind×gate (Decisão 3) ─────────────────────────────────────────
// Kinds de MERCADO: CAMINHO A (cartucho, com edge) DENTRO do gate audiência∩liga;
// CAMINHO B (modelo, sem edge) fora do gate. Props: sempre B. cards/corners: none.
const MARKET_KINDS = new Set(["over_under", "match_result", "btts", "double_chance"]);
const NONE_KINDS = new Set(["cards", "corners"]);

// Mapa leg → (marketKey, selectionKey, line) do cartucho (CAMINHO A). selectionKeys
// batem exceto double_chance (home_draw → home_or_draw, etc.).
const DC_SELECTION: Record<string, string> = {
  home_draw: "home_or_draw",
  home_away: "home_or_away",
  draw_away: "away_or_draw",
};
// Espelha o gate de linha-modelável do gradeMyBet (predictions.ts §8): over/under só
// modela {2.5} ∪ candidateLines (quando a variante multi-linha resolve pra a liga).
// PRECISA bater com aquele gate — assim, quando decidimos "modelável", uma resposta
// nao-avalio de gradeMyBet só pode ser PÓS-gasto (nunca a queda pré-gasto da linha),
// e o fallback A→terminal (nunca B) fica correto (Decisão 3).
async function isMarketLegModelable(
  kind: string,
  params: Record<string, unknown>,
  league: string,
): Promise<boolean> {
  if (kind !== "over_under") return true; // 1X2/btts/dupla chance não têm gate de linha
  const line = Number(params.line);
  const flagEnabled = await getEnableOverUnderExtraLines();
  const d = getCartridge("over_under", { extraLines: flagEnabled }).descriptor;
  const extraLines =
    flagEnabled &&
    d.candidateLines !== undefined &&
    (d.coveredLeagues === undefined ||
      d.coveredLeagues.some((l) => l === league));
  const modelable = new Set<number>([2.5]);
  if (extraLines && d.candidateLines) for (const l of d.candidateLines) modelable.add(l);
  return modelable.has(line);
}

function toMarketPin(
  kind: string,
  params: Record<string, unknown>,
): { marketKey: string; selectionKey: string; line?: number } | null {
  switch (kind) {
    case "over_under":
      return {
        marketKey: "over_under",
        selectionKey: String(params.selection),
        line: Number(params.line),
      };
    case "match_result":
      return { marketKey: "match_result", selectionKey: String(params.selection) };
    case "btts":
      return { marketKey: "btts", selectionKey: String(params.selection) };
    case "double_chance":
      return {
        marketKey: "double_chance",
        selectionKey: DC_SELECTION[String(params.selection)],
      };
    default:
      return null;
  }
}

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
  const notAnalyzable = notAnalyzableMessage(match.status, match.kickoffAt);
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

// ── confirmBet ───────────────────────────────────────────────────────────────

// View por perna no resultado do confirm — roteada pela fonte do grade.
export type ConfirmLegView =
  | { route: "cartridge"; view: GradeMyBetView } // CAMINHO A (com edge)
  | { route: "model"; view: FreeBetLegView } // CAMINHO B (modelo, sem edge)
  | { route: "none"; selectionLabel: string; message: string } // cards/corners
  | { route: "rate_limited"; selectionLabel: string }; // slot esgotado mid-slip

export type ConfirmBetResult =
  | { ok: true; legs: ConfirmLegView[]; combo: FreeBetComboView | null }
  | {
      ok: false;
      error: string;
      kind?:
        | "rate-limited"
        | "slip-invalido"
        | "nao-analisavel"
        | "limite-de-slips";
    };

type LegContext = {
  matchId: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  neutral: boolean;
  standing: NormalizedStanding | undefined;
  allowedMarketKeys: ReadonlySet<string>;
};

async function processLeg(
  leg: ConfirmBetLeg,
  ctx: LegContext,
): Promise<{ newLeg: NewBetLeg; view: ConfirmLegView }> {
  const params = leg.params as Record<string, unknown>;
  const label = betLegLabel(leg.kind, params);
  const settleable = deriveBetLegSettleable(leg.kind);
  const userOdd = leg.userOdd ?? null;
  const base = {
    kind: leg.kind,
    params: leg.params as BetLegParams,
    userOdd,
    settleable,
    pinnedPredictionId: null,
  };

  // NONE: cards/corners aceitas-não-gradeadas (Decisão 3).
  if (NONE_KINDS.has(leg.kind)) {
    return {
      newLeg: {
        ...base,
        modelProbPct: null,
        gradeSource: "none",
        gradeStatus: "not_covered",
      },
      view: {
        route: "none",
        selectionLabel: label,
        message:
          leg.kind === "corners"
            ? "Registramos sua aposta, mas não avaliamos escanteios como número."
            : "Registramos sua aposta, mas não avaliamos cartões como número por ora.",
      },
    };
  }

  // CAMINHO A vs B (Decisão 3): kind de mercado DENTRO do gate audiência∩liga, com odd
  // E linha modelável → A (cartucho). Se o mercado está fora do gate, a linha está fora
  // da escada, OU não há odd → é queda PRÉ-gasto legítima → CAMINHO B. Mas uma vez
  // DENTRO do gate modelável, A é o ÚNICO caminho: falha transiente / MISS pós-predict
  // NUNCA rebaixa pra B (landmine "dois números pra mesma linha") — vira terminal no_data.
  if (
    MARKET_KINDS.has(leg.kind) &&
    ctx.allowedMarketKeys.has(leg.kind) &&
    userOdd !== null &&
    (await isMarketLegModelable(leg.kind, params, ctx.league))
  ) {
    const pin = toMarketPin(leg.kind, params);
    if (pin) {
      const fd = new FormData();
      fd.set("matchId", ctx.matchId);
      fd.set("marketKey", pin.marketKey);
      fd.set("selectionKey", pin.selectionKey);
      if (pin.line !== undefined) fd.set("line", String(pin.line));
      fd.set("odd", String(userOdd));
      const res = await gradeMyBet(null, fd);
      if (
        res.ok &&
        (res.view.kind === "grade-coberto" ||
          res.view.kind === "degradado-sem-snapshot")
      ) {
        const gradeStatus =
          res.view.kind === "degradado-sem-snapshot"
            ? "degraded_no_snapshot"
            : "graded";
        return {
          newLeg: {
            ...base,
            modelProbPct: res.view.modelProbPct,
            gradeSource: "cartridge",
            gradeStatus,
          },
          view: { route: "cartridge", view: res.view },
        };
      }
      if (!res.ok && res.kind === "rate-limited") {
        // Slot de análise esgotado mid-slip: perna sem número, sem rollback (Decisão 8b).
        return {
          newLeg: {
            ...base,
            modelProbPct: null,
            gradeSource: "none",
            gradeStatus: "rate_limited",
          },
          view: { route: "rate_limited", selectionLabel: label },
        };
      }
      // TERMINAL (Decisão 3): dentro do gate modelável, qualquer outra resposta —
      // PredictError, erro inesperado, ou MISS pós-predict (nao-avalio já GASTO) —
      // NUNCA vira número de modelo. Fica sem número, honesto.
      return {
        newLeg: {
          ...base,
          modelProbPct: null,
          gradeSource: "none",
          gradeStatus: "no_data",
        },
        view: {
          route: "model",
          view: toFreeBetLegView({
            status: "no_data",
            selectionLabel: label,
            reason:
              "Não consegui avaliar esta aposta agora (análise indisponível). Tente de novo em instantes.",
          }),
        },
      };
    }
  }

  // CAMINHO B: modelo de placar (props sempre; mercado fora do gate; line fora da escada).
  const grade = gradeScorelineLeg({
    standing: ctx.standing,
    homeTeam: ctx.homeTeam,
    awayTeam: ctx.awayTeam,
    neutral: ctx.neutral,
    kind: leg.kind as ScorelineKind,
    params: leg.params as BetLegParams,
  });
  if (grade.status === "no_data") {
    return {
      newLeg: {
        ...base,
        modelProbPct: null,
        gradeSource: "none",
        gradeStatus: "no_data",
      },
      view: {
        route: "model",
        view: toFreeBetLegView({
          status: "no_data",
          selectionLabel: label,
          reason:
            "Não avalio essa aposta agora — sem tabela de classificação pra estimar o placar.",
        }),
      },
    };
  }
  return {
    newLeg: {
      ...base,
      modelProbPct: grade.modelProbPct,
      gradeSource: "scoreline_model",
      gradeStatus: "graded",
    },
    view: {
      route: "model",
      view: toFreeBetLegView({
        status: "graded",
        selectionLabel: label,
        modelProbPct: grade.modelProbPct,
        degradedData: grade.degradedData,
        userOdd,
      }),
    },
  };
}

// ── Combinada same-game via joint-sum (Decisão 4) ────────────────────────────
// Só computa quando o slip tem ≥2 pernas E TODAS mapeiam predicado de placar (fora
// da matriz = 1º tempo/first_to_score/cards/corners → null) E TODAS foram gradeadas
// (número real). Qualquer perna fora/sem-grade OU standings indisponível → "combinada
// não avaliada" (NUNCA precifica um combo diferente do apostado). Devolve a view +
// jointProbPct pra persistir (congelado). O joint e as marginais saem da MESMA matriz
// (computeSlipJoint) — coerência de tela garantida (joint ≤ min das marginais Poisson).
function buildCombo(
  legs: ConfirmBetLeg[],
  processed: NewBetLeg[],
  ctx: LegContext,
  comboUserOdd: number | null,
): { view: FreeBetComboView | null; jointProbPct: number | null } {
  if (legs.length < 2) return { view: null, jointProbPct: null };

  const naoAvaliada = (reason: string) => ({
    view: toFreeBetComboView({ status: "nao-avaliada", reason }),
    jointProbPct: null,
  });

  const allInMatrix = legs.every(
    (l) => legToScorePredicate(l.kind, l.params as BetLegParams) !== null,
  );
  const allGraded = processed.every(
    (p) =>
      p.gradeStatus === "graded" || p.gradeStatus === "degraded_no_snapshot",
  );
  if (!allInMatrix || !allGraded) {
    return naoAvaliada(
      "Não avaliamos esta combinada: tem perna fora do modelo de placar (1º tempo, quem marca primeiro, cartões ou escanteios) ou que não consegui avaliar agora. As pernas aparecem individualmente acima.",
    );
  }

  const joint = computeSlipJoint({
    standing: ctx.standing,
    homeTeam: ctx.homeTeam,
    awayTeam: ctx.awayTeam,
    neutral: ctx.neutral,
    legs: legs.map((l) => ({
      kind: l.kind,
      params: l.params as BetLegParams,
    })),
  });
  if (joint === null) {
    return naoAvaliada(
      "Não consegui avaliar a combinada agora — sem tabela de classificação pra estimar o placar.",
    );
  }

  return {
    view: toFreeBetComboView({
      status: "combinada",
      jointProbPct: joint.jointProbPct,
      degradedData: joint.degradedData,
      legs: legs.map((l, i) => ({
        selectionLabel: betLegLabel(l.kind, l.params as Record<string, unknown>),
        marginalPct: joint.marginalsPct[i],
      })),
      comboUserOdd,
    }),
    jointProbPct: joint.jointProbPct,
  };
}

export async function confirmBet(
  _prev: ConfirmBetResult | null,
  formData: FormData,
): Promise<ConfirmBetResult> {
  // 1. Boundary Zod fail-closed: o slip confirmado é o ÚNICO contrato (Decisão 1).
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

  // 4. parseAiCallId (do cliente não-confiável): coalesce pra null se não existir/não
  //    for do usuário — evita violar a FK e um 500.
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

  // 5. Limiter de criação de slips ANTES de gastar (writes + getStandings + possível
  //    predict do CAMINHO A). Fail-closed pra não-admin (Decisão 8f).
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

  // 6. Gate audiência∩liga (mesmo de gradeMyBet) → decide A vs B por perna de mercado.
  const isAdmin = session.user.role === "admin";
  const allowedMarketKeys = new Set(
    marketsForLeague(await marketsForAudience(isAdmin), match.league).map(
      (m) => m.key,
    ),
  );

  // 7. Standings UMA vez pro CAMINHO B (novo 3º call-site). Falha → undefined → no_data.
  let standing: NormalizedStanding | undefined;
  try {
    standing = await getSportsDataProvider().getStandings(match.league);
  } catch {
    standing = undefined;
  }
  const ctx: LegContext = {
    matchId: slip.matchId,
    league: match.league,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    neutral: match.league === "world_cup",
    standing,
    allowedMarketKeys,
  };

  // 8. Grade cada perna (sequencial — CAMINHO A pode gastar rate-limit/predict).
  const processed: { newLeg: NewBetLeg; view: ConfirmLegView }[] = [];
  for (const leg of slip.legs) {
    processed.push(await processLeg(leg, ctx));
  }

  // 9. Combinada same-game (Decisão 4): joint sobre a matriz do slip, congelado.
  const combo = buildCombo(
    slip.legs,
    processed.map((p) => p.newLeg),
    ctx,
    slip.comboUserOdd ?? null,
  );

  // 10. Persiste slip + pernas + joint (congelado, no confirm). Slip imutável depois.
  await insertBetSlipWithLegs({
    matchId: slip.matchId,
    userId: session.user.id,
    rawInput: slip.rawInput,
    parseAiCallId: safeParseAiCallId,
    comboUserOdd: slip.comboUserOdd ?? null,
    jointProbPct: combo.jointProbPct,
    legs: processed.map((p) => p.newLeg),
  });

  revalidatePath(`/match/${slip.matchId}`);
  return { ok: true, legs: processed.map((p) => p.view), combo: combo.view };
}
