import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { PageHeading } from "@/components/admin/page-heading";

export const dynamic = "force-dynamic";

// Gateado por app/admin/layout.tsx (role === "admin" → notFound pra outros).
// Índice do admin: sem esta landing, `/admin` caía em 404 e as sub-rotas só eram
// alcançáveis por URL decorada (não há link público pra cá).
const SECTIONS = [
  {
    href: "/admin/users",
    title: "Usuários",
    desc: "auditar o tracking de qualquer usuário · busca por e-mail",
  },
  {
    href: "/admin/costs",
    title: "Custos de IA",
    desc: "gasto agregado · por dia, usuário, modelo · USD",
  },
  {
    href: "/admin/calibration",
    title: "Calibração",
    desc: "over/under · P(over) do modelo vs resultados · benchmark de mercado",
  },
  {
    href: "/admin/settings",
    title: "Configurações de IA",
    desc: "modelo de análise · default global",
  },
] as const;

export default function AdminIndexPage() {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <div className="mx-auto w-full max-w-reading px-6 py-8">
        <PageHeading
          backLink={{ href: "/", label: "jogos" }}
          title="Admin"
          subtitle="painel · acesso restrito a administradores"
        />

        <nav className="border-border rounded-md border">
          {SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="border-border hover:bg-surface-2 flex items-center justify-between gap-4 border-b px-4 py-3 transition-colors last:border-b-0 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              <div className="flex flex-col">
                <span className="text-body font-medium">{section.title}</span>
                <span className="text-muted-foreground font-mono text-eyebrow">
                  {section.desc}
                </span>
              </div>
              <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
