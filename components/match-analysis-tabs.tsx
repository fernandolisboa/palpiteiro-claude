"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  GradeMyBet,
  type GradeMarketOption,
  type GradeMyBetPrefill,
} from "@/components/grade-my-bet";

// Aba na zona de análise (#412, ADR 0034): segmented [ Análise | Minha aposta ].
// `analysisSlot` é o <NeutralAnalysisDetail/> server-rendered passado como children
// (Server Component dentro de Client é OK no App Router). "Minha aposta" mostra o
// form + a leitura de valor inline. Só renderizado quando o jogo é analisável (a
// page gateia em `analyzable`) — em jogo não-analisável a aba nem aparece.

type GradeProps = {
  matchId: string;
  markets: GradeMarketOption[];
  prefill: GradeMyBetPrefill;
};

type Props = {
  analysisSlot: ReactNode;
  gradeProps: GradeProps;
};

type Tab = "analise" | "minha-aposta";

export function MatchAnalysisTabs({ analysisSlot, gradeProps }: Props) {
  const [tab, setTab] = useState<Tab>("analise");

  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label="modo de análise"
        className="inline-flex w-fit gap-1 rounded-md border border-border p-1"
      >
        <TabButton
          active={tab === "analise"}
          onClick={() => setTab("analise")}
        >
          Análise
        </TabButton>
        <TabButton
          active={tab === "minha-aposta"}
          onClick={() => setTab("minha-aposta")}
        >
          Minha aposta
        </TabButton>
      </div>

      {tab === "analise" ? (
        analysisSlot
      ) : (
        <GradeMyBet
          matchId={gradeProps.matchId}
          markets={gradeProps.markets}
          prefill={gradeProps.prefill}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "rounded-sm px-3 py-1.5 font-mono text-eyebrow uppercase tracking-label transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
