import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 pb-6 text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="size-3.5" />
      <span className="text-[12.5px] tracking-tight">{label}</span>
    </Link>
  );
}
