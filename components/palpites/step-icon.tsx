import { Check, Loader2, Minus, TriangleAlert } from "lucide-react";

import type { StepStatus } from "@/lib/ai/progress/protocol";
import { cn } from "@/lib/utils";

// Ícone de estado de uma etapa do run (linha do tempo do HERO e "Ver raciocínio").
export function StepIcon({ status }: { status: StepStatus }) {
  const base =
    "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border";
  if (status === "active") {
    return (
      <span
        aria-hidden="true"
        className={cn(base, "border-palpite-border bg-palpite-soft")}
      >
        {/* Gira sempre, inclusive com movimento reduzido (`palpite-spin`, globals.css):
            parado, um círculo com seta parece travado. */}
        <Loader2 className="palpite-spin size-3.5 animate-spin text-palpite-strong-fg" />
      </span>
    );
  }
  if (status === "done") {
    return (
      <span aria-hidden="true" className={cn(base, "border-palpite-border bg-palpite-soft")}>
        <Check
          key="done"
          className="size-3.5 animate-in text-palpite-strong-fg duration-300 ease-out zoom-in-50 motion-reduce:animate-none"
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(base, "border-dashed border-palpite-border/70 bg-background")}
    >
      {status === "failed" ? (
        <TriangleAlert className="size-3 text-muted-fg-2" />
      ) : (
        <Minus className="size-3 text-muted-fg-2" />
      )}
    </span>
  );
}
