import { Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Selo "analisado" da lista de jogos (#577): o usuário já rodou a análise deste
// jogo. Palavra sempre presente (o ícone sozinho não diz nada). Aparece também em
// jogo encerrado já analisado (#99): o resultado segue na página do jogo.
export function AnalyzedBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      size="xs"
      className={cn("border-accent-border bg-accent-soft text-accent-fg", className)}
    >
      <Check aria-hidden="true" className="size-3" />
      analisado
    </Badge>
  );
}
