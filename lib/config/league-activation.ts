import { z } from "zod";

import {
  SupportedLeagueSchema,
  type SupportedLeague,
} from "@/lib/providers/sports-data/leagues";

/** Input do toggle de liga no /admin/leagues (validado no Server Action). */
export const LeagueToggleInputSchema = z.object({
  league: SupportedLeagueSchema,
  active: z.boolean(),
});
export type LeagueToggleInput = z.infer<typeof LeagueToggleInputSchema>;

export type LeagueToggleValidation =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Regras de negócio do toggle (ADR 0050), puras pra teste:
 * - não desliga a ÚLTIMA liga ativa (a home ficaria sem default e o sync sem nada
 *   pra iterar);
 * - não liga liga sem times canônicos semeados: sem eles o casamento de nomes com
 *   os providers falha e a liga aparece sem forma/H2H/odds. Semear exige script +
 *   deploy (ids estáticos, ADR 0005), então isso não dá pra fazer pelo admin.
 * Desligar uma liga já desligada / ligar uma já ligada é no-op permitido.
 */
export function validateLeagueToggle(params: {
  league: SupportedLeague;
  active: boolean;
  currentActive: readonly SupportedLeague[];
  canonicalTeamCount: number;
}): LeagueToggleValidation {
  const { league, active, currentActive, canonicalTeamCount } = params;
  const isOn = currentActive.includes(league);

  if (!active) {
    if (isOn && currentActive.length <= 1) {
      return {
        ok: false,
        error: "Não dá pra desligar a última liga ativa — ligue outra antes.",
      };
    }
    return { ok: true };
  }

  if (!isOn && canonicalTeamCount === 0) {
    return {
      ok: false,
      error:
        "Essa liga ainda não tem times canônicos. Semeie os times com scripts/generate-team-ids.ts (e faça deploy) antes de ativá-la.",
    };
  }
  return { ok: true };
}
