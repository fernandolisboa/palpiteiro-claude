import {
  computeBreakEvenProbPct,
  computeEvPerUnit,
  computeMarketScenarios,
} from "@/lib/odds/scenario";
import { getDescriptor } from "@/lib/odds/market-descriptor";
import { profitForOutcome } from "@/lib/settlement/money";
import { computeStakeUnits } from "@/lib/ai/staking";
import { getMarketPresentation } from "@/lib/view/markets/presentation";
import type { GradeMyBetView } from "@/lib/view/types";

// Mapper PURO de "Analise minha aposta" (#412, ADR 0034). Roda SERVER-SIDE (chamado
// pela action gradeMyBet) e devolve um GradeMyBetView de tipos puros — o componente
// "use client" só recebe o resultado como props. Espelha lib/view/best-bet.ts:
// importa SÓ @/lib/odds (scenario + descriptor), @/lib/settlement/money,
// @/lib/ai/staking, @/lib/view/markets/presentation + tipos. NUNCA importa @/lib/db,
// @/lib/ai (valor) nem value-language-guard — a superfície Análise renderiza
// edge/EV/stake abertamente (legítimo), o firewall da manchete é erro de categoria
// aqui (ADR 0034 §9). A action congela + Number()'a TODOS os campos numéricos antes
// de chamar este mapper (drizzle-numeric-returns-string na fronteira da action).

// Veredito TEMPLATE-DERIVADO de Math.sign(EV@userOdd) SÓ (nunca sign(edge)) — ADR
// 0034 §11/§12. Descritivo/backward-looking ("é a NOSSA AVALIAÇÃO desta aposta"),
// NUNCA imperativo ('aposte'/'vá'), nota, score ou superlativo. Conjunto FINITO de
// constantes (golden test pina o render ∈ {3} + denylist).
const VALUE_READING = {
  positive:
    "Pelo nosso modelo, nessa odd, essa aposta tem valor — a probabilidade que estimamos supera o que a odd paga.",
  zero: "Pelo nosso modelo, nessa odd, essa aposta fica no limite — sem vantagem nem desvantagem clara.",
  negative:
    "Pelo nosso modelo, nessa odd, essa aposta não tem valor — a odd paga menos do que a probabilidade que estimamos.",
} as const;

function valueReadingForSign(evSign: number): string {
  if (evSign > 0) return VALUE_READING.positive;
  if (evSign < 0) return VALUE_READING.negative;
  return VALUE_READING.zero;
}

function edgeLabelOf(edge: number | null): string {
  if (edge === null) return "—";
  const sign = edge >= 0 ? "+" : "";
  return `${sign}${edge.toFixed(1)}pp`;
}

const STAKE_MARKET_LABEL = "dimensionamento de mercado";

export type GradeMyBetMapperInput = {
  // Distribuição CONGELADA por seleção (já Number()'da pela action). `odd` é a
  // NOSSA odd de snapshot (null se ausente) — NUNCA a do usuário.
  selections: { key: string; modelProbPct: number; odd: number | null }[];
  pinnedKey: string;
  // A odd que o usuário pegou na casa (já parseada/validada > 1 no boundary Zod).
  userOdd: number;
  marketKey: string;
  line: number | null;
  // A seleção recomendada pela análise (prediction.recommendation), ou null/pass.
  recommendation: string | null;
  // Valores PERSISTIDOS da recomendada (já Number()'dos na fronteira drizzle pela
  // action). Não-null SÓ quando pinnedKey === recommendation no cache-hit.
  persisted: {
    edgePct: number | null;
    impliedProbPct: number | null;
    stakeUnits: number | null;
  } | null;
  createdAt: string;
};

