import { cache } from "react";
import { eq } from "drizzle-orm";

import { leagueSettings } from "@/db/schema";
import { db } from "@/lib/db";
import { FALLBACK_ACTIVE_LEAGUES } from "@/lib/config/active-leagues";
import {
  SUPPORTED_LEAGUES,
  type SupportedLeague,
} from "@/lib/providers/sports-data/leagues";

// Boundary única de leitura/escrita de `league_settings` (ADR 0050): quais ligas
// estão ativas. Liga sem row = desligada.

function inSupportedOrder(
  leagues: Iterable<SupportedLeague>
): SupportedLeague[] {
  const set = new Set(leagues);
  return SUPPORTED_LEAGUES.filter((l) => set.has(l));
}

/**
 * Ligas ativas, na ordem de SUPPORTED_LEAGUES. Nunca vazia: zero ligas ativas no
 * banco OU erro de leitura → FALLBACK_ACTIVE_LEAGUES (com warn), pra home/sync/
 * prewarm nunca ficarem sem liga (a home redirecionaria em loop sem default).
 */
export async function getActiveLeagues(): Promise<SupportedLeague[]> {
  try {
    const rows = await db
      .select({ league: leagueSettings.league })
      .from(leagueSettings)
      .where(eq(leagueSettings.active, true));
    const active = inSupportedOrder(rows.map((r) => r.league));
    if (active.length > 0) return active;
    console.warn(
      JSON.stringify({
        scope: "getActiveLeagues",
        warning: "nenhuma liga ativa em league_settings; usando fallback",
        used: FALLBACK_ACTIVE_LEAGUES,
      })
    );
  } catch (err) {
    console.warn(
      JSON.stringify({
        scope: "getActiveLeagues",
        warning: "falha ao ler league_settings; usando fallback",
        message: err instanceof Error ? err.message : String(err),
        used: FALLBACK_ACTIVE_LEAGUES,
      })
    );
  }
  return [...FALLBACK_ACTIVE_LEAGUES];
}

/**
 * Versão deduplicada por request pra Server Components (React `cache()`): a page e
 * seus filhos leem a mesma lista com uma query só. Crons/jobs usam
 * `getActiveLeagues` direto (fora de render, `cache()` não deduplica).
 */
export const getActiveLeaguesForRequest = cache(getActiveLeagues);

export type LeagueSettingRow = {
  league: SupportedLeague;
  active: boolean;
  updatedAt: Date | null;
};

/**
 * Uma linha por liga de SUPPORTED_LEAGUES (liga sem row = desligada, updatedAt
 * null) pro /admin/leagues. Sem fallback: o admin mostra o estado real do banco.
 */
export async function getLeagueSettings(): Promise<LeagueSettingRow[]> {
  const rows = await db
    .select({
      league: leagueSettings.league,
      active: leagueSettings.active,
      updatedAt: leagueSettings.updatedAt,
    })
    .from(leagueSettings);
  const byLeague = new Map(rows.map((r) => [r.league, r]));
  return SUPPORTED_LEAGUES.map((league) => {
    const row = byLeague.get(league);
    return {
      league,
      active: row?.active ?? false,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

/** Upsert do toggle de uma liga. Grava quem alterou pra auditoria. */
export async function setLeagueActive(
  league: SupportedLeague,
  active: boolean,
  userId: string
): Promise<void> {
  await db
    .insert(leagueSettings)
    .values({ league, active, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: leagueSettings.league,
      set: { active, updatedByUserId: userId, updatedAt: new Date() },
    });
}
