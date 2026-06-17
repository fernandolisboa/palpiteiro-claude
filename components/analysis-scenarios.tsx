// MIN_EDGE_PP vem de lib/odds/scenario.ts, NUNCA de lib/ai/prompts/ — este
// componente é alcançável pelo client component AnalysisPanel ("use client");
// importar de lib/ai/prompts embarcaria o SYSTEM_PROMPT no bundle do cliente.
import { ChevronRight } from "lucide-react";

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
  // Piso de edge do mercado em pp (#290): default MIN_EDGE_PP (5, partition);
  // scorer passa 8. Número PURO vindo da view (NUNCA importa lib/ai — pureza de
  // bundle). A UI mostra o piso REAL do mercado em vez de hardcodar 5.
  minEdgePp?: number;
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

// Grid responsivo por contagem de colunas. Usado pra a grade do PASS (todas as
// colunas neutras) e pra a grade de cenários ALTERNATIVOS colapsados (#242) — não
// mais pra o bloco inteiro: a recomendação agora é standalone (full-width) acima.
function gridClass(count: number): string {
  if (count <= 2) return "grid grid-cols-1 gap-2 min-[480px]:grid-cols-2";
  if (count === 3) return "grid grid-cols-1 gap-2 min-[480px]:grid-cols-3";
  return "grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 lg:grid-cols-3";
}

// "ver cenário alternativo · menos de 2.5 gols -7.3pp" — resumo do disclosure
// (#242). Com UM alternativo, carrega o número que decide (edge) pra a tela seguir
// legível MESMO fechada; com vários (1X2), só a contagem (mostrar N edges poluiria
// de volta o que a issue veio resolver). `—` (edge degradado) cai pro só-rótulo.
function alternativesSummaryLabel(alternatives: OutcomeView[]): string {
  if (alternatives.length === 1) {
    const alt = alternatives[0];
    const edge = alt.edge !== "—" ? ` ${alt.edge}` : "";
    return `ver cenário alternativo · ${alt.scenarioLabel}${edge}`;
  }
  return `ver ${alternatives.length} cenários alternativos`;
}

// Bloco "Cenários" (ADR 0012): as seleções com números CONGELADOS na análise.
// #242 — quando HÁ recomendação, ela é a ÚNICA coluna dominante (full-width); o(s)
// lado(s) não-recomendado(s) ficam COLAPSADOS atrás de um <details> nativo (fechado
// por padrão), pra a tela não poluir com o lado que o app NÃO recomenda. Nenhum dado
// se perde — está a 1 clique, e o número-chave já viaja no resumo. <details> nativo
// (não Radix) de propósito: mantém o componente ISOMÓRFICO (sem "use client"), que é
// o que permite renderizar nos 4 contextos do AnalysisResult (painel, encerrado,
// CADA item de "análises anteriores" #204, best-bet) sem fronteira de cliente. Os
// alternativos seguem informativos/neutros (sem accent/edge-*; pinado em teste). No
// PASS não há recomendação a subordinar → todas as colunas neutras, lado a lado.
export function AnalysisScenarios({
  outcomes,
  framing,
  note,
  returnTone,
  minEdgePp = MIN_EDGE_PP,
}: Props) {
  const { columns, hiddenCount } = selectColumns(outcomes);
  const hasRecommendation = columns.some((o) => o.isRecommended);
  const recommended = columns.filter((o) => o.isRecommended);
  const alternatives = columns.filter((o) => !o.isRecommended);
  return (
    <div className="mx-4 mb-4 flex flex-col gap-2">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
        cenários
      </span>
      {hasRecommendation ? (
        <>
          {/* Recomendado DOMINANTE: standalone, largura cheia (sem grid). O `?`
              (HelpHint) ancora aqui — a coluna sempre visível — pra não esconder a
              ajuda atrás do disclosure nem duplicar âncoras. */}
          {recommended.map((outcome) => (
            <ScenarioColumn
              key={outcome.id}
              outcome={outcome}
              hasRecommendation
              returnTone={returnTone}
              showHints
              minEdgePp={minEdgePp}
            />
          ))}
          {alternatives.length > 0 && (
            <details className="group">
              <summary className="flex cursor-pointer list-none select-none items-center gap-1.5 rounded-md py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-3 shrink-0 transition-transform group-open:rotate-90" />
                {alternativesSummaryLabel(alternatives)}
              </summary>
              <div className={cn(gridClass(alternatives.length), "pt-2")}>
                {alternatives.map((outcome) => (
                  <ScenarioColumn
                    key={outcome.id}
                    outcome={outcome}
                    hasRecommendation
                    returnTone={returnTone}
                    showHints={false}
                    minEdgePp={minEdgePp}
                  />
                ))}
              </div>
            </details>
          )}
        </>
      ) : (
        <div className={gridClass(columns.length)}>
          {columns.map((outcome, i) => (
            <ScenarioColumn
              key={outcome.id}
              outcome={outcome}
              hasRecommendation={false}
              returnTone={returnTone}
              // O `?` (HelpHint) ancora UMA vez só, na primeira coluna.
              showHints={i === 0}
              minEdgePp={minEdgePp}
            />
          ))}
        </div>
      )}
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
        {`o app só recomenda com vantagem ≥ ${minEdgePp}pp sobre o mercado; os números acima são informativos · odds do momento da análise — as atuais estão no card acima`}
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
  // Piso de edge do mercado (#290) — usado no HelpHint do edge. Default 5.
  minEdgePp: number;
};

function ScenarioColumn({
  outcome,
  hasRecommendation,
  returnTone,
  showHints,
  minEdgePp,
}: ColumnProps) {
  const isRecommended = outcome.isRecommended;
  // Distingue a superfície "alternative" da "neutral" (pass) pro data-scenario-col
  // (pinado em teste) — o ROTULO de alternativa agora vive no <summary> do disclosure
  // (#242), não num badge por-coluna, que seria redundante com o resumo.
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
                blurb: `Quanto a prob. do modelo supera a do mercado, em pontos percentuais. O app só recomenda com pelo menos ${minEdgePp}pp.`,
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
      {/* breakEven "—" (modelProb ≤ 0 → 100/0 indefinido): omite a frase de
          equilíbrio em vez de renderizar "odd ≥ —". */}
      {!isRecommended && outcome.breakEven !== "—" && (
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
