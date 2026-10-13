"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import {
  LeagueToggleInputSchema,
  validateLeagueToggle,
} from "@/lib/config/league-activation";
import {
  getLeagueSettings,
  setLeagueActive,
} from "@/lib/db/queries/league-settings";
import { CANONICAL_TEAMS } from "@/lib/providers/sports-data/canonical-teams";

export type ToggleLeagueResult = { ok: boolean; error?: string };

/**
 * Liga/desliga uma liga (ADR 0050). Regras de negócio em `validateLeagueToggle`
 * (lib/config/league-activation.ts); aqui só auth, parse e efeito.
 */
export async function toggleLeague(
  _prev: ToggleLeagueResult | null,
  formData: FormData
): Promise<ToggleLeagueResult> {
  const session = await auth();
  // Server actions são POST chamáveis FORA do layout (que gateia /admin/**),
  // então a role é revalidada AQUI — defense-in-depth além de esconder a UI.
  if (session?.user?.role !== "admin" || !session.user.id) {
    return { ok: false, error: "Acesso negado." };
  }

  const parsed = LeagueToggleInputSchema.safeParse({
    league: formData.get("league"),
    active: formData.get("active") === "true",
  });
  if (!parsed.success) {
    return { ok: false, error: "Liga inválida." };
  }
  const { league, active } = parsed.data;

  // Estado REAL do banco (sem o fallback de getActiveLeagues): é o que o admin vê.
  const settings = await getLeagueSettings();
  const verdict = validateLeagueToggle({
    league,
    active,
    currentActive: settings.filter((s) => s.active).map((s) => s.league),
    canonicalTeamCount: CANONICAL_TEAMS[league].length,
  });
  if (!verdict.ok) return { ok: false, error: verdict.error };

  await setLeagueActive(league, active, session.user.id);
  revalidatePath("/admin/leagues");
  revalidatePath("/jogos");
  return { ok: true };
}
