"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, ListChecks, BarChart2 } from "lucide-react";

type Tab = { id: string; href: string; label: string };

const tabs: Tab[] = [
  { id: "matches", href: "/matches", label: "jogos" },
  { id: "predictions", href: "/predictions", label: "predições" },
  { id: "dashboard", href: "/dashboard", label: "dashboard" },
];

const icons = {
  matches: CalendarClock,
  predictions: ListChecks,
  dashboard: BarChart2,
} as const;

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="s-bottomnav" aria-label="Navegação principal">
      {tabs.map((tab) => {
        const Icon = icons[tab.id as keyof typeof icons];
        const isActive =
          pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className="s-bottomnav__tab"
            aria-current={isActive ? "page" : undefined}
          >
            <Icon size={18} />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
