import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { cn } from "@/lib/utils";

export function BackLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  // Sobrescreve o espaçamento (ex.: `mb-0` na barra do jogo, ao lado do "criar bolão").
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "mb-6 inline-flex items-center gap-2 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
    >
      <ChevronLeft className="size-3.5" />
      <span className="text-body-sm tracking-tight">{label}</span>
    </Link>
  );
}
