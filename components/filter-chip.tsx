import { IntentLink } from "@/components/intent-link";
import { X } from "lucide-react";
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
    <IntentLink
      href={href}
      aria-current={active ? "page" : undefined}
      className={filterChipClassName(active, className)}
    >
      {children}
    </IntentLink>
  );
}

// Chip ativo com um × de limpar DENTRO do pill (Escolher datas, Time). O contorno e o
// fundo ficam no wrapper; dentro há dois alvos com foco próprio: o miolo (botão que abre
// o seletor) e o × (link que limpa). Antes o × era um chip redondo solto do lado. O anel
// de foco do miolo pinta o pill inteiro; o do × só o círculo dele.
const CLEARABLE_CHIP =
  "inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full border border-accent-border bg-accent-soft text-body-sm font-medium tracking-tight text-accent-fg has-[>button:focus-visible]:ring-[3px] has-[>button:focus-visible]:ring-ring/50";

export function clearableChipClassName(className?: string): string {
  return cn(CLEARABLE_CHIP, className);
}

// Classes do miolo (o trigger do seletor) dentro do chip com ×.
export function clearableChipBodyClassName(className?: string): string {
  return cn("inline-flex h-full min-w-0 items-center pl-3 pr-1 focus-visible:outline-none", className);
}

export function ChipClearLink({ href, label }: { href: string; label: string }) {
  return (
    <IntentLink
      href={href}
      aria-label={label}
      title={label}
      className="group inline-flex h-full shrink-0 items-center pr-1.5 pl-0.5 focus-visible:outline-none"
    >
      <span className="grid size-5 place-items-center rounded-full transition-colors group-hover:bg-accent-fg/20 group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50">
        <X aria-hidden="true" className="size-3.5" />
      </span>
    </IntentLink>
  );
}
