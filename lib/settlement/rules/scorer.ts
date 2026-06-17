import {
  assistSelectionKey,
  scorerSelectionKey,
} from "@/lib/odds/market-descriptor";
import type { SettlementRule } from "@/lib/settlement/registry";
import { SettlementError, type ResultData } from "@/lib/settlement/schemas";

// Factory de regra de settlement pra mercados independent_binary (#290): artilheiro
// e assistência compartilham a SPINE skip-over-wrong-settle, diferindo só no campo
// de resultData a casar (scorers vs assisters) e na função de chave de seleção.
//
// Spine (prefer-skip sobre silent-wrong-settle):
//   - eventsAvailable !== true OU a lista (scorers/assisters) undefined/null →
//     SettlementError → settle.ts bucketa em errors → fica PENDING (NUNCA fabrica
//     loss; ver memória "prefer skip over silent wrong settle").
//   - selectionKey inválida → SettlementError (defensivo).
//   - com eventsAvailable===true E lista autoritativa de 90': WON sse há uma entrada
//     casando a seleção (por playerId quando disponível, senão por nome canônico
//     slugado), senão LOST.
//
// A lista entregue por settle.ts já é REGULATION-90 e EXCLUI own goals (filtragem no
// normalizer + merge); a regra só decide pertinência.
function makeScorerRule(
  field: "scorers" | "assisters",
  keyFn: (name: string) => string | null,
): SettlementRule {
  return (selection, _marketParams, resultData: ResultData) => {
    if (resultData.eventsAvailable !== true) {
      throw new SettlementError(
        `${field} settlement needs eventsAvailable=true; events unavailable → leave pending`,
        { eventsAvailable: resultData.eventsAvailable },
      );
    }
    const list = resultData[field];
    if (list === undefined || list === null) {
      throw new SettlementError(
        `${field} settlement has no authoritative event list → leave pending`,
        { field },
      );
    }
    if (!selection || typeof selection !== "string") {
      throw new SettlementError("invalid selection key", { selection });
    }
    // Casa por nome canônico slugado (sem playerId estável no fio). A chave de
    // seleção é scorer_<slug>/assist_<slug>; recomputa o slug de cada entrada
    // autoritativa e compara. (playerId fica como reforço futuro quando o fio for
    // confirmado — hoje o slug é a identidade.)
    const matched = list.some((entry) => keyFn(entry.canonicalName) === selection);
    return matched ? "won" : "lost";
  };
}

// Artilheiro (anytime scorer): casa a seleção contra resultData.scorers.
export const anytimeScorerRule: SettlementRule = makeScorerRule(
  "scorers",
  scorerSelectionKey,
);

// Assistência: casa a seleção contra resultData.assisters.
export const assistRule: SettlementRule = makeScorerRule(
  "assisters",
  assistSelectionKey,
);
