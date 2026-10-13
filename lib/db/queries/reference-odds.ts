import type { ReferenceMarket } from "@/lib/bets/evaluate-slip";
import { referenceKey, SLIP_TOTAL_LINES } from "@/lib/bets/slip-markets";
import { getLatestSelectionOddsSnapshotsForMatches } from "@/lib/db/queries/odds-snapshots";

// Odds de referência do cupom (Fase 2, #556): a última captura COMPLETA de cada
// mercado que o cupom liga a uma perna. SÓ leitura de selection_odds_snapshots — nunca
// chama a Odds API (o prewarm-odds e a página já compram o que existe). BTTS, dupla
// chance e linhas extras só existem quando alguma análise já buscou o evento.
// Best-effort: mercado que falha ou não tem captura simplesmente fica de fora.

const READS: ReadonlyArray<{
  dbMarketKey: "match_result" | "double_chance" | "btts" | "over_under";
  line: number | null;
}> = [
  { dbMarketKey: "match_result", line: null },
  { dbMarketKey: "double_chance", line: null },
  { dbMarketKey: "btts", line: null },
  ...SLIP_TOTAL_LINES.map((line) => ({ dbMarketKey: "over_under" as const, line })),
];

// Captura mais velha que isso não serve de referência: o edge "contra o mercado" seria
// contra um preço que já mudou. A página renova 1X2 e over/under 2.5 a cada visita
// (janela por tempo até o jogo); o resto envelhece até a próxima análise.
export const REFERENCE_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export async function getReferenceOddsForMatch(
  matchId: string,
  now: Date = new Date(),
): Promise<Map<string, ReferenceMarket>> {
  const results = await Promise.all(
    READS.map(async (r) => {
      try {
        const map = await getLatestSelectionOddsSnapshotsForMatches(
          [matchId],
          r.dbMarketKey,
          r.line === null ? undefined : { line: r.line },
        );
        const snap = map.get(matchId);
        if (!snap) return null;
        if (now.getTime() - snap.capturedAt.getTime() > REFERENCE_MAX_AGE_MS) {
          return null;
        }
        const odds: Record<string, number> = {};
        for (const s of snap.selections) odds[s.key] = Number(s.odd);
        const market: ReferenceMarket = {
          bookmaker: snap.bookmaker,
          capturedAt: snap.capturedAt,
          odds,
        };
        return [referenceKey(r), market] as const;
      } catch (err) {
        console.error(
          JSON.stringify({
            scope: "reference-odds",
            error: "read_failed",
            matchId,
            market: referenceKey(r),
            message: err instanceof Error ? err.message : String(err),
          }),
        );
        return null;
      }
    }),
  );
  return new Map(results.filter((r) => r !== null));
}
