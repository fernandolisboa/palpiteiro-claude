"use client";

import { ListTree } from "lucide-react";

import type { ProgressStepView } from "@/components/palpites/palpite-progress";
import { StepIcon } from "@/components/palpites/step-icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Botão do HERO que abre o raciocínio. type="button": fica dentro do form do HERO e
// não pode disparar o run.
export function ReasoningButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={onClick}
      className="self-start text-palpite-strong-fg hover:bg-palpite-soft"
    >
      <ListTree className="size-3.5" /> Ver raciocínio
    </Button>
  );
}

/**
 * "Ver raciocínio" (ADR 0065): cada etapa que rodou na análise e o que ela encontrou. Um
 * só diálogo pro HERO inteiro (montado fora do corpo), então ele segue aberto quando o
 * run termina e troca as etapas ao vivo pelas gravadas com o palpite.
 *
 * FIREWALL (ADR 0030 §3): as frases vêm prontas do servidor (lib/ai/progress/steps.ts e
 * details.ts), sem odd, edge, stake, % ou nome de casa.
 */
export function ReasoningDialog({
  open,
  onOpenChange,
  steps,
  running,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  steps: readonly ProgressStepView[];
  running: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-display-sm font-medium tracking-tight">
            Raciocínio da análise
          </DialogTitle>
          <DialogDescription className="text-body-sm tracking-tight">
            {running
              ? "Cada etapa aparece aqui assim que acontece, com o que ela encontrou."
              : "As etapas que rodaram nesta análise e o que cada uma encontrou."}
          </DialogDescription>
        </DialogHeader>
        <ol aria-label="raciocínio da análise" className="flex flex-col gap-4">
          {steps.map((step) => (
            <li key={step.id} data-status={step.status} className="flex items-start gap-3">
              <StepIcon status={step.status} />
              <div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
                <p
                  className={cn(
                    "text-body leading-snug tracking-tight",
                    step.status === "failed" || step.status === "skipped"
                      ? "text-muted-fg-2"
                      : "text-foreground",
                  )}
                >
                  {step.label}
                </p>
                {step.detail && step.detail.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {step.detail.map((line) => (
                      <li
                        key={line}
                        className="relative pl-3 text-body-sm leading-snug tracking-tight text-muted-foreground before:absolute before:top-[0.55em] before:left-0 before:size-1 before:rounded-full before:bg-palpite-border"
                      >
                        {line}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
        <p className="border-t pt-3 text-meta tracking-tight text-muted-foreground">
          Os números completos de cada mercado ficam na aba Mercados.
        </p>
      </DialogContent>
    </Dialog>
  );
}
