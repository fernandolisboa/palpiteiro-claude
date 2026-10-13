import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { PageHeading } from "@/components/admin/page-heading";
import { ADMIN_SECTIONS } from "@/lib/nav/menu";

export const dynamic = "force-dynamic";

// Gateado por app/(app)/admin/layout.tsx (role === "admin" → notFound pra outros).
// Índice do admin; as mesmas seções estão no menu "admin" do header (lib/nav/menu.ts).
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default function AdminIndexPage() {
  return (
    <div className="bg-background text-foreground">
      <div className="mx-auto w-full max-w-reading px-6 py-8">
        <PageHeading
          title="Admin"
          subtitle="painel · acesso restrito a administradores"
        />

        <nav className="border-border rounded-md border">
          {ADMIN_SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="border-border hover:bg-surface-2 flex items-center justify-between gap-4 border-b px-4 py-3 transition-colors last:border-b-0 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              <div className="flex flex-col">
                <span className="text-body font-medium">{capitalize(section.label)}</span>
                <span className="text-muted-foreground font-mono text-eyebrow">
                  {section.description}
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
