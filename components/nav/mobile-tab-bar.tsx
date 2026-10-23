"use client";

import { useEffect, useState, type ReactNode } from "react";
import { IntentLink } from "@/components/intent-link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ChartLine,
  ChevronRight,
  Ellipsis,
  Ticket,
  Users,
  type LucideIcon,
} from "lucide-react";

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  activeItemHref,
  ADMIN_SECTIONS,
  ariaCurrentFor,
  HELP_NAV,
  PRIMARY_NAV,
  type NavItem,
} from "@/lib/nav/menu";

const TAB_ICON: Record<string, LucideIcon> = {
  "/jogos": CalendarDays,
  "/apostas": Ticket,
  "/bolao": Users,
  "/dashboard": ChartLine,
};

/**
 * Conteúdo da folha do "mais" (#633): ajuda pra todos; admin (visão geral + seções)
 * só pra admin. Perfil e sair ficam no avatar, sem repetir aqui. Função pura (seam de
 * teste sem @testing-library).
 */
export function moreSheetSections(isAdmin: boolean): {
  help: readonly NavItem[];
  admin: { overview: NavItem; sections: readonly NavItem[] } | null;
} {
  return {
    help: HELP_NAV.items,
    admin: isAdmin
      ? { overview: { href: "/admin", label: "visão geral" }, sections: ADMIN_SECTIONS }
      : null,
  };
}

const DESKTOP_QUERY = "(min-width: 1024px)";

const TAB =
  "flex min-w-0 flex-col items-center justify-center gap-1 text-meta tracking-tight text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 aria-[current]:text-foreground data-[active=true]:text-foreground";

/**
 * Barra de abas do celular (#633): as quatro telas de uso a um toque, na altura do
 * polegar, e o "mais" com ajuda e admin numa folha curta. Substitui o drawer ☰.
 * `data-mobile-tabbar` liga, no globals.css, o respiro no fim do <body> (o rodapé não
 * fica atrás da barra) e a variável que sobe o que é fixo na base (barra de Suas
 * apostas, aviso de versão nova) pra cima dela.
 */
export function MobileTabBar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const active = activeItemHref(pathname, PRIMARY_NAV);
  const more = moreSheetSections(isAdmin);
  const moreItems = [
    ...more.help,
    ...(more.admin ? [more.admin.overview, ...more.admin.sections] : []),
  ];
  const moreActive = activeItemHref(pathname, moreItems);
  const [moreOpen, setMoreOpen] = useState(false);

  // A folha é só do celular: se a tela cruza pro computador com ela aberta (girou o
  // tablet, esticou a janela), fecha; a barra some e o menu está no header.
  useEffect(() => {
    if (!moreOpen) return;
    const mq = window.matchMedia?.(DESKTOP_QUERY);
    if (!mq) return;
    if (mq.matches) {
      setMoreOpen(false);
      return;
    }
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMoreOpen(false);
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [moreOpen]);

  return (
      <nav
        aria-label="Navegação principal"
        data-tour="menu"
        data-mobile-tabbar=""
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden"
      >
        <div className="grid h-14 grid-cols-5">
          {PRIMARY_NAV.map((item) => {
            const Icon = TAB_ICON[item.href];
            return (
              <IntentLink
                key={item.href}
                href={item.href}
                aria-current={
                  item.href === active ? ariaCurrentFor(pathname, item.href) : undefined
                }
                className={TAB}
              >
                {Icon && <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />}
                <span className="max-w-full truncate">{item.shortLabel ?? item.label}</span>
              </IntentLink>
            );
          })}
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger
              data-active={moreActive ? "true" : undefined}
              className={TAB}
            >
              <Ellipsis aria-hidden="true" className="size-5" strokeWidth={1.75} />
              <span>mais</span>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              className="max-h-[85dvh] gap-5 overflow-y-auto rounded-t-xl px-4 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            >
              <SheetTitle className="sr-only">Mais</SheetTitle>
              <MoreSection label="ajuda">
                <div className="flex flex-col">
                  {more.help.map(({ href, label }) => (
                    <SheetClose asChild key={href}>
                      <IntentLink
                        href={href}
                        aria-current={
                          href === moreActive ? ariaCurrentFor(pathname, href) : undefined
                        }
                        className="flex min-h-11 items-center justify-between border-b border-border-subtle px-1 text-label tracking-tight text-muted-foreground last:border-b-0 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current]:text-foreground"
                      >
                        {label}
                        <ChevronRight aria-hidden="true" className="size-4" />
                      </IntentLink>
                    </SheetClose>
                  ))}
                </div>
              </MoreSection>
              {more.admin && (
                <MoreSection
                  label="admin"
                  action={
                    <SheetClose asChild>
                      <IntentLink
                        href={more.admin.overview.href}
                        aria-current={
                          moreActive === more.admin.overview.href
                            ? ariaCurrentFor(pathname, more.admin.overview.href)
                            : undefined
                        }
                        className="rounded-sm text-body-sm tracking-tight text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current]:text-foreground"
                      >
                        {more.admin.overview.label} ›
                      </IntentLink>
                    </SheetClose>
                  }
                >
                  <div className="grid grid-cols-2 gap-2">
                    {more.admin.sections.map(({ href, label, description }) => (
                      <SheetClose asChild key={href}>
                        <IntentLink
                          href={href}
                          aria-current={
                            href === moreActive ? ariaCurrentFor(pathname, href) : undefined
                          }
                          className="flex min-h-16 flex-col justify-center gap-0.5 rounded-md border border-border px-3 py-2.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current]:border-foreground"
                        >
                          <span className="text-body-sm font-medium tracking-tight">
                            {label}
                          </span>
                          {description && (
                            <span className="line-clamp-2 text-meta text-muted-foreground">
                              {description}
                            </span>
                          )}
                        </IntentLink>
                      </SheetClose>
                    ))}
                  </div>
                </MoreSection>
              )}
            </SheetContent>
          </Sheet>
        </div>
      </nav>
  );
}

function MoreSection({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-meta uppercase tracking-eyebrow text-muted-foreground">
          {label}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
