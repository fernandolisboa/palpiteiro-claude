"use client";

import { IntentLink } from "@/components/intent-link";
import { usePathname } from "next/navigation";

import { activeItemHref, ADMIN_NAV, ariaCurrentFor } from "@/lib/nav/menu";
import { cn } from "@/lib/utils";

import { SettingsSearch } from "./settings-search";

/**
 * Faixa de abas de toda tela do admin (#633): as mesmas seções do dropdown "admin"
 * do header, pra pular de uma pra outra sem voltar ao menu. No celular é o único
 * mapa do admin (o menu leva só até a visão geral) e rola na horizontal. A busca de
 * configurações fica na ponta direita (no celular, numa linha embaixo das abas).
 */
export function AdminSectionNav() {
  const pathname = usePathname();
  const active = activeItemHref(pathname, ADMIN_NAV.items);
  return (
    <div className="border-border-subtle flex flex-col border-b sm:flex-row sm:items-center sm:gap-4">
      <nav aria-label="Seções do admin" className="min-w-0 flex-1">
        <div className="flex [scrollbar-width:none] gap-1 overflow-x-auto px-4 lg:px-8">
          {ADMIN_NAV.items.map(({ href, label }) => {
            const isActive = href === active;
            return (
              <IntentLink
                key={href}
                href={href}
                aria-current={
                  isActive ? ariaCurrentFor(pathname, href) : undefined
                }
                className={cn(
                  "text-body-sm text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 shrink-0 px-2.5 py-2.5 tracking-tight whitespace-nowrap transition-colors focus-visible:ring-[3px] focus-visible:outline-none focus-visible:ring-inset",
                  // Sublinhado por sombra: o `* { border-color }` sem layer do globals.css
                  // vence `border-transparent`, então borda nos inativos apareceria.
                  isActive &&
                    "text-foreground shadow-[inset_0_-2px_0_var(--foreground)]"
                )}
              >
                {label}
              </IntentLink>
            );
          })}
        </div>
      </nav>
      {/* Padding fora do componente: o ícone, o atalho e a lista se posicionam pela
          caixa do campo. */}
      <div className="px-4 pb-2.5 sm:w-68 sm:shrink-0 sm:pb-0 sm:pl-0 lg:pr-8">
        <SettingsSearch />
      </div>
    </div>
  );
}
