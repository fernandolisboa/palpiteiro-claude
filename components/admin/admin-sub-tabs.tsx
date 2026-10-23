import { IntentLink } from "@/components/intent-link";

import { ADMIN_SECTIONS } from "@/lib/nav/menu";
import { cn } from "@/lib/utils";

/**
 * Seletor das abas internas de uma seção do admin (#633), lidas de `children` em
 * `ADMIN_SECTIONS`: "modelos | custos" no assistente de IA, "motor | calibração" no
 * motor. `current` é o href da aba desta página.
 */
export function AdminSubTabs({
  section,
  current,
}: {
  section: string;
  current: string;
}) {
  const tabs = ADMIN_SECTIONS.find((s) => s.href === section)?.children ?? [];
  if (tabs.length === 0) return null;
  return (
    <nav
      aria-label="Abas da seção"
      className="mb-8 inline-flex gap-0.5 rounded-md border border-border p-0.5"
    >
      {tabs.map(({ href, label }) => (
        <IntentLink
          key={href}
          href={href}
          aria-current={href === current ? "page" : undefined}
          className={cn(
            "rounded-sm px-3 py-1.5 text-body-sm tracking-tight text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            href === current && "bg-surface-2 text-foreground"
          )}
        >
          {label}
        </IntentLink>
      ))}
    </nav>
  );
}
