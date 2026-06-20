import type { PalpiteType } from "@/lib/ai/palpites/settleable";
import type { PalpiteSetWithLines } from "@/lib/db/queries/palpites";

// Rótulo PT-BR humano por tipo — a única tradução de domínio da view. Mapa fechado
// (Record sobre o enum CANÔNICO) → o TS exige cobertura EXAUSTIVA de todo membro do
// enum (qualquer tipo novo sem label vira erro de compilação — remove a trap de
// `undefined` silencioso, #354 / major F). settleable: exact_score + os 4 goal-derived;
// red_card/corners são fun-only (ADR 0028 §3).
const TYPE_LABEL: Record<PalpiteType, string> = {
  exact_score: "placar exato",
  red_card: "cartão vermelho",
  corners: "escanteios",
  margin: "margem de vitória",
  clean_sheet: "não sofrer gol",
  first_half_score: "placar do 1º tempo",
  first_to_score: "primeiro a marcar",
  // #419 — rótulo yellow-específico (casa a chave de liquidação do #394, ADR 0033),
  // não "amarelos"/"cartões" soltos. Linha fun-only (settleable=false).
  cards: "cartões amarelos",
};

// Estado DERIVADO de cada linha (PLAN §3) — calculado AQUI, nunca no JSX:
//  • fun     → settleable=false (red_card/corners): permanentemente "só por diversão".
//  • pending → exact_score ainda sem outcome (aguardando placar de 90').
//  • settled → exact_score liquidado (acertou/errou).
export type PalpiteLineState =
  | { kind: "fun" }
  | { kind: "pending" }
  | { kind: "settled"; result: "won" | "lost" };

export type PalpiteLineView = {
  id: string;
  type: PalpiteType;
  typeLabel: string;
  text: string;
  state: PalpiteLineState;
};

export type PalpiteSetView = {
  id: string;
  generatedAt: Date;
  lines: PalpiteLineView[];
};

export type PalpitesView = {
  current: PalpiteSetView | null;
  previous: PalpiteSetView[];
};

// Deriva o estado de uma linha a partir de settleable + outcome. settleable=false
// (red_card/corners) → fun SEMPRE, independente de outcome (defense-in-depth: um
// fun-only nunca devia ter outcome, mas se tivesse, continua fun). settleable=true
// (exact_score) → settled quando há outcome, pending caso contrário.
function deriveState(
  line: PalpiteSetWithLines["palpites"][number],
): PalpiteLineState {
  if (!line.settleable) return { kind: "fun" };
  if (line.outcome === null) return { kind: "pending" };
  return { kind: "settled", result: line.outcome.result };
}

function toLineView(
  line: PalpiteSetWithLines["palpites"][number],
): PalpiteLineView {
  // `line.type` já é o enum canônico completo (DbPalpite["type"]) → sem cast; o
  // TYPE_LABEL é exhaustiveness-checked pelo TS (major F).
  const type = line.type;
  return {
    id: line.id,
    type,
    typeLabel: TYPE_LABEL[type],
    text: line.text,
    state: deriveState(line),
  };
}

function toSetView(set: PalpiteSetWithLines): PalpiteSetView {
  return {
    id: set.palpiteSet.id,
    generatedAt: set.palpiteSet.createdAt,
    lines: set.palpites.map(toLineView),
  };
}

/**
 * Adapta o histórico de palpite_sets (getPalpiteSetsForMatch, newest-first) pra
 * PalpitesView. `current = sets[0]`, `previous = sets.slice(1)` (a query já ordena
 * desc(createdAt)). DESCARTA o `aiCall` INTEGRALMENTE — custo/modelo/tokens NUNCA
 * cruzam pra view (ADR 0028 §1: palpite é predição, não recomendação de valor). A
 * derivação de estado (fun/pending/settled) vive em deriveState, fora do JSX.
 */
export function toPalpitesView(sets: PalpiteSetWithLines[]): PalpitesView {
  if (sets.length === 0) return { current: null, previous: [] };
  return {
    current: toSetView(sets[0]),
    previous: sets.slice(1).map(toSetView),
  };
}
