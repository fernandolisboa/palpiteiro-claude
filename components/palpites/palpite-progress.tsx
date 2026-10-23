import { ParrotMascot } from "@/components/brand/parrot-mascot";
import { PalpiteBot } from "@/components/palpites/palpite-bot";
import { ReasoningButton } from "@/components/palpites/reasoning-dialog";
import { StepIcon } from "@/components/palpites/step-icon";
import type { StepStatus } from "@/lib/ai/progress/protocol";
import type { ProgressMascot } from "@/lib/brand/progress-mascot";
import { cn } from "@/lib/utils";

export type ProgressStepView = {
  id: string;
  status: StepStatus;
  label: string;
  detail?: string[];
};

/**
 * Linha do tempo do run do HERO (ADR 0064): cada etapa que DE FATO rodou no servidor,
 * na ordem em que começou, com o estado atual. Etapas em paralelo (mercados do fan-out)
 * giram juntas. Quem chama passa a casca (WarmShell) e o kicker.
 *
 * Motion (DESIGN.md): o robozinho (palpite-bot.tsx) ou o papagaio (parrot-mascot.tsx),
 * conforme a flag `progressMascot` (ADR 0068), ao lado do título; entrada curta de cada
 * linha (fade + 4px), o check entra com um zoom curto, o ícone da etapa em andamento gira.
 * Sem brilho nem gradiente. Com prefers-reduced-motion nada se desloca: os olhos do
 * personagem só respiram (`palpite-calm`) e o spinner segue girando (`palpite-spin`).
 *
 * FIREWALL (ADR 0030 §3): as frases vêm prontas do servidor (lib/ai/progress/steps.ts),
 * sem odd, edge, stake, % ou nome de casa.
 */
export function PalpiteProgress({
  title,
  hint,
  steps,
  waitingLabel,
  onShowReasoning,
  mascot = "robo",
}: {
  title: string;
  hint: string;
  steps: ProgressStepView[];
  // Linha enquanto nenhuma etapa chegou (o pedido está a caminho).
  waitingLabel: string;
  // Abre o "Ver raciocínio" (ADR 0065). Ausente = sem botão.
  onShowReasoning?: () => void;
  mascot?: ProgressMascot;
}) {
  const rows: ProgressStepView[] =
    steps.length > 0 ? steps : [{ id: "waiting", status: "active", label: waitingLabel }];
  const current =
    [...rows].reverse().find((s) => s.status === "active") ?? rows[rows.length - 1];
  const doneCount = steps.filter((s) => s.status === "done").length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {mascot === "papagaio" ? (
          <ParrotMascot beat={doneCount} />
        ) : (
          <PalpiteBot beat={doneCount} />
        )}
        <div className="flex flex-col gap-1">
          <p className="text-display-sm font-medium tracking-tight text-foreground">
            {title}
          </p>
          <p className="text-body-sm tracking-tight text-muted-foreground">{hint}</p>
        </div>
      </div>
      <ol aria-label="etapas da análise" className="flex flex-col">
        {rows.map((step, i) => (
          <StepRow key={step.id} step={step} last={i === rows.length - 1} />
        ))}
      </ol>
      <p role="status" className="sr-only">
        {current.label}
      </p>
      {onShowReasoning && steps.length > 0 && (
        <ReasoningButton onClick={onShowReasoning} />
      )}
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
