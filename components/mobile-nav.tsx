"use client";

import Link from "next/link";
import { Menu } from "lucide-react";

import { signOutAction } from "@/app/actions/auth";
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
 * Links de navegação do drawer mobile. As entradas de jogos/dashboard/como
 * funciona/admin espelham a nav do `DesktopShell` (mesmos labels/casing, mesmo
 * gate de admin via `session.user.role === "admin"`). O link de perfil aparece
 * SEMPRE, ao final: no desktop o perfil é o avatar separado no canto direito
 * (fora da `<nav>`); no mobile ele entra como link de nav pra ficar alcançável
 * no drawer — divergência intencional. Função pura (seam de teste sem precisar
 * de @testing-library), no estilo de `visibleLeagueTabs`.
 */
export function mobileNavLinks(isAdmin: boolean): NavLink[] {
  const links: NavLink[] = [
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

// Estilo compartilhado entre os links de nav e o botão "sair", pra que as duas
// linhas (Link e <button>) permaneçam visualmente idênticas e não divirjam num
// refactor futuro. `min-h-11` garante o alvo de toque de 44px. O botão acrescenta
// `w-full text-left` (só ele precisa, por ser <button> e não <a> inline).
const navRowClass =
  "flex min-h-11 items-center rounded-md px-3 py-3 text-[15px] tracking-tight text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

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
              <Link href={href} className={navRowClass}>
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
            <button type="submit" className={`${navRowClass} w-full text-left`}>
              sair
            </button>
          </form>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
