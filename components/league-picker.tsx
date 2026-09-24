"use client";

import { useRouter } from "next/navigation";

import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { RangePreset } from "@/lib/view/date-range";
import {
  leaguePickerGroups,
  type LeaguePickerOption,
} from "@/lib/view/league-picker";
import { buildLeagueHref } from "@/lib/view/range-href";
import type { LeagueFilter } from "@/lib/view/types";

type RangeState = {
  preset: RangePreset;
  from?: string;
  to?: string;
};

type Props = {
  value: LeagueFilter;
  /** Range atual — preservado ao trocar de liga (os dois filtros compõem). */
  range: RangeState;
  className?: string;
};

// Sufixo no texto da própria opção: `title` de <option> não chega a touch nem a
// leitor de tela (#448).
const OFF_SEASON_SUFFIX = " (fora de temporada)";

function OptionItem({ option }: { option: LeaguePickerOption }) {
  return (
    <option value={option.value} disabled={!option.active}>
      {option.label}
      {option.active ? "" : OFF_SEASON_SUFFIX}
    </option>
  );
}

/**
 * Seletor de liga da home: <select> nativo (primitivo do ADR 0029) agrupado por
 * região. Substitui as abas, que não escalam além de 3–4 ligas; o picker nativo
 * também é o melhor controle no mobile. Trocar de liga navega preservando o range.
 * O guard em app/jogos/page.tsx segue sendo o enforcement real (liga inativa na
 * URL redireciona).
 */
export function LeaguePicker({ value, range, className }: Props) {
  const router = useRouter();
  const groups = leaguePickerGroups();

  return (
    <div className={cn("w-full sm:w-56", className)}>
      <Select
        aria-label="Filtro de liga"
        value={value}
        onChange={(e) =>
          router.push(buildLeagueHref(range, e.target.value as LeagueFilter))
        }
        className="bg-surface-2 font-medium"
      >
        {groups.map((group) =>
          group.label === null ? (
            group.options.map((o) => <OptionItem key={o.value} option={o} />)
          ) : (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((o) => (
                <OptionItem key={o.value} option={o} />
              ))}
            </optgroup>
          ),
        )}
      </Select>
    </div>
  );
}
