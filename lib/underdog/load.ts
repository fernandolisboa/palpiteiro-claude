import { getEnableUnderdogView } from "@/lib/db/queries/ai-config";
import { getLatestMatchModelSnapshotWithKickoff } from "@/lib/db/queries/match-model-snapshots";
import { getLatestUnderdogView } from "@/lib/db/queries/underdog-views";
import type { UnderdogTeaserData } from "@/lib/view/underdog";

import { readUnderdogBase } from "./compute";

/**
 * O que a página do jogo precisa pro painel do azarão (#671), só leitura do banco: a
 * flag, o azarão da base atual (ou null) e a última row do usuário no jogo. null = flag
 * desligada. Nunca lança: falha vira null (o painel some, a página segue).
 */
export async function loadUnderdogTeaser(args: {
  matchId: string;
  userId: string;
  now: Date;
}): Promise<UnderdogTeaserData | null> {
  try {
    const [flag, found, stored] = await Promise.all([
      getEnableUnderdogView(),
      getLatestMatchModelSnapshotWithKickoff(args.matchId),
      getLatestUnderdogView(args.userId, args.matchId),
    ]);
    if (!flag) return null;
    const read = found
      ? readUnderdogBase(found.snapshot, found.kickoffAt, args.now)
      : ({ status: "unavailable" } as const);
    return {
      current: read.status === "ok" ? read.base.pick : null,
      baseStatus: read.status,
      stored,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "underdog",
        error: "teaser_load_failed",
        matchId: args.matchId,
        message: err instanceof Error ? err.message : String(err),
      })
    );
    return null;
  }
}
