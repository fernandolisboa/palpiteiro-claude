"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarClock,
  ListChecks,
  BarChart2,
  Settings2,
} from "lucide-react";
import { BrandMark } from "@/components/ui/brand-mark";

const tabs = [
  { id: "matches", href: "/matches", label: "Jogos", icon: CalendarClock },
  { id: "predictions", href: "/predictions", label: "Predições", icon: ListChecks },
  { id: "dashboard", href: "/dashboard", label: "Dashboard", icon: BarChart2 },
] as const;

export function SideNav() {
  const pathname = usePathname();
  return (
    <aside className="s-sidenav" aria-label="Navegação">
      <div className="s-sidenav__brand">
        <BrandMark size={16} accent />
      </div>
      {tabs.map((tab) => {
        const isActive =
          pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className="s-sidenav__tab"
            aria-current={isActive ? "page" : undefined}
          >
            <Icon size={15} />
            <span>{tab.label}</span>
          </Link>
        );
      })}
      <div style={{ flex: 1 }} />
      <Link href="/settings" className="s-sidenav__tab">
        <Settings2 size={15} />
        <span>Ajustes</span>
      </Link>
    </aside>
  );
}
