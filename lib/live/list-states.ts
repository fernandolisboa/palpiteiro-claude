import { getEnableLiveMode } from "@/lib/db/queries/ai-config";
import {
  getInPlayStatesForMatches,
  type InPlayState,
} from "@/lib/live/in-play-state";

// Placar ao vivo das listas (/jogos, /time/[team]; #580, PLAN-580 §13). SÓ lê as rows
// de `match_live_states` que a página do jogo (ou as actions) já gravaram: as listas
// nunca buscam no provider (uma visita à home não pode gastar quota por jogo). A idade
// é cortada na view (`toLiveScoreView`, até 10 min). Flag desligada, nenhum jogo já
// apitado ou falha de leitura → mapa vazio (a lista fica como hoje).

export type ListLiveMatch = {
  id: string;
  kickoffAt: Date;
  status: string;
};

export async function loadListInPlayStates(
  matches: readonly ListLiveMatch[],
  now: Date
): Promise<Map<string, InPlayState>> {
  const ids = matches
    .filter(
      (m) =>
        (m.status === "scheduled" || m.status === "live") &&
        m.kickoffAt.getTime() <= now.getTime()
    )
    .map((m) => m.id);
  if (ids.length === 0) return new Map();
  try {
    if (!(await getEnableLiveMode())) return new Map();
    return await getInPlayStatesForMatches(ids, { now });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "live_list_states",
        error: "read_failed",
        message: err instanceof Error ? err.message : String(err),
      })
    );
    return new Map();
  }
}