export function toGradeMyBetView(input: GradeMyBetMapperInput): GradeMyBetView {
  const {
    selections,
    pinnedKey,
    userOdd,
    marketKey,
    line,
    recommendation,
    persisted,
    createdAt,
  } = input;

  // Threada AMBOS impliedSumTarget E marketKind (best-bet.ts:42,46): sem o
  // impliedSumTarget a dupla chance (Σ=2) teria o edge silenciosamente pela
  // metade; sem o marketKind o independent_binary normalizaria errado.
  const descriptor = getDescriptor(marketKey);
  const impliedSumTarget = descriptor?.impliedSumTarget ?? 1;
  const marketKind = descriptor?.marketKind ?? "partition";

  const presentation = getMarketPresentation(marketKey);
  const pinnedLabel = presentation.outcomeLabel(pinnedKey, line);
  const marketLabel = presentation.marketLabel;

  // modelProbPct da seleção FIXADA — vem direto da distribuição (carrega TODAS as
  // seleções, inclusive pass). Ausente → não modelamos essa seleção/linha (skip-not-
  // fabricate §8): NUNCA empresta a prob de uma seleção vizinha.
  const pinned = selections.find((s) => s.key === pinnedKey);
  if (pinned === undefined) {
    return {
      kind: "nao-avalio",
      reason: "Não avalio essa seleção ainda — fora da cobertura do modelo.",
    };
  }
  const modelProbPct = pinned.modelProbPct;

  // ── CANAL ODD-DO-USUÁRIO (PRIMÁRIO, price-only §2/§3) ──────────────────────
  // EV e break-even saem de chamadas DIRETAS na odd do usuário — NUNCA de
  // computeMarketScenarios (que usa s.odd NOSSA, scenario.ts:135). userOdd NUNCA
  // entra no array Σ1/odd de computeMarketImpliedProbabilities (corromperia o
  // overround de TODAS as seleções).
  const evPerUnit = computeEvPerUnit(modelProbPct, userOdd);
  const breakEvenProbPct = computeBreakEvenProbPct(userOdd);
  const evSign = Math.sign(evPerUnit);

  // ── CANAL EDGE/IMPLÍCITA (ancorado no NOSSO board) ────────────────────────
  // persisted-vs-recompute UMA VEZ por seleção, alimentando o edge EXIBIDO E o
  // stake do MESMO número (band boundaries em edge>=8/>=12). Cache-hit na
  // recomendada → usa os valores PERSISTIDOS (.toFixed(2) congelado, casa o card);
  // senão recomputa via computeMarketScenarios (display + stake recomputados).
  const isPersistedHit = pinnedKey === recommendation && persisted !== null;
  let edge: number | null;
  let impliedProbPct: number | null;
  let stakeUnits: number;
  if (isPersistedHit) {
    edge = persisted.edgePct;
    impliedProbPct = persisted.impliedProbPct;
    // stake do MESMO número (frozen): 1u defensivo se a row legada não o gravou.
    stakeUnits = persisted.stakeUnits ?? 1;
  } else {
    const scen = computeMarketScenarios({
      selections,
      recommendedKey: recommendation,
      impliedSumTarget,
      marketKind,
    });
    const pinnedScen = scen.selections.find((s) => s.key === pinnedKey);
    edge = pinnedScen?.edgePct ?? null;
    impliedProbPct = pinnedScen?.impliedProbPct ?? null;
    // 2º arg = modelProbPct como proxy de confiança (§4a). edge null → 1u (§4b).
    stakeUnits = computeStakeUnits(edge, modelProbPct);
  }

  // GUARDA DE COERÊNCIA (§4c): sinais divergentes → o canal odd-do-usuário governa
  // o veredito; o stake-de-nosso-edge é demovido a cifra SECUNDÁRIA. evSign aqui é
  // SEMPRE o EV@userOdd (NUNCA o EV@nossaOdd).
  const coherenceWarning = edge !== null && evSign !== Math.sign(edge);
  const valueReading = valueReadingForSign(evSign);
  const profitIfWon = profitForOutcome("won", userOdd, stakeUnits);

  // Snapshot incompleto (edge null) E não-recomendada: edge='—' honesto, mas
  // EV+break-even+lucro AINDA presentes (canal odd-do-usuário independe do board).
  // stake = 1u "dimensionamento de mercado".
  if (edge === null) {
    return {
      kind: "degradado-sem-snapshot",
      pinnedLabel,
      marketLabel,
      line,
      userOdd,
      valueReading,
      edgeLabel: "—",
      evPerUnit,
      breakEvenProbPct,
      stakeUnits,
      stakeLabel: STAKE_MARKET_LABEL,
      profitIfWon,
      modelProbPct,
      createdAt,
    };
  }

  // Sob coerência o stake-de-nosso-edge sai SÓ como secundário (nunca manchete);
  // o stake primário fica neutro (1u de dimensionamento). Sem divergência, o stake
  // do nosso edge é o primário.
  const stakeLabel = coherenceWarning ? STAKE_MARKET_LABEL : "stake sugerido";
  const secondaryStakeLabel = coherenceWarning
    ? `nosso edge dimensionaria ${stakeUnits}u`
    : null;

  return {
    kind: "grade-coberto",
    pinnedLabel,
    marketLabel,
    line,
    userOdd,
    valueReading,
    edge,
    edgeLabel: edgeLabelOf(edge),
    evPerUnit,
    breakEvenProbPct,
    stakeUnits,
    stakeLabel,
    secondaryStakeLabel,
    profitIfWon,
    coherenceWarning,
    modelProbPct,
    impliedProbPct,
    createdAt,
  };
}
