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
  sa: "Europa",
  bl: "Europa",
  l1: "Europa",
  lib: "América do Sul",
  sula: "América do Sul",
  epl: "Europa",
  laliga: "Europa",
};

export const ALL_LEAGUES_LABEL = "Todas as ligas";

// Só ligas ATIVAS viram opção (ADR 0050): liga desligada no admin some do seletor —
// sem opção desabilitada ("fora de temporada" seria mentira pra liga desligada por
// orçamento, e opção morta sem explicação só confunde).
export type LeaguePickerOption = {
  value: LeagueFilter;
  label: string;
};

export type LeaguePickerGroup = {
  /** `null` = sem <optgroup> (a opção "Todas" e listas de um grupo só). */
  label: string | null;
  options: LeaguePickerOption[];
};

/**
 * Opções do seletor de liga, agrupadas por região. Função pura (seam de teste):
 * - "Todas as ligas" só existe com >1 liga ativa e vem primeiro, fora de grupo;
 * - só ligas ativas aparecem (inativa some);
 * - com um grupo só, os rótulos de grupo somem (optgroup de 1 item é ruído).
 * Escala pra qualquer número de ligas: tudo deriva de SUPPORTED_LEAGUES.
 */
export function leaguePickerGroups(
  activeKeys: readonly LeagueFilter[],
): LeaguePickerGroup[] {
  const byRegion = new Map<Region, LeaguePickerOption[]>();
  for (const league of SUPPORTED_LEAGUES) {
    const key = leagueToKey(league);
    if (!activeKeys.includes(key)) continue;
    const region = LEAGUE_REGION[key];
    const list = byRegion.get(region) ?? [];
    list.push({ value: key, label: LEAGUE_LABEL[key] });
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
    { label: null, options: [{ value: "all", label: ALL_LEAGUES_LABEL }] },
    ...grouped,
  ];
}
