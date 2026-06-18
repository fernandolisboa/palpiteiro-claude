"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { isActivePath, navLinkVariants } from "@/components/nav-link";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type NavLinkItem = { href: string; label: string };

/**
 * Links de navegação do drawer mobile. As entradas de jogos/dashboard/como
 * funciona/admin espelham a nav do `DesktopShell` (mesmos labels/casing, mesmo
 * gate de admin via `session.user.role === "admin"`). O link de perfil aparece
 * SEMPRE, ao final: no desktop o perfil é o avatar separado no canto direito
 * (fora da `<nav>`); no mobile ele entra como link de nav pra ficar alcançável
 * no drawer — divergência intencional. Função pura (seam de teste sem precisar
 * de @testing-library), no estilo de `visibleLeagueTabs`.
 */
export function mobileNavLinks(isAdmin: boolean): NavLinkItem[] {
  const links: NavLinkItem[] = [
    { href: "/", label: "jogos" },
    { href: "/dashboard", label: "dashboard" },
    { href: "/como-funciona", label: "como funciona" },
  ];
  if (isAdmin) {
    links.push({ href: "/admin", label: "admin" });
  }
  links.push({ href: "/perfil", label: "perfil" });
  return links;
}

export function MobileNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

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
        <nav
          aria-label="Navegação principal"
          className="flex flex-col gap-1 pt-2"
        >
          {mobileNavLinks(isAdmin).map(({ href, label }) => (
            <SheetClose asChild key={href}>
              <Link
                href={href}
                aria-current={isActivePath(pathname, href) ? "page" : undefined}
                className={navLinkVariants({ variant: "row" })}
              >
                {label}
              </Link>
            </SheetClose>
          ))}
          {/*
            "sair" é uma action, não um link de navegação — fica fora do array
            puro `mobileNavLinks` e renderiza como <form>. NÃO envolvemos em
            `SheetClose`: um `signOut` bem-sucedido redireciona pra "/signin",
            desmontando a árvore inteira (incl. o Sheet), então fechar é
            automático no sucesso. Envolver arriscaria o close do Radix
            (onOpenChange(false)) desmontar antes do dispatch da action.
          */}
          <form action={signOutAction}>
            <button
              type="submit"
              className={`${navLinkVariants({ variant: "row" })} w-full text-left`}
            >
              sair
            </button>
          </form>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
