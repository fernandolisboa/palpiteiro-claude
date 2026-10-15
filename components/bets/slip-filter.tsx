import { FilterChipLink } from "@/components/filter-chip";
import type { SlipFilter } from "@/lib/bets/slip-ledger";

// Em aberto × Encerradas (#577). Sem contagem no chip: o "em aberto" já está no
// resumo logo acima. Os rótulos ficam literais aqui (o guia /como-usar os cita).
export function slipFilterHref(filter: SlipFilter, cursor?: string): string {
  const params = new URLSearchParams({ status: filter });
  if (cursor) params.set("cursor", cursor);
  return `/apostas?${params.toString()}`;
}

export function SlipFilterChips({ current }: { current: SlipFilter }) {
  return (
    <nav aria-label="Filtrar apostas" className="flex flex-wrap gap-2">
      <FilterChipLink href={slipFilterHref("abertas")} active={current === "abertas"}>
        Em aberto
      </FilterChipLink>
      <FilterChipLink href={slipFilterHref("encerradas")} active={current === "encerradas"}>
        Encerradas
      </FilterChipLink>
    </nav>
  );
}
