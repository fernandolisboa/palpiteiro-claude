// Abas da página do jogo (#576), como dado: vai pro bundle do cliente (MatchTabs, tour),
// então sem Zod nem imports de servidor. Os rótulos ficam em components/match-tabs.tsx
// (literais, o /como-usar confere que existem na tela). Uma aba nova (ex.: "Ao vivo",
// #580) é uma entrada aqui + um slot no MatchTabs.

export const MATCH_TAB_IDS = ["mercados", "seu-palpite", "dados"] as const;
export type MatchTab = (typeof MATCH_TAB_IDS)[number];

export const DEFAULT_MATCH_TAB: MatchTab = "mercados";

/** Query param da aba (`/match/[id]?aba=dados`). */
export const MATCH_TAB_PARAM = "aba";

export function isMatchTab(value: unknown): value is MatchTab {
  return (MATCH_TAB_IDS as readonly unknown[]).includes(value);
}

/** `?aba=` tolerante: inválido, ausente ou repetido (array) cai na aba padrão. */
export function parseMatchTab(raw: unknown): MatchTab {
  return isMatchTab(raw) ? raw : DEFAULT_MATCH_TAB;
}
