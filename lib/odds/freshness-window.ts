/**
 * TTL externo das snapshots de odds: 30 min.
 *
 * Camada externa "vale considerar re-fetch?" acima do cache interno de
 * odds-api.ts (5-15min adaptativo). Tanto ensureOddsSnapshotsFresh quanto
 * predict() precisam concordar na MESMA definição de frescor — reuso e
 * refetch usam este único valor pra nunca discordarem (um reusa, o outro
 * refaz) pra mesma idade de snapshot.
 */
export const ODDS_SNAPSHOT_FRESHNESS_MS = 30 * 60 * 1000;
