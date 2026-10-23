"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { navLinkVariants } from "@/components/nav-link";
import {
  activeItemHref,
  ariaCurrentFor,
  BETS_NAV,
  GAMES_NAV,
  isActivePath,
  navGroups,
  type NavGroup,
} from "@/lib/nav/menu";
import { cn } from "@/lib/utils";

/**
 * Barra do computador: jogos solto; "apostas" (suas apostas, bolão, desempenho),
 * ajuda e admin como dropdown (#633).
 */
export function DesktopNav({
  isAdmin,
  className,
}: {
  isAdmin: boolean;
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação principal"
      className={cn("items-center gap-5", className)}
      data-tour="menu"
    >
      <Link
        href={GAMES_NAV.href}
        aria-current={
          isActivePath(pathname, GAMES_NAV.href)
            ? ariaCurrentFor(pathname, GAMES_NAV.href)
            : undefined
        }
        className={navLinkVariants({ variant: "inline" })}
      >
        {GAMES_NAV.label}
      </Link>
      <NavGroupMenu group={BETS_NAV} pathname={pathname} />
      <span aria-hidden="true" className="h-4 w-px bg-border-subtle" />
      {navGroups(isAdmin).map((group) => (
        <NavGroupMenu key={group.id} group={group} pathname={pathname} />
      ))}
    </nav>
  );
}

function NavGroupMenu({
  group,
  pathname,
}: {
  group: NavGroup;
  pathname: string;
}) {
  const active = activeItemHref(pathname, group.items);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        // Grupo ativo pinta o gatilho como o link ativo (mesmo seletor do navLinkVariants).
        data-active={active ? "true" : undefined}
        className={cn(
          navLinkVariants({ variant: "inline" }),
          "inline-flex items-center gap-1 data-[active=true]:text-foreground data-[state=open]:text-foreground"
        )}
      >
        {group.label}
        <ChevronDown aria-hidden="true" className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {group.items.map(({ href, label }) => (
          <DropdownMenuItem key={href} asChild>
            <Link
              href={href}
              aria-current={
                href === active ? ariaCurrentFor(pathname, href) : undefined
              }
            >
              {label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
