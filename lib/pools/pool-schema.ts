import { z } from "zod";

import type { BetLegParams } from "@/db/schema";
import { ExactScoreParamsSchema } from "@/lib/settlement/rules/exact_score_palpite";
import {
  BttsLegParamsSchema,
  DoubleChanceLegParamsSchema,
  MatchResultLegParamsSchema,
  OverUnderLegParamsSchema,
} from "@/lib/settlement/rules/user-bet-market";

// Contratos do bolão (#567). Módulo SEM "use server": as actions leem o FormData e
// validam aqui (fail-closed). Os params de cada aposta reusam os schemas das regras de
// settlement, então o que entra é exatamente o que a regra sabe conferir.

export const MAX_TITLE = 60;
export const MAX_BETTOR_NAME = 40;
export const MAX_ENTRIES_PER_POOL = 50;
export const MAX_SCORE_GOALS = 30;
// R$ 10.000 por pessoa: teto de sanidade, não regra de negócio.
export const MAX_ENTRY_AMOUNT_CENTS = 1_000_000;
export const POOL_TOTAL_LINES = [1.5, 2.5, 3.5] as const;

export const POOL_BET_KINDS = [
  "exact_score",
  "match_result",
  "double_chance",
  "btts",
  "over_under",
] as const;
export type PoolBetKind = (typeof POOL_BET_KINDS)[number];

export type PoolBet = { kind: PoolBetKind; params: BetLegParams };

/**
 * "10", "10,50", "R$ 1.000,50", "10.5" → centavos. Vazio → null (sem valor). NaN,
 * negativo ou acima do teto → undefined (inválido).
 */
export function parseMoneyToCents(raw: string): number | null | undefined {
  const cleaned = raw.replace(/r\$/i, "").replace(/\s/g, "");
  if (cleaned === "") return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(cleaned)) {
    return undefined;
  }
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(cleaned)
      ? cleaned.replace(/\./g, "")
      : cleaned;
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isFinite(cents) || cents <= 0 || cents > MAX_ENTRY_AMOUNT_CENTS) {
    return undefined;
  }
  return cents;
}

const optionalText = (max: number) =>
  z
    .string()
    .transform((s) => s.trim().replace(/\s+/g, " "))
    .pipe(z.string().max(max))
    .transform((s) => (s === "" ? null : s));

export const CreatePoolSchema = z.object({
  matchId: z.uuid(),
  title: optionalText(MAX_TITLE),
  entryAmountCents: z
    .string()
    .transform((s, ctx) => {
      const cents = parseMoneyToCents(s);
      if (cents === undefined) {
        ctx.addIssue({ code: "custom", message: "valor" });
        return z.NEVER;
      }
      return cents;
    }),
});
export type CreatePoolInput = z.infer<typeof CreatePoolSchema>;

// Só dígitos: "" e " " não viram 0 (z.coerce faria isso).
const GoalsSchema = z
  .string()
  .trim()
  .regex(/^\d{1,2}$/)
  .transform(Number)
  .pipe(z.number().int().min(0).max(MAX_SCORE_GOALS));

const BettorNameSchema = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(1).max(MAX_BETTOR_NAME));

/**
 * Lê a aposta do formulário. Placar exato usa `home`/`away`; os outros usam `pick`
 * (a seleção; no total de gols, "over:2.5"). Devolve null quando qualquer campo é
 * inválido.
 */
export function parsePoolBet(input: {
  kind: unknown;
  pick?: unknown;
  home?: unknown;
  away?: unknown;
}): PoolBet | null {
  const kind = z.enum(POOL_BET_KINDS).safeParse(input.kind);
  if (!kind.success) return null;
  const pick = typeof input.pick === "string" ? input.pick : "";

  switch (kind.data) {
    case "exact_score": {
      const home = GoalsSchema.safeParse(input.home);
      const away = GoalsSchema.safeParse(input.away);
      if (!home.success || !away.success) return null;
      const params = ExactScoreParamsSchema.parse({ home: home.data, away: away.data });
      return { kind: "exact_score", params };
    }
    case "match_result": {
      const p = MatchResultLegParamsSchema.safeParse({ selection: pick });
      return p.success ? { kind: "match_result", params: p.data } : null;
    }
    case "double_chance": {
      const p = DoubleChanceLegParamsSchema.safeParse({ selection: pick });
      return p.success ? { kind: "double_chance", params: p.data } : null;
    }
    case "btts": {
      const p = BttsLegParamsSchema.safeParse({ selection: pick });
      return p.success ? { kind: "btts", params: p.data } : null;
    }
    case "over_under": {
      const [selection, rawLine] = pick.split(":");
      const line = Number(rawLine);
      if (!(POOL_TOTAL_LINES as readonly number[]).includes(line)) return null;
      const p = OverUnderLegParamsSchema.safeParse({ selection, line });
      return p.success ? { kind: "over_under", params: p.data } : null;
    }
  }
}

export function parseBettorName(raw: unknown): string | null {
  const r = BettorNameSchema.safeParse(typeof raw === "string" ? raw : "");
  return r.success ? r.data : null;
}

/** Placar manual: os dois números (0–30) ou nada. */
export function parseManualScore(
  home: unknown,
  away: unknown,
): { home: number; away: number } | null {
  const h = GoalsSchema.safeParse(home);
  const a = GoalsSchema.safeParse(away);
  if (!h.success || !a.success) return null;
  return { home: h.data, away: a.data };
}
