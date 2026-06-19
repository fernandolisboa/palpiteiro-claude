/**
 * TTL externo das snapshots de odds: 30 min.
 *
 * Camada externa "vale considerar re-fetch?" acima do cache interno de
 * odds-api.ts (5-15min adaptativo). Tanto ensureOddsSnapshotsFresh quanto
 * predict() precisam concordar na MESMA definição de frescor — reuso e
 * refetch usam este único valor pra nunca discordarem (um reusa, o outro
 * refaz) pra mesma idade de snapshot.
 *
 * É também o PISO de frescor pra jogos iminentes (≤24h do kickoff) e pro
 * conjunto de captura do CLV (KO ≤90min) — ver oddsFreshnessMsForKickoff.
 */
export const ODDS_SNAPSHOT_FRESHNESS_MS = 30 * 60 * 1000;

/**
 * TTL externo MAIS LARGO pra jogos distantes (>24h do kickoff): 60 min. Odds de
 * jogos longe do KO se movem pouco; reusar uma captura de até 60min poupa fetches
 * do provider no request-path (e no cron de prewarm) sem custo de precisão real.
 */
export const ODDS_SNAPSHOT_FRESHNESS_FAR_MS = 60 * 60 * 1000;

/**
 * Cutoff de "distante": KO a mais de 24h ⇒ janela larga (FAR_MS); ≤24h ⇒ piso
 * (30min). 24h é deliberadamente MUITO acima do CLV_CAPTURE_LOOKAHEAD_MS (90min,
 * clv-window.ts): o conjunto de captura da closing line (KO ≤90min) cai SEMPRE no
 * ramo de 30min, então a janela larga NUNCA suprime o fetch de fechamento (um
 * snapshot de 31-59min seria "fresco" pela janela larga, o fetch seria pulado, e o
 * CLV degradaria silenciosamente pra ≈0). Este cutoff NUNCA pode descer abaixo de
 * CLV_CAPTURE_LOOKAHEAD_MS — pinado por teste de boundary de 90min.
 */
export const KICKOFF_FAR_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Frescor de odds em função do tempo-até-kickoff. PURA (now injetável).
 *
 * - KO a mais de 24h (estritamente) ⇒ ODDS_SNAPSHOT_FRESHNESS_FAR_MS (60min).
 * - KO ≤24h (inclui exatamente 24h, e o conjunto CLV de KO ≤90min) ⇒
 *   ODDS_SNAPSHOT_FRESHNESS_MS (30min).
 * - kickoff `undefined` ⇒ ODDS_SNAPSHOT_FRESHNESS_MS (back-compat: comportamento
 *   de hoje pra qualquer caller que não tenha um kickoff a mão).
 *
 * A comparação é `> KICKOFF_FAR_THRESHOLD_MS` (estrita): exatamente 24h fica no
 * piso de 30min.
 */
export function oddsFreshnessMsForKickoff(
  kickoffAt: Date | undefined,
  now: Date = new Date(),
): number {
  if (!kickoffAt) return ODDS_SNAPSHOT_FRESHNESS_MS;
  const msToKickoff = kickoffAt.getTime() - now.getTime();
  return msToKickoff > KICKOFF_FAR_THRESHOLD_MS
    ? ODDS_SNAPSHOT_FRESHNESS_FAR_MS
    : ODDS_SNAPSHOT_FRESHNESS_MS;
}
