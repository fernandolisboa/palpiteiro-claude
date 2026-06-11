// MIN_EDGE_PP vem de lib/odds/scenario.ts, NUNCA de lib/ai/prompts/ — este
// componente é alcançável pelo client component AnalysisPanel ("use client");
// importar de lib/ai/prompts embarcaria o SYSTEM_PROMPT no bundle do cliente.
import { HelpHint } from "@/components/help-hint";
import { MIN_EDGE_PP } from "@/lib/odds/scenario";
import { cn } from "@/lib/utils";
import type { ScenarioSideView, ScenariosView } from "@/lib/view/types";

type Props = {
  scenarios: ScenariosView;
  // Tom do retorno esperado do lado recomendado — espelha o bloco "Aposta
  // recomendada" (ADR 0012: avisos de minOdd acima da odd ou EV ≤ 0 tiram o
  // tom positivo também aqui; dois tons pro mesmo número no mesmo card seria
  // contradição).
  returnTone: "positive" | "neutral";
};

const SIDE_LABEL: Record<"over" | "under", string> = {
  over: "mais de 2.5 gols",
  under: "menos de 2.5 gols",
};

// Bloco "Cenários" (ADR 0012): os dois lados com números CONGELADOS na
// análise. O lado alternativo é informativo — nunca uma segunda recomendação
// (sem accent, sem edge-*; pinado em teste). No mobile (~380px) as colunas
// empilham (grid-cols-1) e abrem lado a lado a partir de 480px.
export function AnalysisScenarios({ scenarios, returnTone }: Props) {
  const { over, under, recommended, framing, note } = scenarios;
  return (
    <div className="mx-4 mb-4 flex flex-col gap-2">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
        cenários
      </span>
      <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
        <ScenarioColumn
          side="over"
          view={over}
          recommended={recommended}
          returnTone={returnTone}
        />
        <ScenarioColumn
          side="under"
          view={under}
          recommended={recommended}
          returnTone={returnTone}
        />
      </div>
      {framing && (
        <p className="text-[11px] leading-snug tracking-tight text-muted-foreground">
          {framing}
        </p>
      )}
      {note && (
        <p className="font-mono text-[10px] leading-snug tracking-tight text-muted-fg-2">
          {note}
        </p>
      )}
      <p className="font-mono text-[10px] leading-snug tracking-tight text-muted-fg-2">
        {`o app só recomenda com vantagem ≥ ${MIN_EDGE_PP}pp sobre o mercado; os números acima são informativos · odds do momento da análise — as atuais estão no card acima`}
      </p>
    </div>
  );
}

type ColumnProps = {
  side: "over" | "under";
  view: ScenarioSideView;
  recommended: ScenariosView["recommended"];
  returnTone: "positive" | "neutral";
};

function ScenarioColumn({ side, view, recommended, returnTone }: ColumnProps) {
  const isRecommended = recommended === side;
  // Cada métrica se repete nas duas colunas (over + under): o `?` aparece UMA
  // vez só, ancorado na coluna canônica (over), pra não dobrar aria-labels nem
  // poluir o grid. Os anchors apontam pro glossário da #148.
  const showHints = side === "over";
  // "cenário alternativo" só existe quando HÁ recomendação; em pass as duas
  // colunas são neutras, sem badge e sem rótulo de alternativa.
  const isAlternative = recommended !== null && !isRecommended;
  return (
    <div
      data-scenario-col={
        isRecommended ? "recommended" : isAlternative ? "alternative" : "neutral"
      }
      className={cn(
        "flex flex-col gap-1.5 rounded-md border px-3 py-2.5",
        isRecommended
          ? "border-accent-border bg-accent-soft"
          : "border-border-subtle bg-surface-2",
      )}
    >
      <div className="flex items-baseline justify-between gap-2 pb-0.5">
        <span
          className={cn(
            "font-mono text-[10.5px] uppercase tracking-[0.14em]",
            isRecommended ? "text-accent-fg" : "text-muted-foreground",
          )}
        >
          {SIDE_LABEL[side]}
        </span>
        {isRecommended && (
          <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-accent-fg">
            recomendada
          </span>
        )}
        {isAlternative && (
          <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
            cenário alternativo
          </span>
        )}
      </div>
      <ScenarioRow
        label="prob. do modelo"
        value={view.modelProb}
        hint={
          showHints
            ? {
                anchor: "prob-modelo",
                blurb:
                  "A chance que a IA dá ao lado recomendado, comparada com a do mercado pra medir o edge.",
              }
            : undefined
        }
      />
      <ScenarioRow
        label="prob. do mercado"
        value={view.marketProb}
        hint={
          showHints
            ? {
                anchor: "prob-implicita",
                blurb:
                  "A chance que a odd embute, já descontada a margem da casa. Nunca é 1/odd cru.",
              }
            : undefined
        }
      />
      <ScenarioRow label="odd na análise" value={view.odd} />
      {/* text-edge-fg é reservado a valores POSITIVOS da recomendação:
          nunca na coluna alternativa/neutra, e no retorno só quando o tom do
          view-mapper é "positive". */}
      <ScenarioRow
        label="edge"
        value={view.edge}
        emphasis={isRecommended && view.edge.startsWith("+")}
        hint={
          showHints
            ? {
                anchor: "edge",
                blurb: `Quanto a prob. do modelo supera a do mercado, em pontos percentuais. O app só recomenda com pelo menos ${MIN_EDGE_PP}pp.`,
              }
            : undefined
        }
      />
      <ScenarioRow
        label="retorno esperado"
        value={view.expectedReturn}
        emphasis={isRecommended && returnTone === "positive"}
        hint={
          showHints
            ? {
                anchor: "retorno-esperado",
                blurb:
                  "Ganho médio por aposta, no longo prazo, se a estimativa do modelo estiver certa.",
              }
            : undefined
        }
      />
      {!isRecommended && (
        <p className="border-t border-border-subtle pt-1.5 text-[11px] leading-snug tracking-tight text-muted-foreground">
          {`pelo modelo, só sai do zero com odd ≥ ${view.modelBreakEvenOdd}`}
        </p>
      )}
    </div>
  );
}

type RowProps = {
  label: string;
  value: string;
  emphasis?: boolean;
  hint?: { anchor: string; blurb: string };
};

function ScenarioRow({ label, value, emphasis = false, hint }: RowProps) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
        {hint && (
          <HelpHint anchor={hint.anchor} label={label} blurb={hint.blurb} />
        )}
      </span>
      <span
        className={cn(
          "font-mono text-[12.5px] font-medium tabular-nums tracking-tight",
          emphasis ? "text-edge-fg" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}
