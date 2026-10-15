import type { BetLegParams } from "@/db/schema";
import type { AnalysisMarket } from "@/lib/bets/analysis-probs";
import {
  MATCH_STAKE_CAP_UNITS,
  type EvaluatedCombo,
  type EvaluatedLeg,
  type ReferenceOdds,
  type SlipEvaluation,
  type StakeSuggestion,
} from "@/lib/bets/evaluate-slip";
import {
  GRID_FIXED_GROUPS,
  legMarketPin,
  legSelectionId,
  referenceKey,
  TOP_EXACT_SCORES,
  type SlipGridKind,
} from "@/lib/bets/slip-markets";
import { gradeScorelineLeg, type ScorelineKind } from "@/lib/bets/grade-scoreline";
import {
  formatEdgePoints,
  formatEvPct,
  formatLine,
  formatOdd,
  formatPct,
  formatRelativeAgoLabel,
  formatUnitsCompact,
} from "@/lib/format";
import { computeMarketMargin } from "@/lib/odds/implied-probability";
import { getDescriptor } from "@/lib/odds/market-descriptor";
import { computeMarketScenarios } from "@/lib/odds/scenario";
import type { ModelScoreline, ModelScorelineSource } from "@/lib/quant/match-model";
import { pScoreline } from "@/lib/quant/scoreline-model";
import { betLegLabel } from "@/lib/view/free-bet";
import type { MatchUnavailableReason } from "@/lib/view/match-availability";

// Mappers PUROS do cupom (Fase 2, #556): a grade de mercados (server → client) e a
// avaliação depois de registrar. Tipos serializáveis só (cruzam pra "use client").
// Registro de valor LEGÍTIMO (ADR 0034 §9: esta é a superfície de avaliação, não o
// HERO). Veredito descritivo por sinal de EV, nunca imperativo (§12).

export const RISK_DISCLAIMER_PT_BR =
  "Aposta não é investimento. As recomendações do Palpiteiro são análises e não garantem resultado. Aposte com responsabilidade, só o que você pode perder, e nunca para recuperar perdas. Se a aposta deixou de ser diversão, procure ajuda.";

export type TeamNames = { home: string; away: string };

// ── Rótulos com o nome dos times ────────────────────────────────────────────

function groupTitle(groupKey: string): string {
  if (groupKey === "match_result") return "Resultado";
  if (groupKey === "double_chance") return "Dupla chance";
  if (groupKey === "btts") return "Ambas marcam";
  if (groupKey.startsWith("over_under:")) {
    return `Total de gols ${formatLine(groupKey.split(":")[1])}`;
  }
  return "Placar exato";
}

/** Rótulo curto do botão da grade. */
function buttonLabel(kind: string, params: BetLegParams, teams: TeamNames): string {
  const p = params as Record<string, unknown>;
  switch (kind) {
    case "match_result":
      return p.selection === "home" ? teams.home : p.selection === "away" ? teams.away : "Empate";
    case "double_chance":
      return p.selection === "home_draw"
        ? `${teams.home} ou empate`
        : p.selection === "home_away"
          ? `${teams.home} ou ${teams.away}`
          : `Empate ou ${teams.away}`;
    case "btts":
      return p.selection === "yes" ? "Sim" : "Não";
    case "over_under":
      return `${p.selection === "over" ? "Mais" : "Menos"} de ${formatLine(p.line as number | string)}`;
    case "exact_score":
      return `${p.home} × ${p.away}`;
    default:
      return betLegLabel(kind, p);
  }
}

/** Rótulo completo da perna no cupom e na avaliação, com o nome dos times. */
export function slipLegLabel(kind: string, params: BetLegParams, teams: TeamNames): string {
  const p = params as Record<string, unknown>;
  switch (kind) {
    case "match_result":
      return p.selection === "draw" ? "Empate" : `Vitória do ${buttonLabel(kind, params, teams)}`;
    case "double_chance":
      return `Dupla chance: ${buttonLabel(kind, params, teams)}`;
    case "btts":
      return p.selection === "yes" ? "Ambas marcam: sim" : "Ambas marcam: não";
    case "over_under":
      return `${buttonLabel(kind, params, teams)} gols`;
    case "exact_score":
      return `Placar exato: ${teams.home} ${p.home} × ${p.away} ${teams.away}`;
    default:
      return betLegLabel(kind, p)
        .replace("Mandante", teams.home)
        .replace("mandante", teams.home)
        .replace("Visitante", teams.away)
        .replace("visitante", teams.away);
  }
}

