"use client";

import { useEffect, useRef } from "react";
import { Check, Loader2, Minus, TriangleAlert } from "lucide-react";

import {
  PalpiteProgress,
  type ProgressStepView,
} from "@/components/palpites/palpite-progress";
import {
  ROW_FOCUS,
  type RowAnalysis,
} from "@/components/match-list/row-analyze";
import { TeamCrest } from "@/components/team-crest";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import type { ProgressMascot } from "@/lib/brand/progress-mascot";
import { cn } from "@/lib/utils";
import type { Team } from "@/lib/view/types";

// O andamento do run da linha de /jogos: o letreiro no meio da linha (desktop), a linha
// do tempo inteira num popover ("ver progresso") e numa folha de baixo (celular).

export type RowTeams = { home: Team; away: Team };

const HINT = "Pode sair da lista: a análise segue e aparece no jogo.";
const WAITING = "Começando a análise…";

/** "Analisando o jogo [escudo] x [escudo]": diz de qual jogo é a linha do tempo aberta. */
function ProgressTitle({ teams }: { teams: RowTeams }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      Analisando o jogo
      <span
        className="inline-flex items-center gap-1.5"
        title={`${teams.home.fullName ?? teams.home.name} x ${teams.away.fullName ?? teams.away.name}`}
      >
        <TeamCrest team={teams.home} size={24} />
        <span className="text-muted-foreground">x</span>
        <TeamCrest team={teams.away} size={24} />
      </span>
      <span className="sr-only">
        {teams.home.name} x {teams.away.name}
      </span>
    </span>
  );
}

function Timeline({
  steps,
  teams,
  mascot,
}: {
  steps: ProgressStepView[];
  teams: RowTeams;
  mascot?: ProgressMascot;
}) {
  return (
    <PalpiteProgress
      title={<ProgressTitle teams={teams} />}
      hint={HINT}
      steps={steps}
      waitingLabel={WAITING}
      mascot={mascot}
    />
  );
}

function TickerIcon({ status }: { status: ProgressStepView["status"] }) {
  const base = "size-3 shrink-0";
  if (status === "active") {
    return (
      <Loader2
        aria-hidden="true"
        className={cn(base, "palpite-spin text-palpite-strong-fg animate-spin")}
      />
    );
  }
  if (status === "done") {
    return (
      <Check
        aria-hidden="true"
        className={cn(base, "text-palpite-strong-fg")}
      />
    );
  }
  if (status === "failed") {
    return (
      <TriangleAlert
        aria-hidden="true"
        className={cn(base, "text-muted-fg-2")}
      />
    );
  }
  return <Minus aria-hidden="true" className={cn(base, "text-muted-fg-2")} />;
}

/**
 * Desktop: o andamento no meio da linha, entre os times e as odds. As etapas sobem como
 * num letreiro (rolagem suave até a última, barra invisível) e somem no alto com um
 * degradê; "ver progresso" abre a linha do tempo inteira, a mesma do jogo. Com o
 * popover aberto a linha fica marcada (`data-progress-trigger`, ver a linha da lista).
 * A rolagem anda mesmo com "reduzir movimento" do sistema, como o spinner (pedido do
 * Fernando, que usa o Windows com animações desligadas).
 */
export function RowProgressTicker({
  state,
  teams,
  mascot,
  className,
}: {
  state: RowAnalysis;
  teams: RowTeams;
  mascot?: ProgressMascot;
  className?: string;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const steps = state.kind === "running" ? state.steps : [];
  const last =
    steps.length > 0 ? `${steps.length}:${steps[steps.length - 1].status}` : "";
  useEffect(() => {
    const el = listRef.current;
    // `scrollTo` falta em ambientes sem layout (jsdom).
    if (el && typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [last]);

  if (state.kind === "error") {
    return (
      <p
        role="status"
        title={state.message}
        className={cn(
          "text-meta text-destructive relative z-10 line-clamp-2 tracking-tight",
          className
        )}
      >
        {state.message}
      </p>
    );
  }
  if (state.kind !== "running") return null;
  const rows: ProgressStepView[] =
    steps.length > 0
      ? steps
      : [{ id: "waiting", status: "active", label: WAITING }];
  return (
    <div
      className={cn("relative z-10 flex min-w-0 items-end gap-3", className)}
    >
      <ol
        ref={listRef}
        aria-label="etapas da análise"
        className={cn(
          "flex h-[54px] min-w-0 flex-1 flex-col overflow-y-auto pt-9",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "[mask-image:linear-gradient(to_bottom,transparent,black_55%)]"
        )}
      >
        {rows.map((step) => (
          <li
            key={step.id}
            className={cn(
              "animate-in text-meta fade-in flex h-[18px] shrink-0 items-center gap-1.5 tracking-tight duration-500 ease-out",
              step.status === "active"
                ? "text-foreground"
                : "text-muted-foreground"
            )}
          >
            <TickerIcon status={step.status} />
            <span className="truncate" title={step.label}>
              {step.label}
            </span>
          </li>
        ))}
      </ol>
      <p role="status" className="sr-only">
        {rows.findLast((s) => s.status === "active")?.label ??
          rows[rows.length - 1].label}
      </p>
      <Popover>
        <PopoverTrigger
          data-progress-trigger=""
          className={cn(
            "text-meta text-muted-foreground hover:text-foreground data-[state=open]:text-palpite-strong-fg shrink-0 cursor-pointer rounded-sm tracking-tight underline-offset-2 hover:underline data-[state=open]:underline",
            ROW_FOCUS
          )}
        >
          ver progresso
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[380px] p-4">
          <Timeline steps={steps} teams={teams} mascot={mascot} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Celular: as etapas numa folha de baixo, aberta pelo "analisando". */
export function RowProgressSheet({
  state,
  teams,
  mascot,
  open,
  onOpenChange,
}: {
  state: RowAnalysis;
  teams: RowTeams;
  mascot?: ProgressMascot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const steps = state.kind === "running" ? state.steps : [];
  return (
    <Sheet open={open && state.kind === "running"} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-xl px-5 pt-5 pb-8">
        <SheetTitle className="sr-only">
          Analisando {teams.home.name} x {teams.away.name}
        </SheetTitle>
        <SheetDescription className="sr-only">{HINT}</SheetDescription>
        <Timeline steps={steps} teams={teams} mascot={mascot} />
      </SheetContent>
    </Sheet>
  );
}
