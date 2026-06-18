import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type Props = {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

/**
 * Estado vazio único (ADR 0029): ícone opcional + título + descrição + ação,
 * centralizado num container estreito. Substitui as cópias divergentes (ora
 * `<div>` cru, ora card com ícone). Criado como fundação; consumidores de
 * conteúdo migram nos heirs.
 */
export function EmptyState({ icon, title, description, action, className }: Props) {
  return (
    <div
      className={cn(
        "mx-auto flex max-w-narrow flex-col items-center gap-3 px-5 py-12 text-center",
        className
      )}
    >
      {icon && <span className="text-muted-fg-2">{icon}</span>}
      <div className="flex flex-col gap-1.5">
        <p className="text-label font-medium tracking-tight">{title}</p>
        {description && (
          <p className="text-body-sm text-muted-foreground tracking-tight">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
