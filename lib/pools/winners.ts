import type { BetLegParams } from "@/db/schema";
import { palpiteResultDataFrom } from "@/lib/settlement/palpite-result-data";
import { settleExactScorePalpite } from "@/lib/settlement/rules/exact_score_palpite";
import type { BetLegRuleFn } from "@/lib/settlement/rules/user-bet-dispatch";
import {
  settleBttsLeg,
  settleDoubleChanceLeg,
  settleMatchResultLeg,
  settleOverUnderLeg,
} from "@/lib/settlement/rules/user-bet-market";
import type { PoolBetKind } from "@/lib/pools/pool-schema";

// Resultado do bolão (#567), puro: placar → quem acertou → divisão do pote. Confere
// cada aposta com a MESMA regra de settlement das apostas registradas, então "acertou"
// significa a mesma coisa nas duas telas.

// Mesmas funções de USER_BET_SETTLEMENT_RULES, mas total nos kinds do bolão.
const POOL_RULES: Record<PoolBetKind, BetLegRuleFn> = {
  exact_score: settleExactScorePalpite,
  match_result: settleMatchResultLeg,
  double_chance: settleDoubleChanceLeg,
  btts: settleBttsLeg,
  over_under: settleOverUnderLeg,
};

export type PoolScore = {
  home: number;
  away: number;
  source: "manual" | "jogo";
};

/**
 * Placar que fecha o bolão: o digitado à mão vence; senão o do jogo encerrado. O do
 * jogo vem do sync (`goals` do provider), que inclui a prorrogação quando houve.
 */
export function resolvePoolScore(
  pool: { manualHomeScore: number | null; manualAwayScore: number | null },
  match: { status: string; homeScore: number | null; awayScore: number | null },
): PoolScore | null {
  if (pool.manualHomeScore !== null && pool.manualAwayScore !== null) {
    return { home: pool.manualHomeScore, away: pool.manualAwayScore, source: "manual" };
  }
  if (match.status === "finished" && match.homeScore !== null && match.awayScore !== null) {
    return { home: match.homeScore, away: match.awayScore, source: "jogo" };
  }
  return null;
}

export type PoolEntryInput = { id: string; kind: string; params: BetLegParams };

export type PoolOutcome =
  | { settled: false; potCents: number | null }
  | {
      settled: true;
      score: PoolScore;
      hitIds: ReadonlySet<string>;
      winnerCount: number;
      potCents: number | null;
      // Quanto cada ganhador leva (centavos, arredondado pra baixo) e o que sobra da
      // divisão. null quando o bolão não tem valor por pessoa ou ninguém acertou.
      shareCents: number | null;
      remainderCents: number | null;
    };

export function poolPotCents(
  entryAmountCents: number | null,
  entryCount: number,
): number | null {
  return entryAmountCents === null ? null : entryAmountCents * entryCount;
}

/**
 * Acertou? Kind fora do bolão ou params que a regra rejeita (SettlementError) nunca
 * entram pelo formulário; se aparecerem, contam como não acerto em vez de derrubar a
 * página.
 */
export function entryHit(
  entry: Pick<PoolEntryInput, "kind" | "params">,
  score: Pick<PoolScore, "home" | "away">,
): boolean {
  const rule = (POOL_RULES as Partial<Record<string, BetLegRuleFn>>)[entry.kind];
  if (!rule) return false;
  try {
    return rule(entry.params, palpiteResultDataFrom(score)) === "won";
  } catch {
    return false;
  }
}

export function computePoolOutcome(input: {
  entries: readonly PoolEntryInput[];
  entryAmountCents: number | null;
  score: PoolScore | null;
}): PoolOutcome {
  const potCents = poolPotCents(input.entryAmountCents, input.entries.length);
  if (!input.score) return { settled: false, potCents };

  const score = input.score;
  const hitIds = new Set(
    input.entries.filter((e) => entryHit(e, score)).map((e) => e.id),
  );
  const winnerCount = hitIds.size;
  const canSplit = potCents !== null && potCents > 0 && winnerCount > 0;
  const shareCents = canSplit ? Math.floor(potCents / winnerCount) : null;
  return {
    settled: true,
    score,
    hitIds,
    winnerCount,
    potCents,
    shareCents,
    remainderCents:
      canSplit && shareCents !== null ? potCents - shareCents * winnerCount : null,
  };
}

/** "R$ 10,50". */
export function formatBrl(cents: number): string {
  const reais = Math.floor(cents / 100);
  const rest = (cents % 100).toString().padStart(2, "0");
  // Agrupamento à mão: não depende do ICU do runtime.
  const grouped = reais.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${grouped},${rest}`;
}
