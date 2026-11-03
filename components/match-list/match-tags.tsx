import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MatchTagView } from "@/lib/view/match-tags";

// Etiquetas de mesa de amigos na linha do jogo (ADR 0070, #656): reta final, deu zebra,
// chocolate, azarão. Sem "use client" e sem dependência de servidor: usada pela MatchRow
// (server) e pela UpcomingMatchesDesktop (client). A regra está em lib/view/match-tags.ts;
// o `title` diz qual é.
export function MatchTags({ tags, className }: { tags: MatchTagView[]; className?: string }) {
  if (tags.length === 0) return null;
  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {tags.map((t) => (
        <Badge
          key={t.key}
          variant="outline"
          size="xs"
          title={t.title}
          data-tag={t.key}
          className="border-palpite-border/60 bg-palpite-soft/40 tracking-tight text-foreground"
        >
          {t.label}
        </Badge>
      ))}
    </span>
  );
}
