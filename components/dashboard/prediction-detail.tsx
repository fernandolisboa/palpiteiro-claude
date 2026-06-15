import { BackLink } from "@/components/back-link";
import { LEAGUE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PredictionDetailView } from "@/lib/view/dashboard";

function Row({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border-subtle py-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className={cn("text-[13px] tabular-nums", className)}>{value}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <h2 className="pb-2 pt-7 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </h2>
  );
}

function RawPayload({ label, json }: { label: string; json: string }) {
  return (
    <details className="rounded-lg border border-border bg-surface-2">
      <summary className="cursor-pointer select-none px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </summary>
      <pre className="max-h-[420px] overflow-auto border-t border-border px-4 py-3 font-mono text-[11px] leading-relaxed">
        {json}
      </pre>
    </details>
  );
}

export function PredictionDetail({
  view,
  backHref = "/dashboard",
  backLabel = "dashboard",
}: {
  view: PredictionDetailView;
  backHref?: string;
  backLabel?: string;
}) {
  const { match, prediction, clv, outcome, aiCall, rawPayloads } = view;
  // CLV sinalizado: + (bateu o fechamento) = verde, − = vermelho, "—" = neutro.
  const clvTone = (value: string) =>
    value.startsWith("+")
      ? "text-emerald-500"
      : value.startsWith("-")
        ? "text-red-500"
        : "text-muted-foreground";
  const resultClass =
    outcome?.result === "won"
      ? "text-emerald-500"
      : outcome?.result === "lost"
        ? "text-red-500"
        : "text-muted-foreground";

  return (
    <div className="mx-auto w-full max-w-[680px] px-6 py-8">
      <BackLink href={backHref} label={backLabel} />

      <h1 className="text-[22px] font-medium tracking-[-0.02em]">
        {match.home} × {match.away}
      </h1>
      <p className="pb-2 font-mono text-[11px] text-muted-foreground">
        {LEAGUE_LABEL[match.league]} · {match.kickoff} · prediction{" "}
        {view.id.slice(0, 8)}
      </p>

      <SectionLabel>predição</SectionLabel>
      <Row label="recomendação" value={prediction.rec} />
      <Row label="confiança" value={prediction.confidence} />
      <Row
        label="edge"
        value={prediction.edge ? `${prediction.edge}pp` : "—"}
      />
      <Row label="prob. implícita" value={prediction.implied} />
      <Row label="odd de entrada" value={prediction.odd} />
      <Row label="odd mínima" value={prediction.minOdd} />
      <Row label="stake" value={prediction.stake} />
      <Row label="bookmaker" value={prediction.bookmaker} />
      <Row label="gerada em" value={prediction.createdAt} />

      <SectionLabel>CLV (linha de fechamento)</SectionLabel>
      {clv.available ? (
        <>
          <Row label="odd de fechamento" value={clv.closingOdd} />
          <Row
            label="CLV razão de odds"
            value={clv.oddsRatioPct}
            className={clvTone(clv.oddsRatioPct)}
          />
          <Row
            label="CLV no-vig"
            value={clv.noVigDeltaPp}
            className={clvTone(clv.noVigDeltaPp)}
          />
        </>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Sem closing line capturada — o CLV (seu preço vs o de fechamento)
          aparece quando a odd de fechamento for capturada perto do kickoff.
        </p>
      )}

      <SectionLabel>racional</SectionLabel>
      <p className="text-[13.5px] leading-relaxed tracking-tight">
        {prediction.rationale}
      </p>
      <ul className="flex list-disc flex-col gap-1 pl-5 pt-3 text-[12.5px] text-muted-foreground">
        {prediction.factors.map((f, i) => (
          <li key={i}>{f}</li>
        ))}
      </ul>

      <SectionLabel>resultado</SectionLabel>
      {outcome ? (
        <>
          <Row label="resultado" value={outcome.result} className={resultClass} />
          <Row
            label="lucro"
            value={outcome.profit}
            className={
              outcome.profit.startsWith("-")
                ? "text-red-500"
                : "text-emerald-500"
            }
          />
          <Row label="placar do jogo" value={match.score} />
          <Row
            label={outcome.settlementMetric.label}
            value={outcome.settlementMetric.value}
          />
          <Row label="liquidada em" value={outcome.settledAt} />
          <Row
            label="override manual"
            value={outcome.manual ? "sim" : "não"}
          />
        </>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Ainda pendente — o resultado aparece após o jogo ser liquidado.
        </p>
      )}

      {aiCall && (
        <>
          <SectionLabel>chamada de IA</SectionLabel>
          <Row label="modelo" value={aiCall.model} />
          <Row label="prompt" value={aiCall.promptVersion} />
          <Row
            label="tokens"
            value={`${aiCall.inputTokens} in · ${aiCall.outputTokens} out`}
          />
          <Row label="custo" value={aiCall.costUsd} />
          <Row label="latência" value={`${aiCall.latencyMs}ms`} />
          <Row label="status" value={aiCall.status} />
        </>
      )}

      {rawPayloads ? (
        <>
          <SectionLabel>payloads brutos</SectionLabel>
          <div className="flex flex-col gap-2">
            <RawPayload label="input (prompt enviado)" json={rawPayloads.input} />
            <RawPayload label="output (resposta crua)" json={rawPayloads.output} />
          </div>
        </>
      ) : (
        aiCall && (
          <>
            <SectionLabel>payloads brutos</SectionLabel>
            <p className="text-[12.5px] text-muted-foreground">
              Disponíveis só para admin (protegem o prompt do sistema).
            </p>
          </>
        )
      )}
    </div>
  );
}
