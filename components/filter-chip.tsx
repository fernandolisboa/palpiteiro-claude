import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Chip de filtro que navega (#577): um `Link` com `aria-current="page"` no ativo.
// Server-safe. O ativo vai no destaque de acento (o mesmo do DESIGN.md pra região em
// evidência): `bg-card` com sombra, sem o fundo cinza de um controle segmentado em
// volta, ficava mais apagado que o inativo no tema escuro.
// Classes do chip, também pro chip que é botão ("Escolher datas") ou select (liga).
export function filterChipClassName(active: boolean, className?: string): string {
  return cn(
    "inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-body-sm font-medium tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
    active
      ? "border-accent-border bg-accent-soft text-accent-fg"
      : "border-border bg-transparent text-muted-foreground hover:bg-surface-2 hover:text-foreground",
    className,
  );
}

export function FilterChipLink({
  href,
  active,
  children,
  className,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={filterChipClassName(active, className)}
    >
      {children}
    </Link>
  );
}
