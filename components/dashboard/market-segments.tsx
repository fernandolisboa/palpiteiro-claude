import { Badge } from "@/components/ui/badge";
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
        <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
          graduação D9
        </span>
        {graduation.graduated ? (
          <Badge
            variant="outline"
            size="xs"
            className="border-edge-border bg-edge-soft uppercase tracking-label text-edge-fg"
          >
            graduado
          </Badge>
        ) : (
          <span className="font-mono text-eyebrow tabular-nums text-muted-foreground">
            graduando
          </span>
        )}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            graduation.graduated ? "bg-edge-fg" : "bg-accent-fg/60",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-meta tabular-nums text-muted-foreground">
        {graduation.label}
        {" · "}
        yield {segment.kpis.yieldPct.value}
      </span>
    </div>
  );
}

// Uma métrica de CLV: valor sinalizado (+ verde = bateu o fechamento; − vermelho;
// amber em amostra pequena; "—" sem dado) + a amostra.
function ClvMetric({
  label,
  view,
}: {
  label: string;
  view: { value: string; n: number; lowSample: boolean };
}) {
  const tone = view.value.startsWith("+")
    ? "text-edge-fg"
    : view.value.startsWith("-")
      ? "text-destructive"
      : "text-muted-foreground";
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={cn(
          "text-label font-medium leading-none tracking-tight tabular-nums",
          view.lowSample ? "text-warn-fg" : tone,
        )}
      >
        {view.value}
      </span>
      <span className="font-mono text-eyebrow-xs uppercase tracking-label text-muted-foreground">
        {label} · n={view.n}
      </span>
    </div>
  );
}

// CLV (#180) por mercado — companheiro do Yield, FORA do gate `empty`: aparece assim
// que há closing line capturada, antes de qualquer aposta liquidar (o ponto do CLV).
// Sem nenhuma closing (clvOddsRatio.n === 0) → não renderiza (evita "—").
function ClvLine({ segment }: { segment: MarketSegmentView }) {
  const { clvOddsRatio, clvNoVigDelta } = segment.kpis;
  if (clvOddsRatio.n === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 px-3 py-2.5">
      <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
        CLV vs fechamento
      </span>
      <div className="flex items-baseline gap-5">
        <ClvMetric label="razão de odds" view={clvOddsRatio} />
        <ClvMetric label="no-vig" view={clvNoVigDelta} />
      </div>
    </div>
  );
}

function StakeBands({ segment }: { segment: MarketSegmentView }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
        yield por banda de stake
      </span>
      <div className="grid grid-cols-3 gap-2">
        {segment.stakeBands.map((band) => (
          <div
            key={band.band}
            className="flex flex-col gap-1 rounded-md border border-border bg-surface-2 px-3 py-2"
          >
            <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
              {band.band}
            </span>
            <span
              className={cn(
                "text-label font-medium leading-none tracking-tight tabular-nums",
                band.yieldPct.lowSample
                  ? "text-warn-fg"
                  : "text-foreground",
              )}
            >
              {band.yieldPct.value}
            </span>
            <span className="font-mono text-eyebrow tabular-nums text-muted-foreground">
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
        <span className="text-label font-medium tracking-tight">
          {segment.marketLabel}
        </span>
        <span className="font-mono text-eyebrow tabular-nums text-muted-foreground">
          {segment.kpis.counts.bets} apostas
        </span>
      </div>
      <ClvLine segment={segment} />
      {segment.empty ? (
        <p className="text-body-sm tracking-tight text-muted-foreground">
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
      <span className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
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
