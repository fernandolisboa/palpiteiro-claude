import { ACTIVE_LEAGUE_KEYS } from "@/lib/config/active-leagues";
import { LEAGUE_LABEL, leagueToKey } from "@/lib/format";
import { SUPPORTED_LEAGUES } from "@/lib/providers/sports-data/leagues";
import type { LeagueFilter, LeagueKey } from "@/lib/view/types";

// Agrupamento do seletor de liga da home. A ordem aqui é a ordem dos grupos no
// dropdown; dentro de cada grupo vale a ordem de SUPPORTED_LEAGUES.
const REGIONS = ["Brasil", "América do Sul", "Europa", "Seleções"] as const;
type Region = (typeof REGIONS)[number];

// Exaustivo: liga nova sem região = erro de compilação.
const LEAGUE_REGION: Record<LeagueKey, Region> = {
  bsa: "Brasil",
  ucl: "Europa",
  wc: "Seleções",
  lib: "América do Sul",
  sula: "América do Sul",
};

// Torneio (Copa, a cada 4 anos) inativo é ESCONDIDO — "fora de temporada" pra Copa
// seria mentira (#491). Liga de clube inativa aparece desabilitada.
const HIDE_WHEN_INACTIVE: ReadonlySet<LeagueKey> = new Set<LeagueKey>(["wc"]);

export const ALL_LEAGUES_LABEL = "Todas as ligas";

export type LeaguePickerOption = {
  value: LeagueFilter;
  label: string;
  active: boolean;
};

export type LeaguePickerGroup = {
  /** `null` = sem <optgroup> (a opção "Todas" e listas de um grupo só). */
  label: string | null;
  options: LeaguePickerOption[];
};

/**
 * Opções do seletor de liga, agrupadas por região. Função pura (seam de teste):
 * - "Todas as ligas" só existe com >1 liga ativa e vem primeiro, fora de grupo;
 * - liga de clube inativa vira opção desabilitada; torneio inativo some;
 * - com um grupo só, os rótulos de grupo somem (optgroup de 1 item é ruído).
 * Escala pra qualquer número de ligas: tudo deriva de SUPPORTED_LEAGUES.
 */
export function leaguePickerGroups(
  activeKeys: readonly LeagueFilter[] = ACTIVE_LEAGUE_KEYS,
): LeaguePickerGroup[] {
  const byRegion = new Map<Region, LeaguePickerOption[]>();
  for (const league of SUPPORTED_LEAGUES) {
    const key = leagueToKey(league);
    const active = activeKeys.includes(key);
    if (!active && HIDE_WHEN_INACTIVE.has(key)) continue;
    const region = LEAGUE_REGION[key];
    const list = byRegion.get(region) ?? [];
    list.push({ value: key, label: LEAGUE_LABEL[key], active });
    byRegion.set(region, list);
  }

  const regionGroups = REGIONS.flatMap((region) => {
    const options = byRegion.get(region);
    return options ? [{ label: region, options }] : [];
  });
  const grouped: LeaguePickerGroup[] =
    regionGroups.length > 1
      ? regionGroups
      : [{ label: null, options: regionGroups.flatMap((g) => g.options) }];

  if (activeKeys.length <= 1) return grouped;
  return [
    { label: null, options: [{ value: "all", label: ALL_LEAGUES_LABEL, active: true }] },
    ...grouped,
  ];
}
