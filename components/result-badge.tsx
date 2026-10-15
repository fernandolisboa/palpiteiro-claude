import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { RESULT_LABEL, type ResultState } from "@/lib/view/result-state";

// Selo único de resultado (ADR 0056): /apostas, palpite (inclusive /p), bolão e
// desempenho. Cores da família form-* (a mesma do FormDot) e sempre com a palavra:
// a cor nunca é o único sinal. "Em aberto" fica neutro, sem preenchimento.
const TONE: Record<ResultState, string> = {
  won: "border-transparent bg-form-win-bg text-form-win-fg",
  lost: "border-transparent bg-form-loss-bg text-form-loss-fg",
  push: "border-transparent bg-form-draw-bg text-form-draw-fg",
  void: "border-transparent bg-form-draw-bg text-form-draw-fg",
  pending: "border-border bg-transparent text-muted-foreground",
};

export function ResultBadge({
  result,
  size = "xs",
  className,
}: {
  result: ResultState;
  size?: "xs" | "sm";
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      size={size}
      data-result={result}
      className={cn("tracking-tight", TONE[result], className)}
    >
      {RESULT_LABEL[result]}
    </Badge>
  );
}
