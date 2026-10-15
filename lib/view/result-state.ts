// Estado de resultado na TELA (ADR 0056, linha 18 da revisão de design): o selo único
// `ResultBadge` (components/result-badge.tsx) e o filtro de status do desempenho leem
// as palavras daqui. Puro e sem imports: seguro em componente "use client". Os
// valores do banco (won/lost/push/void) não mudam; "pending" é o "ainda sem placar".

export type ResultState = "won" | "lost" | "push" | "void" | "pending";

export const RESULT_LABEL: Record<ResultState, string> = {
  won: "Acertou",
  lost: "Errou",
  push: "Devolvida",
  void: "Anulada",
  pending: "Em aberto",
};
