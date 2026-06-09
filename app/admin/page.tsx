import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

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
    href: "/admin/invites",
    title: "Convidar Usuários",
    desc: "whitelist · autoriza login sem redeploy",
  },
  {
    href: "/admin/costs",
    title: "Custos de IA",
    desc: "gasto agregado · por dia, usuário, modelo · USD",
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
      <div className="mx-auto w-full max-w-[640px] px-6 py-8">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 pb-6"
        >
          <ChevronLeft className="size-3.5" />
          <span className="text-[12.5px] tracking-tight">jogos</span>
        </Link>

        <h1 className="text-[20px] font-medium tracking-[-0.02em]">Admin</h1>
        <p className="text-muted-foreground pb-6 font-mono text-[11px]">
          painel · acesso restrito a administradores
        </p>

        <nav className="border-border rounded-md border">
          {SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="border-border hover:bg-surface-2 flex items-center justify-between gap-4 border-b px-4 py-3 transition-colors last:border-b-0"
            >
              <div className="flex flex-col">
                <span className="text-[13px] font-medium">{section.title}</span>
                <span className="text-muted-foreground font-mono text-[10.5px]">
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
