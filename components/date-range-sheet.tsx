"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { filterChipClassName } from "@/components/filter-chip";
import { buildRangeHref } from "@/lib/view/range-href";
import type { LeagueFilter } from "@/lib/view/types";

type Props = {
  league: LeagueFilter;
  // Intervalo atual quando `preset=custom` ("2026-10-18"); preenche os campos.
  from?: string;
  to?: string;
  // Chip selecionado (preset custom ativo) e o texto dele: o intervalo ("18/10 –
  // 25/10") quando ativo, senão "Escolher datas".
  active: boolean;
  label: string;
  // Folha que sobe do rodapé no celular; popover ancorado no chip no desktop.
  surface: "sheet" | "popover";
};

const INPUT =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-body-sm tabular-nums text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function RangeForm({
  league,
  from,
  to,
  active,
  onDone,
}: Pick<Props, "league" | "from" | "to" | "active"> & { onDone: () => void }) {
  const router = useRouter();
  const [nextFrom, setNextFrom] = useState(from ?? "");
  const [nextTo, setNextTo] = useState(to ?? "");
  // As duas datas e em ordem; fora disso o parse da página cairia no padrão.
  const ready = nextFrom !== "" && nextTo !== "" && nextFrom <= nextTo;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        onDone();
        router.push(buildRangeHref({ league }, { preset: "custom", from: nextFrom, to: nextTo }));
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-body-sm text-muted-foreground">
          De
          <input
            type="date"
            aria-label="De"
            value={nextFrom}
            max={nextTo || undefined}
            onChange={(e) => setNextFrom(e.currentTarget.value)}
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-body-sm text-muted-foreground">
          Até
          <input
            type="date"
            aria-label="Até"
            value={nextTo}
            min={nextFrom || undefined}
            onChange={(e) => setNextTo(e.currentTarget.value)}
            className={INPUT}
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        {/* "Limpar" só com um intervalo aplicado: sem ele, já se está nos 5 dias. */}
        {active && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onDone();
              router.push(buildRangeHref({ league }, { preset: "today5" }));
            }}
          >
            Limpar
          </Button>
        )}
        <Button type="submit" size="sm" disabled={!ready}>
          Aplicar
        </Button>
      </div>
    </form>
  );
}

/**
 * Chip "Escolher datas" da lista de jogos (#577): abre os campos De e Até numa folha
 * (celular) ou num popover (desktop). "Aplicar" navega para o intervalo
 * (`preset=custom`, os mesmos parâmetros de URL de antes); "Limpar" (só com o
 * intervalo ativo) volta para 5 dias. Com o intervalo ativo, o chip mostra as datas e fica selecionado: é o único
 * lugar onde o período aparece.
 */
export function DateRangeSheet({ league, from, to, active, label, surface }: Props) {
  const [open, setOpen] = useState(false);
  // Nome acessível do popover (role=dialog): o título "Escolher datas".
  const titleId = useId();
  const trigger = (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      className={filterChipClassName(active, "gap-1.5 tabular-nums")}
    >
      <CalendarDays aria-hidden="true" className="size-3.5" />
      {label}
    </button>
  );
  const form = (
    <RangeForm
      league={league}
      from={from}
      to={to}
      active={active}
      onDone={() => setOpen(false)}
    />
  );

  if (surface === "popover") {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="end" aria-labelledby={titleId} className="w-80 p-4">
          <p id={titleId} className="pb-3 text-label font-medium tracking-tight">
            Escolher datas
          </p>
          {form}
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="gap-0 rounded-t-xl pb-[max(1rem,env(safe-area-inset-bottom))]">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-label">Escolher datas</SheetTitle>
          <SheetDescription className="text-body-sm">
            Mostra os jogos entre as duas datas.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-2">{form}</div>
      </SheetContent>
    </Sheet>
  );
}
