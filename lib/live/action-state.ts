import { getEnableLiveMode } from "@/lib/db/queries/ai-config";
import { IN_PLAY_ACT_MAX_AGE_MS } from "@/lib/live/freshness";
import {
  getInPlayState,
  type InPlayMatch,
  type InPlayState,
} from "@/lib/live/in-play-state";
import { matchUnavailableReason } from "@/lib/live/phase";

// Estado ao vivo relido NO SERVIDOR para uma action que registra (#580, PLAN-580 §5.2:
// "as actions nunca confiam em minuto/placar vindos do cliente"). Antes do apito não lê
// nada (o gate de pré-jogo decide sozinho, sem ida ao banco). Depois do apito, com a
// flag ligada, aceita a row de até IN_PLAY_ACT_MAX_AGE_MS (2 min); mais velha, tenta
// buscar (lease + cache de 1 min); sem sucesso, a fase sai não-acionável e a action
// recusa com "Placar ao vivo indisponível agora". Nenhum caminho daqui toca a The Odds
// API.

export type ActionLiveContext = {
  now: Date;
  /** `ai_config.enable_live_mode`; false antes do apito (não foi lido). */
  liveMode: boolean;
  state: InPlayState | null;
};

export async function loadActionLiveContext(
  match: InPlayMatch,
  now: Date = new Date()
): Promise<ActionLiveContext> {
  if (matchUnavailableReason(match.status, match.kickoffAt, now) === null) {
    return { now, liveMode: false, state: null };
  }
  // Encerrado, adiado ou cancelado no banco: o motivo de hoje vence (matchPhase).
  if (match.status !== "scheduled" && match.status !== "live") {
    return { now, liveMode: false, state: null };
  }
  const liveMode = await getEnableLiveMode();
  if (!liveMode) return { now, liveMode, state: null };
  const state = await getInPlayState(match, {
    now,
    maxAgeMs: IN_PLAY_ACT_MAX_AGE_MS,
  });
  return { now, liveMode, state };
}
