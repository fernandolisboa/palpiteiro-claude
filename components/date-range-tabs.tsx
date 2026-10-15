import { DateRangeSheet } from "@/components/date-range-sheet";
import { FilterChipLink } from "@/components/filter-chip";
import { buildRangeHref } from "@/lib/view/range-href";
import type { RangePreset } from "@/lib/view/date-range";
import type { LeagueFilter } from "@/lib/view/types";
import { cn } from "@/lib/utils";

type PresetItem = {
  value: "today5" | "today14" | "season";
  label: string;
};

const PRESETS: PresetItem[] = [
  { value: "today5", label: "5 dias" },
  { value: "today14", label: "14 dias" },
  { value: "season", label: "Competição" },
];

type Props = {
  league: LeagueFilter;
  preset: RangePreset;
  from?: string;
  to?: string;
  // Rótulo do intervalo escolhido ("18/10 – 25/10", rangeLabel) quando o preset
  // custom está ativo; vira o texto do chip "Escolher datas".
  customLabel?: string;
  // Onde abre o "Escolher datas": folha no celular, popover no desktop.
  surface: "sheet" | "popover";
  className?: string;
};

/**
 * Chips de período da lista de jogos (#577): 5 dias, 14 dias, Competição (links com
 * `aria-current`) e "Escolher datas" (folha/popover com De e Até). Os `href` são os de
 * sempre (`buildRangeHref`, preservando a liga): links salvos seguem valendo. O
 * período aparece só aqui, no chip selecionado.
 */
export function DateRangeTabs({
  league,
  preset,
  from,
  to,
  customLabel,
  surface,
  className,
}: Props) {
  const customActive = preset === "custom" && customLabel !== undefined;
  return (
    <nav aria-label="Filtro de período" className={cn("flex items-center gap-2", className)}>
      {PRESETS.map(({ value, label }) => (
        <FilterChipLink
          key={value}
          href={buildRangeHref({ league }, { preset: value })}
          active={preset === value}
        >
          {label}
        </FilterChipLink>
      ))}
      <DateRangeSheet
        league={league}
        from={customActive ? from : undefined}
        to={customActive ? to : undefined}
        active={customActive}
        label={customActive && customLabel ? customLabel : "Escolher datas"}
        surface={surface}
      />
    </nav>
  );
}
