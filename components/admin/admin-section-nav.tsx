"use client";

import { IntentLink } from "@/components/intent-link";
import { usePathname } from "next/navigation";

import {
  activeItemHref,
  ADMIN_NAV,
  ariaCurrentFor,
} from "@/lib/nav/menu";
import { cn } from "@/lib/utils";

/**
 * Faixa de abas de toda tela do admin (#633): as mesmas seções do dropdown "admin"
 * do header, pra pular de uma pra outra sem voltar ao menu. No celular é o único
 * mapa do admin (o menu leva só até a visão geral) e rola na horizontal.
 */
export function AdminSectionNav() {
  const pathname = usePathname();
  const active = activeItemHref(pathname, ADMIN_NAV.items);
  return (
    <nav
      aria-label="Seções do admin"
      className="border-b border-border-subtle"
    >
      <div className="flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] lg:px-8">
        {ADMIN_NAV.items.map(({ href, label }) => {
          const isActive = href === active;
          return (
            <IntentLink
              key={href}
              href={href}
              aria-current={isActive ? ariaCurrentFor(pathname, href) : undefined}
              className={cn(
                "shrink-0 whitespace-nowrap px-2.5 py-2.5 text-body-sm tracking-tight text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50",
                // Sublinhado por sombra: o `* { border-color }` sem layer do globals.css
                // vence `border-transparent`, então borda nos inativos apareceria.
                isActive && "text-foreground shadow-[inset_0_-2px_0_var(--foreground)]"
              )}
            >
              {label}
            </IntentLink>
          );
        })}
      </div>
    </nav>
  );
}
