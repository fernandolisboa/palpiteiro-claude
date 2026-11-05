// Onde fica o "analisar" na linha da lista de jogos no desktop (Fernando, 2026-11-05).
// Coluna `ai_config.list_analyze_placement` (text validado na app, como progress_mascot),
// escolhida em /admin/ia: o ícone no lugar da setinha (padrão) ou o botão largo embaixo
// das odds. O celular tem um lugar só (no cabeçalho da linha, acima das odds).
export const LIST_ANALYZE_PLACEMENTS = ["lateral", "embaixo"] as const;
export type ListAnalyzePlacement = (typeof LIST_ANALYZE_PLACEMENTS)[number];

export const DEFAULT_LIST_ANALYZE_PLACEMENT: ListAnalyzePlacement = "lateral";

export const LIST_ANALYZE_PLACEMENT_LABEL: Record<
  ListAnalyzePlacement,
  string
> = {
  lateral: "Ícone ao lado das odds",
  embaixo: "Botão embaixo das odds",
};

export function isListAnalyzePlacement(v: unknown): v is ListAnalyzePlacement {
  return (
    typeof v === "string" &&
    (LIST_ANALYZE_PLACEMENTS as readonly string[]).includes(v)
  );
}
