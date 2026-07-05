import { z } from "zod";

import type { PalpiteResultData } from "@/db/schema";
import { SettlementError } from "@/lib/settlement/schemas";

// Regras puras de settlement dos kinds de MERCADO da aposta livre (ADR 0036, Decisão
// 6a/6b) + first_half_over_under. Mesma forma das regras de palpite: `(params, resultData)
// => "won"|"lost"`, sem acoplamento de tabela, lança SettlementError em dado
// faltando/ambíguo (prefer-skip → PENDING). Os schemas de params são EXPORTADOS e
// reusados pelo boundary do parse (guard anti-drift Decisão 2b).
//
// Diferença-chave vs o domínio de PREDIÇÕES (lib/settlement/rules/over_under.ts): a
// linha do slip é GARANTIDA k+0.5 (o boundary do parse exclui linha inteira), então
// over/under é BINÁRIO sem push. Void/push não existem nas pernas de usuário.

// Linha de total k+0.5: n·2 é inteiro ÍMPAR (2.5→5 ok; 2.0→4 rejeita; 2.25→4.5 rejeita).
export const HalfLineSchema = z
  .number()
  .refine(
    (n) => Number.isInteger(n * 2) && Math.abs(n * 2) % 2 === 1,
    "linha de total deve ser meio-gol (k+0.5)",
  );

type Rule = (params: unknown, resultData: PalpiteResultData) => "won" | "lost";

function requireRegulation(resultData: PalpiteResultData): {
  home: number;
  away: number;
} {
  if (resultData.homeScore === null || resultData.awayScore === null) {
    throw new SettlementError("missing 90' score for user bet leg");
  }
  return { home: resultData.homeScore, away: resultData.awayScore };
}

function outcome1X2(home: number, away: number): "home" | "draw" | "away" {
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

// ── over_under (total do jogo, k+0.5, binário) ───────────────────────────────
export const OverUnderLegParamsSchema = z.object({
  selection: z.enum(["over", "under"]),
  line: HalfLineSchema,
});

export const settleOverUnderLeg: Rule = (params, resultData) => {
  const parsed = OverUnderLegParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new SettlementError("invalid over_under leg params", {
      issues: parsed.error.issues,
    });
  }
  requireRegulation(resultData);
  const over = resultData.totalGoals > parsed.data.line;
  const win = parsed.data.selection === "over" ? over : !over;
  return win ? "won" : "lost";
};

// ── match_result (1X2) ───────────────────────────────────────────────────────
export const MatchResultLegParamsSchema = z.object({
  selection: z.enum(["home", "draw", "away"]),
});

export const settleMatchResultLeg: Rule = (params, resultData) => {
  const parsed = MatchResultLegParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new SettlementError("invalid match_result leg params", {
      issues: parsed.error.issues,
    });
  }
  const { home, away } = requireRegulation(resultData);
  return outcome1X2(home, away) === parsed.data.selection ? "won" : "lost";
};

// ── btts (ambos marcam) ──────────────────────────────────────────────────────
export const BttsLegParamsSchema = z.object({
  selection: z.enum(["yes", "no"]),
});

export const settleBttsLeg: Rule = (params, resultData) => {
  const parsed = BttsLegParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new SettlementError("invalid btts leg params", {
      issues: parsed.error.issues,
    });
  }
  const { home, away } = requireRegulation(resultData);
  const both = home >= 1 && away >= 1;
  const win = parsed.data.selection === "yes" ? both : !both;
  return win ? "won" : "lost";
};

// ── double_chance (dupla chance) ─────────────────────────────────────────────
export const DoubleChanceLegParamsSchema = z.object({
  selection: z.enum(["home_draw", "home_away", "draw_away"]),
});

const DC_COVERS: Record<
  "home_draw" | "home_away" | "draw_away",
  ReadonlyArray<"home" | "draw" | "away">
> = {
  home_draw: ["home", "draw"],
  home_away: ["home", "away"],
  draw_away: ["draw", "away"],
};

export const settleDoubleChanceLeg: Rule = (params, resultData) => {
  const parsed = DoubleChanceLegParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new SettlementError("invalid double_chance leg params", {
      issues: parsed.error.issues,
    });
  }
  const { home, away } = requireRegulation(resultData);
  return DC_COVERS[parsed.data.selection].includes(outcome1X2(home, away))
    ? "won"
    : "lost";
};

// ── first_half_over_under (total do 1º tempo, k+0.5) ─────────────────────────
export const FirstHalfOverUnderLegParamsSchema = z.object({
  selection: z.enum(["over", "under"]),
  line: HalfLineSchema,
});

export const settleFirstHalfOverUnderLeg: Rule = (params, resultData) => {
  const parsed = FirstHalfOverUnderLegParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new SettlementError("invalid first_half_over_under leg params", {
      issues: parsed.error.issues,
    });
  }
  // Halftime ausente → PENDING (prefer-skip; irmã da regra de placar do intervalo).
  if (
    resultData.halftimeHomeScore === null ||
    resultData.halftimeHomeScore === undefined ||
    resultData.halftimeAwayScore === null ||
    resultData.halftimeAwayScore === undefined
  ) {
    throw new SettlementError("missing halftime score for first_half_over_under");
  }
  const htTotal = resultData.halftimeHomeScore + resultData.halftimeAwayScore;
  const over = htTotal > parsed.data.line;
  const win = parsed.data.selection === "over" ? over : !over;
  return win ? "won" : "lost";
};
