// Dados fictícios das ilustrações da landing (ADR 0059), num lugar só. Times
// inventados, com monograma (sem bandeira nem escudo: nada externo, nenhum <img>).
// Uma história coerente: "poucos gols", placar provável 1–0, final 1 × 0, então a
// aposta "Menos de 2,5 gols" fecha com o resto. Nenhuma odd, stake, vantagem, R$ ou
// pote: a ilustração mostra o produto, não um número de desempenho.

export type PreviewTeam = { name: string; short: string; hue: number };

export const PREVIEW_HOME: PreviewTeam = { name: "Coqueiros FC", short: "COQ", hue: 145 };
export const PREVIEW_AWAY: PreviewTeam = { name: "Serra Azul", short: "SER", hue: 240 };

export const PREVIEW_PALPITE = {
  verdict: "Coqueiros leva num jogo de poucos gols",
  confidence: "media",
  probableScore: { home: 1, away: 0 },
} as const;

// Rótulos no formato da tela de Suas apostas (`slipLegLabel`).
export const PREVIEW_SLIP_LEGS = [
  `Vitória do ${PREVIEW_HOME.name}`,
  "Menos de 2,5 gols",
] as const;

export const PREVIEW_FINAL_SCORE = { home: 1, away: 0 } as const;

export type PreviewPoolEntry = {
  name: string;
  home: number;
  away: number;
  won: boolean;
};

// Placar exato de cada amigo; quem acertou o 1 × 0 ganha.
export const PREVIEW_POOL_ENTRIES: readonly PreviewPoolEntry[] = [
  { name: "Ana", home: 1, away: 0, won: true },
  { name: "Beto", home: 1, away: 1, won: false },
  { name: "Caio", home: 0, away: 2, won: false },
];