export function modelSourceLabel(source: ModelScorelineSource, degraded: boolean): string {
  if (source === "dixon_coles") return "modelo Dixon-Coles";
  return degraded ? "modelo simplificado (dados limitados)" : "modelo simplificado";
}

// ── Tabela de mercados (a grade de registro, #556/#576) ─────────────────────

export type GridSelectionView = {
  id: string;
  groupKey: string;
  kind: SlipGridKind;
  params: BetLegParams;
  label: string;
  legLabel: string;
  // Odd de referência (captura completa daquele mercado), ou null.
  referenceOdd: number | null;
  // Odd justa do modelo (100 / prob), mostrada em cinza quando não há referência.
  fairOdd: number | null;
  modelProbPct: number | null;
  // A última análise deste mercado (e linha) recomendou esta seleção: a marca "IA".
  aiPick: boolean;
};

// A captura do mercado COMPLETO: idade, margem e a chance sem a margem, na ordem das
// seleções do grupo. Mercado incompleto não ganha linha (de-vig parcial distorce).
export type GridMarketOddsView = {
  updatedAgo: string; // "há 12min"
  margin: string; // "5,2%"
  impliedPct: string[]; // ["45,2%", "28,1%", "26,7%"]
};

export type GridGroupView = {
  key: string;
  title: string;
  selections: GridSelectionView[];
  // De onde vem a chance do mercado: a sua análise dele, o modelo do jogo ou nenhum.
  probSource: "analysis" | "model" | null;
  odds: GridMarketOddsView | null;
};

// "register" = antes do apito (botões, placar exato, texto livre); "readOnly" = jogo que
// começou, adiado, cancelado ou encerrado (só a última captura, sem botões).
export type BetGridMode = "register" | "readOnly";

export type BetGridView = {
  teams: TeamNames;
  mode: BetGridMode;
  oddsHeading: "Odds de mercado" | "Odds antes do jogo";
  groups: GridGroupView[];
  // Placares mais prováveis (botões) + o "outro placar" livre no cliente.
  topScores: GridSelectionView[];
  // O modelo que gerou as chances da tabela. `computedAgo` só quando ele veio da base
  // do jogo (o cálculo na hora não tem "calculado há"). null = sem modelo.
  model: { label: string; computedAgo: string | null } | null;
  // Probabilidade de QUALQUER placar 0–9 × 0–9 pro "outro placar" (cliente).
  exactScoreProbPct: number[][] | null;
  // Nenhum mercado com captura: o corpo do aviso "Odds indisponíveis", por estado.
  noOdds: string | null;
};

// Fonte e JEV da Leitura do modelo (lib/view/match-model.ts), da MESMA linha da base.
export type GridModelReading = { source: string; jev: string | null };

const NO_ODDS_COPY = {
  preMatch: "Sem cotação publicada para este jogo. Análise indisponível até que o mercado abra.",
  live: "Jogo em andamento, sem cotação pré-jogo publicada.",
  other: "Sem cotação de referência para este jogo.",
} as const;

