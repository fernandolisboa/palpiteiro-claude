import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type Props = {
  label: ReactNode;
  value: ReactNode;
  className?: string;
};

/**
 * Linha label/valor compartilhada do admin (ADR 0029 / #324): frame horizontal
 * (`flex justify-between border-b`) com slots ReactNode — o consumidor controla a
 * tipografia de cada lado. Consolida o frame reimplementado em
 * `predictions/[id]` (Row local), `costs` (3 listas) e `settings` (lista de modelos).
 * As linhas Role/Acesso de `user-admin-controls` são flex-col + action (forma
 * distinta) → NÃO consomem este frame.
 */
export function DefinitionRow({ label, value, className }: Props) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-b border-border py-2",
        className
      )}
    >
      {label}
      {value}
    </div>
  );
}
