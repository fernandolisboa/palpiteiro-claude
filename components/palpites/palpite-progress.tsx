import { Check, Loader2, Minus, TriangleAlert } from "lucide-react";

import type { StepStatus } from "@/lib/ai/progress/protocol";
import { cn } from "@/lib/utils";

export type ProgressStepView = { id: string; status: StepStatus; label: string };

/**
 * Linha do tempo do run do HERO (ADR 0064): cada etapa que DE FATO rodou no servidor,
 * na ordem em que começou, com o estado atual. Etapas em paralelo (mercados do fan-out)
 * giram juntas. Quem chama passa a casca (WarmShell) e o kicker.
 *
 * Motion (DESIGN.md): entrada curta de cada linha (fade + 4px), o check entra com um
 * zoom curto, o ícone da etapa em andamento gira. Sem brilho, gradiente ou piscada; com
 * prefers-reduced-motion tudo vira instantâneo (globals.css + motion-reduce:).
 *
 * FIREWALL (ADR 0030 §3): as frases vêm prontas do servidor (lib/ai/progress/steps.ts),
 * sem odd, edge, stake, % ou nome de casa.
 */
export function PalpiteProgress({
  title,
  hint,
  steps,
  waitingLabel,
}: {
  title: string;
  hint: string;
  steps: ProgressStepView[];
  // Linha enquanto nenhuma etapa chegou (o pedido está a caminho).
  waitingLabel: string;
}) {
  const rows: ProgressStepView[] =
    steps.length > 0 ? steps : [{ id: "waiting", status: "active", label: waitingLabel }];
  const current =
    [...rows].reverse().find((s) => s.status === "active") ?? rows[rows.length - 1];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-display-sm font-medium tracking-tight text-foreground">
          {title}
        </p>
        <p className="text-body-sm tracking-tight text-muted-foreground">{hint}</p>
      </div>
      <ol aria-label="etapas da análise" className="flex flex-col">
        {rows.map((step, i) => (
          <StepRow key={step.id} step={step} last={i === rows.length - 1} />
        ))}
      </ol>
      <p role="status" className="sr-only">
        {current.label}
      </p>
    </div>
  );
}

function StepRow({ step, last }: { step: ProgressStepView; last: boolean }) {
  return (
    <li
      data-status={step.status}
      className="relative flex animate-in items-start gap-3 pb-3 duration-300 ease-out fade-in slide-in-from-bottom-1 last:pb-0 motion-reduce:animate-none"
    >
      {!last && (
        <span
          aria-hidden="true"
          className="absolute top-6 bottom-0 left-[11px] w-px bg-palpite-border/60"
        />
      )}
      <StepIcon status={step.status} />
      <span
        className={cn(
          "pt-0.5 text-body leading-snug tracking-tight",
          step.status === "active" && "text-foreground",
          step.status === "done" && "text-muted-foreground",
          (step.status === "failed" || step.status === "skipped") && "text-muted-fg-2",
        )}
      >
        {step.label}
      </span>
    </li>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  const base =
    "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border";
  if (status === "active") {
    return (
      <span aria-hidden="true" className={cn(base, "border-palpite-border bg-palpite-soft")}>
        <Loader2 className="size-3.5 animate-spin text-palpite-strong-fg motion-reduce:animate-none" />
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
