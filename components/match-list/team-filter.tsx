"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Shield, X } from "lucide-react";

import { IntentLink } from "@/components/intent-link";
import { filterChipClassName } from "@/components/filter-chip";
import { TeamCrest } from "@/components/team-crest";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  foldText,
  type TeamOption,
  type TeamOptionGroup,
} from "@/lib/view/match-search";
import { buildFiltersHref, type RangeNavState } from "@/lib/view/range-href";

type Props = {
  nav: RangeNavState;
  // Times com jogo no período e nas ligas do filtro, por competição.
  groups: TeamOptionGroup[];
  // O time escolhido (o `team` da URL), já com nome e escudo.
  selected?: TeamOption;
  // Folha que sobe do rodapé no celular; popover ancorado no chip no desktop.
  surface: "sheet" | "popover";
};

const FIND_INPUT =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:text-body-sm";

function TeamGrid({
  groups,
  selected,
  onPick,
}: {
  groups: TeamOptionGroup[];
  selected?: string;
  onPick: (value: string) => void;
}) {
  const [find, setFind] = useState("");
  const needle = foldText(find.trim());
  const visible = groups
    .map((g) => ({
      ...g,
      teams: needle
        ? g.teams.filter(
            (t) =>
              foldText(t.team.name).includes(needle) ||
              foldText(t.value).includes(needle),
          )
        : g.teams,
    }))
    .filter((g) => g.teams.length > 0);
  // Um grupo só (uma liga no filtro): o título repetiria o chip da liga.
  const showHeadings = groups.length > 1;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <input
        type="search"
        aria-label="Filtrar times"
        placeholder="Filtrar times"
        autoComplete="off"
        spellCheck={false}
        value={find}
        onChange={(e) => setFind(e.currentTarget.value)}
        className={FIND_INPUT}
      />
      <div className="-mx-1 min-h-0 overflow-y-auto px-1 pb-1">
        {visible.length === 0 ? (
          <p className="py-6 text-center text-body-sm text-muted-foreground">
            {groups.length === 0 ? "Nenhum time com jogo neste período." : "Nenhum time com esse nome."}
          </p>
        ) : (
          visible.map((g) => (
            <section key={g.league} aria-label={g.label} className="pb-3 last:pb-0">
              {showHeadings && (
                <p className="pb-1.5 text-meta uppercase tracking-eyebrow text-muted-foreground">
                  {g.label}
                </p>
              )}
              <ul className="grid grid-cols-4 gap-1 sm:grid-cols-5">
                {g.teams.map((t) => {
                  const active = t.value === selected;
                  return (
                    <li key={t.value}>
                      <button
                        type="button"
                        aria-pressed={active}
                        title={t.team.fullName ?? t.team.name}
                        onClick={() => onPick(t.value)}
                        className={cn(
                          "flex w-full flex-col items-center gap-1 rounded-md border px-1 py-2 text-meta leading-tight transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                          active
                            ? "border-accent-border bg-accent-soft text-accent-fg"
                            : "border-transparent text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                        )}
                      >
                        <TeamCrest team={t.team} size={28} />
                        <span className="w-full truncate text-center">{t.team.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Chip "Time" da lista de jogos (#643): abre a grade de escudos dos times com jogo no
 * período (folha no celular, popover no desktop). Escolher um mostra só os jogos dele
 * (`team` na URL, com a liga, as datas e a busca preservadas). Com um time escolhido,
 * o chip mostra o escudo e o nome e ganha um × do lado que limpa.
 */
export function TeamFilter({ nav, groups, selected, surface }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const titleId = useId();
  const active = selected !== undefined;

  function pick(value: string) {
    setOpen(false);
    if (value === selected?.value) return;
    startTransition(() => router.push(buildFiltersHref(nav, { team: value })));
  }

  const trigger = (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      aria-label={active ? `Time: ${selected.team.name}. Trocar time` : "Filtrar por time"}
      aria-busy={pending || undefined}
      className={filterChipClassName(active, cn("max-w-56 gap-1.5", pending && "opacity-70"))}
    >
      {active ? (
        <TeamCrest team={selected.team} size={16} />
      ) : (
        <Shield aria-hidden="true" className="size-3.5" />
      )}
      <span className="truncate">{active ? selected.team.name : "Time"}</span>
    </button>
  );
  const grid = (
    <TeamGrid groups={groups} selected={selected?.value} onPick={pick} />
  );

  const clear = active && (
    <IntentLink
      href={buildFiltersHref(nav, { team: undefined })}
      aria-label="Limpar time"
      title="Limpar time"
      className={filterChipClassName(false, "w-8 justify-center px-0")}
    >
      <X aria-hidden="true" className="size-3.5" />
    </IntentLink>
  );

  if (surface === "popover") {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent
            align="start"
            aria-labelledby={titleId}
            className="flex max-h-[min(32rem,70vh)] w-[26rem] flex-col p-4"
          >
            <p id={titleId} className="pb-3 text-label font-medium tracking-tight">
              Escolher time
            </p>
            {grid}
          </PopoverContent>
        </Popover>
        {clear}
      </div>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] gap-0 rounded-t-xl pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="pb-2">
            <SheetTitle className="text-label">Escolher time</SheetTitle>
            <SheetDescription className="text-body-sm">
              Mostra só os jogos do time, nas competições do filtro.
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-col px-4 pb-2">{grid}</div>
        </SheetContent>
      </Sheet>
      {clear}
    </div>
  );
}
