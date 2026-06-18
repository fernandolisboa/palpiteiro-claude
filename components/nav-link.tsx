"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Estilo compartilhado de link de nav (ADR 0029): foco visível + estado ativo
 * via `aria-[current=page]`. Duas formas: `inline` (nav do desktop-shell) e
 * `row` (linhas do drawer mobile). O `mobile-nav` reusa só `navLinkVariants`
 * (pra não brigar com o `SheetClose asChild`); o desktop usa o `NavLink`.
 */
const navLinkVariants = cva(
  "transition-colors focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
  {
    variants: {
      variant: {
        inline:
          "text-body-sm tracking-tight text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground",
        row: "flex min-h-11 items-center rounded-md px-3 py-3 text-label tracking-tight text-muted-foreground hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground",
      },
    },
    defaultVariants: {
      variant: "inline",
    },
  }
);

/**
 * True se `href` é a rota ativa: raiz casa exata; o resto casa exato OU como
 * prefixo delimitado por "/" (ex.: "/dashboard" ativa "/dashboard/123", mas NÃO
 * "/dashboard-foo" — sem o boundary, startsWith daria falso-positivo).
 */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

type Props = ComponentProps<typeof Link> & VariantProps<typeof navLinkVariants>;

export function NavLink({ href, variant, className, children, ...props }: Props) {
  const pathname = usePathname();
  const active = isActivePath(pathname, String(href));
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(navLinkVariants({ variant }), className)}
      {...props}
    >
      {children}
    </Link>
  );
}

export { navLinkVariants };
