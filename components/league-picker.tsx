"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { RangePreset } from "@/lib/view/date-range";
import {
  leaguePickerGroups,
  type LeaguePickerOption,
} from "@/lib/view/league-picker";
import { buildLeagueHref } from "@/lib/view/range-href";
import type { LeagueFilter, LeagueKey } from "@/lib/view/types";

type RangeState = {
  preset: RangePreset;
  from?: string;
  to?: string;
};

type Props = {
  value: LeagueFilter;
  /** Keys das ligas ativas (league_settings), lidas pelo Server Component pai. */
  activeKeys: readonly LeagueKey[];
  /** Range atual — preservado ao trocar de liga (os dois filtros compõem). */
  range: RangeState;
  className?: string;
};

function OptionItem({ option }: { option: LeaguePickerOption }) {
  return <option value={option.value}>{option.label}</option>;
}

/**
 * Seletor de liga da home: <select> nativo (primitivo do ADR 0029) agrupado por
 * região. Substitui as abas, que não escalam além de 3–4 ligas; o picker nativo
 * também é o melhor controle no mobile. Trocar de liga navega preservando o range.
 * O guard em app/jogos/page.tsx segue sendo o enforcement real (liga inativa na
 * URL redireciona).
 */
export function LeaguePicker({ value, activeKeys, range, className }: Props) {
  const router = useRouter();
  const groups = leaguePickerGroups(activeKeys);
  // Estado local otimista: sem ele o <select> controlado volta pra liga antiga
  // enquanto a navegação (transition) espera o RSC — a escolha parece "desfeita".
  const [selected, setSelected] = useState(value);
  const [pending, startTransition] = useTransition();
  useEffect(() => setSelected(value), [value]);

  return (
    <div className={cn("w-full sm:w-56", className)}>
      <Select
        aria-label="Filtro de liga"
        value={selected}
        aria-busy={pending || undefined}
        onChange={(e) => {
          const next = e.target.value as LeagueFilter;
          setSelected(next);
          startTransition(() => router.push(buildLeagueHref(range, next)));
        }}
        className={cn("bg-surface-2 font-medium", pending && "opacity-70")}
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
