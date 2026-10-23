// Vocabulário do campo `lineup` do state JEV (#619), num módulo sem dependências:
// questions.ts cita estas strings nos criteria e é importado por código de cliente
// (via lib/user-palpite/types), que não deve puxar state.ts. Mudou uma string, bump
// JUDGMENTS_VERSION.

export type LineupChangeBucket = "0-2" | "3-4" | "5+";

export const LINEUP_NOT_ANNOUNCED = "not announced";
export const LINEUP_CHANGES_UNKNOWN = "announced, changes unknown";
export const LINEUP_CHANGES_LABEL: Record<LineupChangeBucket, string> = {
  "0-2": "announced, 0 to 2 voluntary changes from the usual starting lineup",
  "3-4": "announced, 3 to 4 voluntary changes from the usual starting lineup",
  "5+": "announced, 5 or more voluntary changes from the usual starting lineup",
};
