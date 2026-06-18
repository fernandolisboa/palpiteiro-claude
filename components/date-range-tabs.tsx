"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

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
  className?: string;
};

/**
 * Linha de filtro de range na home: presets (5/14 dias, Competição) + um range
 * custom via dois <input type="date"> nativos (zero deps novas). Ambos preservam
 * a `league` atual (via buildRangeHref) — os dois eixos de filtro compõem.
 */
export function DateRangeTabs({ league, preset, from, to, className }: Props) {
  const router = useRouter();

  const customActive = preset === "custom";

  function navigateCustom(nextFrom: string, nextTo: string) {
    // Só navega quando ambas as datas estão preenchidas; parseRangeParams cai
    // pro default se vier incompleto, então evitamos um round-trip inútil.
    if (!nextFrom || !nextTo) return;
    router.push(
      buildRangeHref({ league }, { preset: "custom", from: nextFrom, to: nextTo }),
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <nav
        className="inline-flex h-9 items-center rounded-md border border-border bg-surface-2 p-1"
        aria-label="Filtro de período"
      >
        {PRESETS.map(({ value, label }) => {
          const selected = preset === value;
          return (
            <Link
              key={value}
              href={buildRangeHref({ league }, { preset: value })}
              aria-current={selected ? "page" : undefined}
              className={cn(
                "h-7 rounded-sm px-3 text-body-sm font-medium leading-7 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                selected
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      <div
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5",
          customActive
            ? "border-accent-border bg-accent-soft"
            : "border-border bg-surface-2",
        )}
        aria-label="Período personalizado"
      >
        <input
          type="date"
          aria-label="De"
          defaultValue={customActive ? from : undefined}
          onChange={(e) => {
            const el = e.currentTarget;
            const sibling = el.parentElement?.querySelector<HTMLInputElement>(
              'input[aria-label="Até"]',
            );
            navigateCustom(el.value, sibling?.value ?? to ?? "");
          }}
          className="bg-transparent text-meta tabular-nums text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <span className="text-meta text-muted-foreground">–</span>
        <input
          type="date"
          aria-label="Até"
          defaultValue={customActive ? to : undefined}
          onChange={(e) => {
            const el = e.currentTarget;
            const sibling = el.parentElement?.querySelector<HTMLInputElement>(
              'input[aria-label="De"]',
            );
            navigateCustom(sibling?.value ?? from ?? "", el.value);
          }}
          className="bg-transparent text-meta tabular-nums text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>
    </div>
  );
}
