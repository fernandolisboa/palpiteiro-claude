// MIN_EDGE_PP vem de lib/odds/scenario.ts, NUNCA de lib/ai/prompts/ — este
// componente é alcançável pelo client component AnalysisPanel ("use client");
// importar de lib/ai/prompts embarcaria o SYSTEM_PROMPT no bundle do cliente.
import { HelpHint } from "@/components/help-hint";
import { MIN_EDGE_PP } from "@/lib/odds/scenario";
import { cn } from "@/lib/utils";
import type { OutcomeView } from "@/lib/view/types";

type Props = {
  // Seleções do mercado como array (forma N-vias canônica). over/under → 2;
  // 1X2 → 3. Os rótulos/colunas vêm 100% do view-layer (AC3: nenhuma string de
  // mercado no componente). A recomendação é re-derivada de `isRecommended`.
  outcomes: OutcomeView[];
  // Frase full-width de break-even/margem-de-erro (topo da AnalysisView, R4) e
  // nota de degradação. null = não renderiza.
  framing: string | null;
  note: string | null;
  // Tom do retorno esperado do lado recomendado — espelha o bloco "Aposta
  // recomendada" (ADR 0012: avisos de minOdd acima da odd ou EV ≤ 0 tiram o
  // tom positivo também aqui; dois tons pro mesmo número no mesmo card seria
  // contradição).
  returnTone: "positive" | "neutral";
};

// Top-K (R9): K=5 colunas no máximo. over/under(2)/1X2(3) NUNCA truncam.
// Ordena [recomendado primeiro, depois os demais por modelProb desc] e corta em
// K. `truncated` sinaliza "+N outras" (placeholder pra mercados futuros N>5).
const MAX_COLUMNS = 5;

function parsePct(value: string): number {
  // "58%" → 58; "—" / não-numérico → -Infinity (vai pro fim na ordenação desc).
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

function selectColumns(outcomes: OutcomeView[]): {
  columns: OutcomeView[];
  hiddenCount: number;
} {
  if (outcomes.length <= MAX_COLUMNS) {
    return { columns: outcomes, hiddenCount: 0 };
  }
  const recommended = outcomes.filter((o) => o.isRecommended);
  const rest = outcomes
    .filter((o) => !o.isRecommended)
    .sort((a, b) => parsePct(b.modelProb) - parsePct(a.modelProb));
  const columns = [...recommended, ...rest].slice(0, MAX_COLUMNS);
  return { columns, hiddenCount: outcomes.length - columns.length };
}

// Grid responsivo por contagem de colunas. N=2 mantém o layout pré-pivot
// (grid-cols-1 → min-[480px]:grid-cols-2) byte-a-byte (paridade VISUAL).
function gridClass(count: number): string {
  if (count <= 2) return "grid grid-cols-1 gap-2 min-[480px]:grid-cols-2";
  if (count === 3) return "grid grid-cols-1 gap-2 min-[480px]:grid-cols-3";
  return "grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 lg:grid-cols-3";
}

// Bloco "Cenários" (ADR 0012): as seleções com números CONGELADOS na análise.
// Os lados não-recomendados são informativos — nunca uma segunda recomendação
// (sem accent, sem edge-*; pinado em teste). No mobile (~380px) as colunas
// empilham (grid-cols-1) e abrem a partir de 480px.
export function AnalysisScenarios({ outcomes, framing, note, returnTone }: Props) {
  const { columns, hiddenCount } = selectColumns(outcomes);
  const hasRecommendation = outcomes.some((o) => o.isRecommended);
  return (
    <div className="mx-4 mb-4 flex flex-col gap-2">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
        cenários
      </span>
      <div className={gridClass(columns.length)}>
        {columns.map((outcome, i) => (
          <ScenarioColumn
            key={outcome.id}
            outcome={outcome}
            hasRecommendation={hasRecommendation}
            returnTone={returnTone}
            // O `?` (HelpHint) ancora UMA vez só, na primeira coluna, pra não
            // dobrar aria-labels nem poluir o grid.
            showHints={i === 0}
          />
        ))}
      </div>
      {hiddenCount > 0 && (
        <p className="font-mono text-[10px] leading-snug tracking-tight text-muted-fg-2">
          {`+${hiddenCount} outras seleções não exibidas`}
        </p>
      )}
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
  outcome: OutcomeView;
  // Há recomendação em ALGUMA coluna? Em pass nenhuma coluna é "alternativa" —
  // todas neutras, sem badge nem rótulo de alternativa.
  hasRecommendation: boolean;
  returnTone: "positive" | "neutral";
  showHints: boolean;
};

function ScenarioColumn({
  outcome,
  hasRecommendation,
  returnTone,
  showHints,
}: ColumnProps) {
  const isRecommended = outcome.isRecommended;
  // "cenário alternativo" só existe quando HÁ recomendação; em pass as colunas
  // são neutras, sem badge e sem rótulo de alternativa.
  const isAlternative = hasRecommendation && !isRecommended;
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
          {outcome.scenarioLabel}
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
        value={outcome.modelProb}
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
        value={outcome.marketProb}
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
      <ScenarioRow label="odd na análise" value={outcome.odd} />
      {/* text-edge-fg é reservado a valores POSITIVOS da recomendação:
          nunca na coluna alternativa/neutra, e no retorno só quando o tom do
          view-mapper é "positive". */}
      <ScenarioRow
        label="edge"
        value={outcome.edge}
        emphasis={isRecommended && outcome.edge.startsWith("+")}
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
        value={outcome.expectedReturn}
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
          {`pelo modelo, só sai do zero com odd ≥ ${outcome.breakEven}`}
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
