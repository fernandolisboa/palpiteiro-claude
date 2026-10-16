import { Card } from "@/components/ui/card";
import type { SlipLedgerSummary } from "@/lib/bets/slip-ledger";
import { formatUnitsSigned } from "@/lib/format";
import { cn } from "@/lib/utils";

// Resumo de /apostas (#577): em aberto, acertos e saldo em unidades. É o histórico
// do próprio usuário (privado), não desempenho do app (ADR 0048 D4). Acertos e saldo
// são só de pré-jogo; as ao vivo têm linha própria embaixo (#580, PLAN-580 §11).

const LABEL = "text-meta uppercase tracking-label text-muted-foreground";
const VALUE =
  "whitespace-nowrap text-display-sm font-medium leading-none tracking-tight sm:text-display-xs";

function balanceTone(units: number): string {
  if (units > 0) return "text-edge-fg";
  if (units < 0) return "text-destructive";
  return "text-foreground";
}

function LiveLine({ live }: { live: NonNullable<SlipLedgerSummary["live"]> }) {
  const settled = live.won + live.lost;
  const num = "font-mono tabular-nums text-foreground";
  return (
    <p className="text-meta text-muted-foreground">
      ao vivo, fora dos números acima:{" "}
      {settled === 0 ? (
        <>
          <span className={num}>{live.total}</span>{" "}
          {live.total === 1 ? "aposta" : "apostas"}, sem resultado ainda
        </>
      ) : (
        <>
          <span className={num}>{live.won}</span> de{" "}
          <span className={num}>{settled}</span> acertos
          {live.settledWithStake > 0 && (
            <>
              {" · "}
              <span
                className={cn("font-mono tabular-nums", balanceTone(live.balanceUnits))}
              >
                {formatUnitsSigned(live.balanceUnits)}
              </span>
            </>
          )}
        </>
      )}
    </p>
  );
}

export function SlipsSummary({ summary }: { summary: SlipLedgerSummary }) {
  const settled = summary.won + summary.lost;
  const hasBalance = summary.settledWithStake > 0;
  return (
    <Card className="gap-3 px-4 py-4">
      <dl className="grid grid-cols-3 gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <dt className={LABEL}>em aberto</dt>
          <dd className={cn(VALUE, "font-mono tabular-nums")}>{summary.open}</dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <dt className={LABEL}>acertos</dt>
          <dd className={VALUE}>
            {settled === 0 ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <>
                <span className="font-mono tabular-nums">{summary.won}</span>
                <span className="text-body font-normal text-muted-foreground"> de </span>
                <span className="font-mono tabular-nums">{settled}</span>
              </>
            )}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <dt className={LABEL}>saldo</dt>
          <dd
            className={cn(
              VALUE,
              "font-mono tabular-nums",
              hasBalance ? balanceTone(summary.balanceUnits) : "text-muted-foreground",
            )}
          >
            {hasBalance ? formatUnitsSigned(summary.balanceUnits) : "—"}
          </dd>
        </div>
      </dl>
      {summary.settledWithoutStake > 0 && (
        <p className="text-meta text-muted-foreground">
          apostas sem stake não entram no saldo
        </p>
      )}
      {summary.live && <LiveLine live={summary.live} />}
    </Card>
  );
}
