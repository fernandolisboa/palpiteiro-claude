import { getLatestMatchModelSnapshot } from "@/lib/db/queries/match-model-snapshots";
import { toMatchModelReadingView } from "@/lib/view/match-model";
import type { MatchModelReadingView } from "@/lib/view/types";

/**
 * Loader server-side do bloco "Leitura do modelo" da página do jogo (#555, ADR 0052):
 * só a última base do jogo, do banco. Nenhuma chamada nova e nenhuma odd: a base não
 * expõe valor (backtest de calibração, PR #558), então a leitura não lê captura de odd
 * nem chama a The Odds API. Sem base ou com erro → null (estado vazio); nunca rejeita,
 * a página está em streaming.
 */
export async function loadMatchModelReading(args: {
  matchId: string;
  now: Date;
}): Promise<MatchModelReadingView | null> {
  try {
    const snapshot = await getLatestMatchModelSnapshot(args.matchId);
    return snapshot ? toMatchModelReadingView(snapshot, args.now) : null;
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "match-page",
        error: "model_reading_failed",
        matchId: args.matchId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}
