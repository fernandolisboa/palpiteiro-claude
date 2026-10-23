"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { AnalyzedFilter } from "@/lib/view/match-search";
import { buildFiltersHref, type RangeNavState } from "@/lib/view/range-href";

const OPTIONS: { value: AnalyzedFilter; label: string }[] = [
  { value: "all", label: "Todos os jogos" },
  { value: "yes", label: "Analisados" },
  { value: "no", label: "Não analisados" },
];

/**
 * Filtro de análise da lista de jogos (#643): todos, só os que o usuário já analisou
 * (o selo "analisado") ou só os que ainda não. <select> nativo com cara de chip, como
 * o seletor de liga; trocar navega preservando a liga, as datas e a busca.
 */
export function AnalyzedPicker({ nav }: { nav: RangeNavState }) {
  const router = useRouter();
  const value = nav.filters?.analyzed ?? "all";
  // Otimista, como no LeaguePicker: sem isto o select volta pro valor antigo
  // enquanto a navegação espera o servidor.
  const [selected, setSelected] = useState<AnalyzedFilter>(value);
  const [pending, startTransition] = useTransition();
  useEffect(() => setSelected(value), [value]);

  return (
    <div className="w-auto shrink-0">
      <Select
        aria-label="Filtro de análise"
        value={selected}
        aria-busy={pending || undefined}
        onChange={(e) => {
          const next = e.target.value as AnalyzedFilter;
          setSelected(next);
          startTransition(() =>
            router.push(buildFiltersHref(nav, { analyzed: next })),
          );
        }}
        className={cn(
          "h-8 w-auto rounded-full py-0 pl-3 pr-8 font-medium tracking-tight shadow-none",
          selected === "all"
            ? "border-border bg-transparent text-foreground"
            : "border-accent-border bg-accent-soft text-accent-fg",
          pending && "opacity-70",
        )}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
