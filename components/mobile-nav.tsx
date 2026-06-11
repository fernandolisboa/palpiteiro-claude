"use client";

import Link from "next/link";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type NavLink = { href: string; label: string };

/**
 * Links de navegação do drawer mobile, espelhando a nav do `DesktopShell`
 * (mesmos labels/casing). O link de admin só aparece quando `isAdmin` — mesmo
 * gate do desktop (`session.user.role === "admin"`). Função pura (seam de teste
 * sem precisar de @testing-library), no estilo de `visibleLeagueTabs`.
 */
export function mobileNavLinks(isAdmin: boolean): NavLink[] {
  const links: NavLink[] = [
    { href: "/", label: "jogos" },
    { href: "/dashboard", label: "dashboard" },
  ];
  if (isAdmin) {
    links.push({ href: "/admin", label: "admin" });
  }
  return links;
}

export function MobileNav({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Abrir menu">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      {/* O primitivo SheetContent não tem padding interno — adicionamos aqui. */}
      <SheetContent side="left" className="w-64 p-4">
        {/* Radix Dialog exige um título pra a11y; não queremos exibi-lo. */}
        <SheetTitle className="sr-only">Navegação</SheetTitle>
        <nav className="flex flex-col gap-1 pt-2">
          {mobileNavLinks(isAdmin).map(({ href, label }) => (
            <SheetClose asChild key={href}>
              <Link
                href={href}
                className="flex min-h-11 items-center rounded-md px-3 py-3 text-[15px] tracking-tight text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {label}
              </Link>
            </SheetClose>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
