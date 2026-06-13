import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MarketSegmentView } from "@/lib/view/dashboard";

// Régua D9 + breakdown por banda de stake, POR MERCADO. Seção NOVA abaixo dos
// KpiCards agregados (que ficam byte-idênticos → paridade visual). Display-only:
// a graduação aqui NUNCA escreve markets.is_graduated (ADR 0015 D9 / R3).

function GraduationRuler({
  segment,
}: {
  segment: MarketSegmentView;
}) {
  const { graduation } = segment;
  const pct =
    graduation.target > 0
      ? Math.min(100, (graduation.resolved / graduation.target) * 100)
      : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          graduação D9
        </span>
        {graduation.graduated ? (
          <span className="rounded-[5px] bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-emerald-500">
            graduado
          </span>
        ) : (
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            graduando
          </span>
        )}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            graduation.graduated ? "bg-emerald-500" : "bg-accent-fg/60",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {graduation.label}
        {" · "}
        yield {segment.kpis.yieldPct.value}
      </span>
    </div>
  );
}

function StakeBands({ segment }: { segment: MarketSegmentView }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        yield por banda de stake
      </span>
      <div className="grid grid-cols-3 gap-2">
        {segment.stakeBands.map((band) => (
          <div
            key={band.band}
            className="flex flex-col gap-1 rounded-md border border-border bg-surface-2 px-3 py-2"
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              {band.band}
            </span>
            <span
              className={cn(
                "text-[16px] font-medium leading-none tracking-[-0.01em] tabular-nums",
                band.yieldPct.lowSample
                  ? "text-amber-500"
                  : "text-foreground",
              )}
            >
              {band.yieldPct.value}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              n={band.yieldPct.n}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarketSegmentCard({ segment }: { segment: MarketSegmentView }) {
  return (
    <Card className="gap-4 p-5">
      <div className="flex items-baseline justify-between">
        <span className="text-[14px] font-medium tracking-tight">
          {segment.marketLabel}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {segment.kpis.counts.bets} apostas
        </span>
      </div>
      {segment.empty ? (
        <p className="text-[12.5px] tracking-tight text-muted-foreground">
          Sem apostas resolvidas ainda — a régua D9 e o yield por banda aparecem
          quando começarem a liquidar.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <GraduationRuler segment={segment} />
          <StakeBands segment={segment} />
        </div>
      )}
    </Card>
  );
}

export function MarketSegments({
  segments,
}: {
  segments: MarketSegmentView[];
}) {
  if (segments.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground">
        por mercado — régua D9 + banda de stake
      </span>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {segments.map((segment) => (
          <MarketSegmentCard key={segment.marketKey} segment={segment} />
        ))}
      </div>
    </section>
  );
}
