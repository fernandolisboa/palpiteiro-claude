import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

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
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-[640px] px-6 py-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 pb-6 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          <span className="text-[12.5px] tracking-tight">jogos</span>
        </Link>

        <h1 className="text-[20px] font-medium tracking-[-0.02em]">Admin</h1>
        <p className="pb-6 font-mono text-[11px] text-muted-foreground">
          painel · acesso restrito a administradores
        </p>

        <nav className="rounded-md border border-border">
          {SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-muted/50"
            >
              <div className="flex flex-col">
                <span className="text-[13px] font-medium">{section.title}</span>
                <span className="font-mono text-[10.5px] text-muted-foreground">
                  {section.desc}
                </span>
              </div>
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
