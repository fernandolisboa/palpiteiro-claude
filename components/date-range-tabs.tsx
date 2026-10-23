import { IntentLink } from "@/components/intent-link";
import { X } from "lucide-react";

import { DateRangeSheet } from "@/components/date-range-sheet";
import { filterChipClassName } from "@/components/filter-chip";
import { buildRangeHref } from "@/lib/view/range-href";
import type { RangePreset } from "@/lib/view/date-range";
import type { ListFilters } from "@/lib/view/match-search";
import type { LeagueFilter } from "@/lib/view/types";
import { cn } from "@/lib/utils";

type Props = {
  league: LeagueFilter;
  // Busca e filtros da lista (#643): preservados ao escolher ou limpar as datas.
  filters?: ListFilters;
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
 * Período da lista de jogos. Sem escolha, a lista mostra os próximos jogos de agora
 * em diante e cresce com "Carregar mais"; os chips 5 dias, 14 dias e "Competição"
 * (#577) saíram porque a lista já cobre isso. Sobra o "Escolher datas" (folha/popover
 * com De e Até), que também serve pra jogos que já passaram. Com um intervalo
 * aplicado, o chip mostra as datas e ganha um × do lado que volta pra lista padrão.
 */
export function DateRangeTabs({
  league,
  filters,
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
      <DateRangeSheet
        league={league}
        filters={filters}
        from={customActive ? from : undefined}
        to={customActive ? to : undefined}
        active={customActive}
        label={customActive && customLabel ? customLabel : "Escolher datas"}
        surface={surface}
      />
      {customActive && (
        <IntentLink
          href={buildRangeHref({ league, filters }, { preset: "upcoming" })}
          aria-label="Limpar datas"
          title="Limpar datas"
          className={filterChipClassName(false, "w-8 justify-center px-0")}
        >
          <X aria-hidden="true" className="size-3.5" />
        </IntentLink>
      )}
    </nav>
  );
}
