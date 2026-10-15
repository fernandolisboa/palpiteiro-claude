"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { navLinkVariants } from "@/components/nav-link";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  ACCOUNT_NAV,
  activeItemHref,
  ariaCurrentFor,
  navGroups,
  PRIMARY_NAV,
  type NavItem,
} from "@/lib/nav/menu";
import { cn } from "@/lib/utils";

type NavSection = { id: string; label: string | null; items: readonly NavItem[] };

/**
 * Seções do drawer do celular: o mesmo modelo da barra do computador
 * (`lib/nav/menu.ts`), com a conta no fim. No computador a conta mora no avatar;
 * aqui ela entra no drawer também, pra o mapa do app ficar num lugar só. Função
 * pura (seam de teste sem @testing-library).
 */
export function mobileNavSections(isAdmin: boolean): NavSection[] {
  return [
    { id: "principal", label: null, items: PRIMARY_NAV },
    ...navGroups(isAdmin).map((g) => ({ id: g.id, label: g.label, items: g.items })),
    { id: "conta", label: "conta", items: ACCOUNT_NAV },
  ];
}

export function MobileNav({
  isAdmin,
  className,
}: {
  isAdmin: boolean;
  className?: string;
}) {
  const pathname = usePathname();
  const sections = mobileNavSections(isAdmin);
  // Um único item ativo no drawer inteiro (o mais específico), igual à barra.
  const active = activeItemHref(
    pathname,
    sections.flatMap((s) => s.items)
  );

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Abrir menu"
          data-tour="menu"
          className={className}
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      {/* O primitivo SheetContent não tem padding interno — adicionamos aqui. */}
      <SheetContent side="left" className="w-72 overflow-y-auto p-4">
        {/* Radix Dialog exige um título pra a11y; não queremos exibi-lo. */}
        <SheetTitle className="sr-only">Navegação</SheetTitle>
        <nav aria-label="Navegação principal" className="flex flex-col gap-4 pt-2">
          {sections.map((section) => (
            <div key={section.id} className="flex flex-col gap-1">
              {section.label && (
                <span className="px-3 pb-1 font-mono text-meta uppercase tracking-eyebrow text-muted-fg-2">
                  {section.label}
                </span>
              )}
              {section.items.map(({ href, label }) => (
                <SheetClose asChild key={href}>
                  <Link
                    href={href}
                    aria-current={
                      href === active ? ariaCurrentFor(pathname, href) : undefined
                    }
                    className={navLinkVariants({ variant: "row" })}
                  >
                    {label}
                  </Link>
                </SheetClose>
              ))}
              {/*
                "sair" é action, não link: renderiza como <form>. Sem `SheetClose`: o
                signOut redireciona pra "/signin" e desmonta o Sheet; envolver
                arriscaria o close do Radix desmontar antes do dispatch da action.
              */}
              {section.id === "conta" && (
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className={cn(navLinkVariants({ variant: "row" }), "w-full text-left")}
                  >
                    sair
                  </button>
                </form>
              )}
            </div>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