function selectionView(
  kind: SlipGridKind,
  params: BetLegParams,
  groupKey: string,
  teams: TeamNames,
  model: ModelScoreline | null,
  references: ReferenceOdds,
  analysis: ReadonlyMap<string, AnalysisMarket>,
): GridSelectionView {
  const pin = legMarketPin(kind, params);
  const market = pin ? analysis.get(referenceKey(pin)) : undefined;
  // Mesmo número da avaliação: o da sua análise daquele mercado, senão o modelo.
  const analysisProb = pin ? market?.probs[pin.selectionKey] : undefined;
  const grade = gradeScorelineLeg({ model, kind: kind as ScorelineKind, params });
  const modelProbPct =
    analysisProb ?? (grade.status === "graded" ? grade.modelProbPct : null);
  const ref = pin ? references.get(referenceKey(pin)) : undefined;
  const refOdd = pin && ref ? ref.odds[pin.selectionKey] : undefined;
  return {
    id: legSelectionId(kind, params),
    groupKey,
    kind,
    params,
    label: buttonLabel(kind, params, teams),
    legLabel: slipLegLabel(kind, params, teams),
    referenceOdd: refOdd !== undefined && refOdd > 1 ? refOdd : null,
    fairOdd: modelProbPct !== null && modelProbPct > 0 ? round2(100 / modelProbPct) : null,
    modelProbPct: modelProbPct === null ? null : round2(modelProbPct),
    // Pela chave do MERCADO (legMarketPin), nunca pelo rótulo: a dupla chance é
    // home_draw na grade e home_or_draw na análise. "pass" nunca casa.
    aiPick:
      pin !== null &&
      market?.recommendation != null &&
      market.recommendation === pin.selectionKey,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Chance sem a margem e margem do mercado COMPLETO, igual ao referenceFor do
// evaluate-slip (descriptor: todas as seleções com odd > 1, alvo e tipo do mercado).
// Nunca 1/odd cru como probabilidade (ADR 0018).
function marketOdds(
  selections: readonly { kind: string; params: BetLegParams }[],
  references: ReferenceOdds,
  now: Date,
): GridMarketOddsView | null {
  const pins = selections.map((s) => legMarketPin(s.kind, s.params));
  const first = pins[0];
  if (!first || pins.some((p) => p === null)) return null;
  const ref = references.get(referenceKey(first));
  const descriptor = getDescriptor(first.dbMarketKey);
  if (!ref || !descriptor) return null;
  const keys = descriptor.selectionKeys;
  if (keys.length === 0 || keys.some((k) => !(ref.odds[k] > 1))) return null;
  const target = descriptor.impliedSumTarget ?? 1;
  const scen = computeMarketScenarios({
    selections: keys.map((k) => ({ key: k, modelProbPct: 0, odd: ref.odds[k] })),
    recommendedKey: null,
    impliedSumTarget: target,
    marketKind: descriptor.marketKind ?? "partition",
  });
  const impliedPct = pins.map((p) => {
    const sel = scen.selections.find((s) => s.key === p!.selectionKey);
    return formatPct(sel?.impliedProbPct ?? null, { decimals: 1 });
  });
  return {
    updatedAgo: formatRelativeAgoLabel(ref.capturedAt, now),
    margin: formatPct(computeMarketMargin(keys.map((k) => ref.odds[k]), target) * 100, {
      decimals: 1,
    }),
    impliedPct,
  };
}

function modelLine(
  model: ModelScoreline | null,
  reading: GridModelReading | null,
  now: Date,
): BetGridView["model"] {
  if (!model) return null;
  // O rótulo descreve o modelo que GEROU a grade (resolveSlipModel): a base do jogo
  // (com o "calculado há" dela) ou o cálculo na hora, que não tem idade.
  if (model.baseCheckedAt) {
    return {
      label: reading
        ? `modelo ${reading.source}${reading.jev ? ` ${reading.jev}` : ""}`
        : modelSourceLabel(model.source, model.degraded),
      computedAgo: formatRelativeAgoLabel(model.baseCheckedAt, now),
    };
  }
  return { label: modelSourceLabel(model.source, model.degraded), computedAgo: null };
}

export function toBetGridView(input: {
  teams: TeamNames;
  model: ModelScoreline | null;
  references: ReferenceOdds;
  analysis: ReadonlyMap<string, AnalysisMarket>;
  mode?: BetGridMode;
  modelReading?: GridModelReading | null;
  // Por que o jogo não aceita análise (null = pré-jogo): a copy de "Odds indisponíveis".
  unavailable?: MatchUnavailableReason | null;
  now?: Date;
}): BetGridView {
  const { teams, references, analysis } = input;
  const mode = input.mode ?? "register";
  const now = input.now ?? new Date();
  // Só leitura não tem modelo (o jogo já começou ou acabou): sem chance nem placar.
  const model = mode === "readOnly" ? null : input.model;
  const groups = GRID_FIXED_GROUPS.map((g): GridGroupView => {
    const selections = g.selections.map((s) =>
      selectionView(s.kind, s.params, g.key, teams, model, references, analysis),
    );
    const analyzed = g.selections.some((s) => {
      const p = legMarketPin(s.kind, s.params);
      return p !== null && analysis.get(referenceKey(p))?.probs[p.selectionKey] !== undefined;
    });
    return {
      key: g.key,
      title: groupTitle(g.key),
      selections,
      probSource: analyzed
        ? "analysis"
        : selections.some((s) => s.modelProbPct !== null)
          ? "model"
          : null,
      odds: marketOdds(g.selections, references, now),
    };
  });

  let topScores: GridSelectionView[] = [];
  let exactScoreProbPct: number[][] | null = null;
  if (model) {
    exactScoreProbPct = Array.from({ length: 10 }, (_, h) =>
      Array.from({ length: 10 }, (_, a) => round2(pScoreline(model.matrix, h, a) * 100)),
    );
    const cells: { h: number; a: number; p: number }[] = [];
    exactScoreProbPct.forEach((row, h) => row.forEach((p, a) => cells.push({ h, a, p })));
    topScores = cells
      .sort((x, y) => y.p - x.p || x.h + x.a - (y.h + y.a))
      .slice(0, TOP_EXACT_SCORES)
      .map((c) =>
        selectionView(
          "exact_score",
          { home: c.h, away: c.a },
          "exact_score",
          teams,
          model,
          references,
          analysis,
        ),
      );
  }

  const unavailable = input.unavailable ?? null;
  return {
    teams,
    mode,
    oddsHeading: mode === "readOnly" ? "Odds antes do jogo" : "Odds de mercado",
    groups,
    topScores,
    model: modelLine(model, input.modelReading ?? null, now),
    exactScoreProbPct,
    noOdds: groups.some((g) => g.selections.some((s) => s.referenceOdd !== null))
      ? null
      : unavailable === null
        ? NO_ODDS_COPY.preMatch
        : unavailable === "live"
          ? NO_ODDS_COPY.live
          : NO_ODDS_COPY.other,
  };
}

// ── Avaliação depois de registrar ───────────────────────────────────────────

// Veredito TEMPLATE-DERIVADO do sinal do EV na odd do usuário (conjunto finito,
// descritivo — ADR 0034 §12). Mesma família de frases do resto do app.
const VALUE_READING = {
  positive:
    "Pelo modelo, nessa odd, essa aposta tem valor: a probabilidade que estimamos supera o que a odd paga.",
  zero: "Pelo modelo, nessa odd, essa aposta fica no limite: sem vantagem nem desvantagem clara.",
  negative:
    "Pelo modelo, nessa odd, essa aposta não tem valor: a odd paga menos do que a probabilidade que estimamos.",
  noOdd: "Sem a odd que você pegou, mostramos só a chance pelo modelo e a odd justa.",
} as const;

export function valueReading(evPerUnit: number | null): string {
  if (evPerUnit === null) return VALUE_READING.noOdd;
  const pct = Number((evPerUnit * 100).toFixed(1));
  if (pct > 0) return VALUE_READING.positive;
  if (pct < 0) return VALUE_READING.negative;
  return VALUE_READING.zero;
}

function stakeText(s: StakeSuggestion | null): string | null {
  if (s === null) return null;
  const units = formatUnitsCompact(s.units, 1);
  if (s.rule === "bandas") return `${units} (bandas)`;
  if (s.rule === "quarter-kelly") return `${units} (quarter-Kelly)`;
  return `${units} (quarter-Kelly conjunto)`;
}

export type EvaluatedLegView = {
  label: string;
  status: "graded" | "no_data" | "not_covered";
  // Só em "graded":
  modelProb: string | null;
  fairOdd: string | null;
  sourceLabel: string | null;
  userOdd: string | null;
  ev: string | null;
  breakEven: string | null;
  edge: string | null;
  edgeNote: string | null;
  reading: string;
  suggestedStake: string | null;
  kellyInfo: string | null;
  userStake: string | null;
};

export type EvaluatedComboView =
  | {
      status: "graded";
      jointProb: string;
      fairOdd: string | null;
      sourceLabel: string;
      userOdd: string | null;
      ev: string | null;
      breakEven: string | null;
      reading: string;
      suggestedStake: string | null;
      kellyInfo: string | null;
      userStake: string | null;
      marginals: { label: string; prob: string }[];
    }
  | { status: "not_evaluated"; reason: string };

export type SlipEvaluationView = {
  mode: "simples" | "combinada";
  legs: EvaluatedLegView[];
  combo: EvaluatedComboView | null;
  stakeRuleNote: string;
  // Aviso honesto sobre o edge do modelo (backtest #558: o Dixon-Coles sozinho não
  // bateu as odds de fechamento). Sempre presente.
  modelCaveat: string;
};

export const MODEL_CAVEAT_PT_BR =
  "No nosso backtest, o Dixon-Coles sozinho não bateu as odds de fechamento: leia o edge e o retorno esperado como a opinião do modelo, não como vantagem garantida.";

const units = (n: number | null) => (n === null ? null : formatUnitsCompact(n));

function legView(leg: EvaluatedLeg, teams: TeamNames): EvaluatedLegView {
  const label = slipLegLabel(leg.kind, leg.params, teams);
  const userOdd = leg.userOdd === null ? null : formatOdd(leg.userOdd);
  if (leg.status !== "graded") {
    return {
      label,
      status: leg.status,
      modelProb: null,
      fairOdd: null,
      sourceLabel: null,
      userOdd,
      ev: null,
      breakEven: null,
      edge: null,
      edgeNote: null,
      reading:
        leg.status === "not_covered"
          ? "Registramos, mas não avaliamos cartões nem escanteios como número."
          : "Registramos, mas não deu pra estimar o placar deste jogo agora.",
      suggestedStake: null,
      kellyInfo: null,
      userStake: units(leg.stakeUnits),
    };
  }
  const edge = leg.reference ? formatEdgePoints(leg.reference.edgePct) : null;
  return {
    label,
    status: "graded",
    modelProb: formatPct(leg.modelProbPct, { decimals: 1 }),
    fairOdd: leg.fairOdd === null ? null : formatOdd(leg.fairOdd),
    sourceLabel:
      leg.origin === "analysis" || leg.source === null
        ? "sua análise deste mercado"
        : modelSourceLabel(leg.source, leg.degradedData),
    userOdd,
    ev: leg.evPerUnit === null ? null : formatEvPct(leg.evPerUnit),
    breakEven:
      leg.breakEvenProbPct === null ? null : formatPct(leg.breakEvenProbPct, { decimals: 1 }),
    edge,
    edgeNote: leg.reference
      ? leg.belowEdgeFloor
        ? `contra o mercado (odd ${formatOdd(leg.reference.odd)}, sem a margem): abaixo do piso de vantagem do motor`
        : `contra o mercado (odd ${formatOdd(leg.reference.odd)}, sem a margem)`
      : "sem odd de referência recente e completa deste mercado",
    reading: leg.coherenceWarning
      ? `${valueReading(leg.evPerUnit)} A odd de referência conta outra história; o veredito segue a sua odd.`
      : valueReading(leg.evPerUnit),
    suggestedStake: stakeText(leg.suggestedStake),
    kellyInfo: stakeText(leg.kellyInfo),
    userStake: units(leg.stakeUnits),
  };
}

const COMBO_REASON = {
  "fora-da-matriz":
    "Não avaliamos esta combinada: tem perna fora do modelo de placar (1º tempo, quem marca primeiro, cartões ou escanteios) ou sem número. As pernas aparecem uma a uma acima.",
  "sem-modelo": "Não deu pra estimar o placar deste jogo agora, então a combinada ficou sem número.",
} as const;

function comboView(
  combo: EvaluatedCombo,
  legs: EvaluatedLeg[],
  teams: TeamNames,
): EvaluatedComboView {
  if (combo.status === "not_evaluated") {
    return { status: "not_evaluated", reason: COMBO_REASON[combo.reason] };
  }
  return {
    status: "graded",
    jointProb: formatPct(combo.jointProbPct, { decimals: 1 }),
    fairOdd: combo.fairOdd === null ? null : formatOdd(combo.fairOdd),
    sourceLabel: modelSourceLabel(combo.source, combo.degradedData),
    userOdd: combo.comboUserOdd === null ? null : formatOdd(combo.comboUserOdd),
    ev: combo.evPerUnit === null ? null : formatEvPct(combo.evPerUnit),
    breakEven:
      combo.breakEvenProbPct === null ? null : formatPct(combo.breakEvenProbPct, { decimals: 1 }),
    reading: valueReading(combo.evPerUnit),
    suggestedStake: stakeText(combo.suggestedStake),
    kellyInfo: stakeText(combo.kellyInfo),
    userStake: units(combo.comboStakeUnits),
    marginals: legs.map((l, i) => ({
      label: slipLegLabel(l.kind, l.params, teams),
      prob: formatPct(combo.marginalsPct[i], { decimals: 1 }),
    })),
  };
}

export function toSlipEvaluationView(
  evaluation: SlipEvaluation,
  teams: TeamNames,
): SlipEvaluationView {
  return {
    modelCaveat: MODEL_CAVEAT_PT_BR,
    mode: evaluation.mode,
    legs: evaluation.legs.map((l) => legView(l, teams)),
    combo:
      evaluation.combo === null ? null : comboView(evaluation.combo, evaluation.legs, teams),
    stakeRuleNote: evaluation.cappedAtMatchLimit
      ? `Stake sugerido pelas bandas do motor (1 a 3u), só com retorno esperado positivo, e somado no máximo ${MATCH_STAKE_CAP_UNITS}u por jogo: reduzimos as pernas pra caber. O quarter-Kelly é informativo.`
      : `Stake sugerido pelas bandas do motor (1 a 3u), só com retorno esperado positivo e no máximo ${MATCH_STAKE_CAP_UNITS}u por jogo. O quarter-Kelly é informativo.`,
  };
}

// Re-exportado pra cliente montar o "outro placar" com o mesmo id da grade.
export { legSelectionId };

// ── Histórico (/apostas): a mesma leitura por perna, do que foi congelado ────

type PersistedLeg = {
  userOdd: string | null;
  modelProbPct: string | null;
  gradeSource: "cartridge" | "scoreline_model" | "none";
  modelSource: "dixon_coles" | "heuristic" | null;
  marketImpliedPct: string | null;
  stakeUnits: string | null;
  suggestedStakeUnits: string | null;
};

const num = (v: string | null) => (v === null ? null : Number(v));

/**
 * Pedaços curtos da avaliação congelada de uma perna ("chance 52.3%", "odd 2.10",
 * "retorno esperado +9,9%", "vantagem do modelo +4,5 pontos", "stake 1u", "sugerido 1u", fonte).
 * Nunca recalcula com dado novo: só re-deriva EV/edge dos números gravados.
 */
export function historyLegSummary(leg: PersistedLeg): string[] {
  const prob = num(leg.modelProbPct);
  const odd = num(leg.userOdd);
  const implied = num(leg.marketImpliedPct);
  const parts: string[] = [];
  if (prob !== null) parts.push(`chance ${formatPct(prob, { decimals: 1 })}`);
  if (odd !== null) parts.push(`odd ${formatOdd(odd)}`);
  if (prob !== null && odd !== null && odd > 1) {
    parts.push(`retorno esperado ${formatEvPct((prob / 100) * odd - 1)}`);
  }
  if (prob !== null && implied !== null) {
    parts.push(`vantagem do modelo ${formatEdgePoints(prob - implied)}`);
  }
  const stake = num(leg.stakeUnits);
  if (stake !== null) parts.push(`seu stake ${units(stake)}`);
  const suggested = num(leg.suggestedStakeUnits);
  if (suggested !== null) parts.push(`sugerido ${units(suggested)}`);
  if (prob !== null) {
    parts.push(
      leg.gradeSource === "cartridge"
        ? "sua análise"
        : leg.modelSource === "dixon_coles"
          ? "Dixon-Coles"
          : leg.modelSource === "heuristic"
            ? "modelo simplificado"
            : "modelo de placar",
    );
  }
  return parts;
}
