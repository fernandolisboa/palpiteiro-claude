"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { signOutAction } from "@/app/actions/auth";
import { UserAvatar } from "@/components/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ACCOUNT_NAV } from "@/lib/nav/menu";
import { userInitials } from "@/lib/view/initials";

export type Viewer = {
  label: string;
  email: string | null;
  image: string | null;
  isAdmin: boolean;
};

/** Menu da conta no avatar: perfil e sair. O nome só aparece por extenso no computador. */
export function AccountMenu({ viewer }: { viewer: Viewer }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:text-foreground"
      >
        <UserAvatar
          initials={userInitials(viewer.label)}
          hue={258}
          size={26}
          src={viewer.image}
        />
        {/* Nome visível no computador é o nome acessível; no celular só há o avatar. */}
        <span className="sr-only lg:not-sr-only lg:inline-block lg:max-w-48 lg:truncate lg:text-body-sm lg:tracking-tight lg:text-foreground">
          {viewer.label || "conta"}
        </span>
        <ChevronDown aria-hidden="true" className="hidden size-3.5 lg:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate text-body-sm font-medium tracking-tight">
            {viewer.label || "conta"}
          </span>
          {viewer.email && viewer.email !== viewer.label && (
            <span className="truncate text-meta text-muted-foreground">
              {viewer.email}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ACCOUNT_NAV.map(({ href, label }) => (
          <DropdownMenuItem key={href} asChild>
            <Link href={href}>{label}</Link>
          </DropdownMenuItem>
        ))}
        {/* Sair é server action. `preventDefault` no select segura o menu aberto: fechar
            desmontaria o <form> do portal antes do dispatch da action. O redirect pra
            /signin desmonta tudo em seguida. */}
        <form action={signOutAction}>
          <DropdownMenuItem asChild onSelect={(event) => event.preventDefault()}>
            <button type="submit" className="w-full text-left">
              sair
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
