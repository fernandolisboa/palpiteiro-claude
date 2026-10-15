import Link from "next/link";

import { appendBackParam } from "@/lib/view/back-href";
import { LEAGUE_LABEL } from "@/lib/format";
import type { RecentMatchView } from "@/lib/view/types";

function marketsLabel(n: number): string {
  return n === 1 ? "1 mercado" : `${n} mercados`;
}

// "Suas predições recentes", um cartão por jogo (ADR 0058, #577): liga e data do
// jogo, as siglas, até duas apostas (mercado, seleção e vantagem) e quantos mercados
// ficaram sem aposta. "PASS" não aparece: é "Sem aposta" (ADR 0056).
export function RecentPredCard({
  p,
  listHref,
}: {
  p: RecentMatchView;
  // URL filtrada da lista (/jogos?…) → preserva o estado de busca ao voltar.
  listHref?: string;
}) {
  return (
    <Link
      href={appendBackParam(`/match/${p.matchId}`, listHref, "/jogos")}
      className="flex min-w-[200px] max-w-[240px] shrink-0 flex-col gap-2 rounded-lg border border-border bg-card px-3 py-3 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-w-0 lg:max-w-none"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-meta uppercase tracking-label text-muted-foreground">
          {LEAGUE_LABEL[p.league]}
        </span>
        <span className="shrink-0 font-mono text-meta tabular-nums text-muted-foreground">
          {p.when}
        </span>
      </div>
      <div className="text-label font-medium tracking-tight">
        {p.home} <span className="text-muted-foreground">×</span> {p.away}
      </div>
      {p.bets.map((bet, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <span className="truncate text-meta text-muted-foreground">{bet.market}</span>
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-body-sm font-medium text-accent-fg">
              {bet.rec}
            </span>
            {bet.edge && (
              <span className="shrink-0 text-meta text-edge-fg">
                vantagem <span className="tabular-nums">{bet.edge}</span>
              </span>
            )}
          </div>
        </div>
      ))}
      {(p.moreBets > 0 || p.passCount > 0) && (
        <div className="mt-auto flex flex-col gap-0.5 text-meta text-muted-foreground">
          {p.moreBets > 0 && (
            <span>
              +{p.moreBets} {p.moreBets === 1 ? "aposta" : "apostas"}
            </span>
          )}
          {p.passCount > 0 && (
            <span>
              {p.bets.length === 0
                ? `Sem aposta em ${marketsLabel(p.passCount)}`
                : `${marketsLabel(p.passCount)} sem aposta`}
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
