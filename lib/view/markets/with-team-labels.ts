import type { MarketPresentation } from "@/lib/view/markets/presentation";

// Rótulos de 1X2 e dupla chance com o NOME dos times na tela (#574 linha 4b):
// "Casa/Empate/Fora" vira "Palmeiras/Empate/Flamengo". Embrulha a presentation do
// registry SEM mutá-la: ela espelha o seed e também alimenta o texto do modelo
// (lib/ai/palpites/synthesis-input.ts, lib/ai/predict.ts), então o registry não muda.
// As frases da dupla chance são as mesmas da grade de apostas (lib/view/bet-slip.ts).

export type TeamLabels = { home: string; away: string };

function labelsFor(
  marketKey: string,
  teams: TeamLabels,
): Record<string, string> | null {
  if (marketKey === "match_result") {
    return { home: teams.home, draw: "Empate", away: teams.away };
  }
  if (marketKey === "double_chance") {
    return {
      home_or_draw: `${teams.home} ou empate`,
      away_or_draw: `Empate ou ${teams.away}`,
      home_or_away: `${teams.home} ou ${teams.away}`,
    };
  }
  return null;
}

/**
 * Presentation com os rótulos das seleções trocados pelo nome dos times (1X2 e
 * dupla chance). Outros mercados, ou `teams` ausente, devolvem a própria
 * presentation. Seleção desconhecida cai no rótulo original.
 */
export function withTeamLabels(
  p: MarketPresentation,
  teams: TeamLabels | undefined,
): MarketPresentation {
  if (!teams) return p;
  const labels = labelsFor(p.marketKey, teams);
  if (labels === null) return p;
  const label = (key: string, original: string) => (key in labels ? labels[key] : original);
  return {
    ...p,
    selectionLabel: (key) => label(key, p.selectionLabel(key)),
    outcomeLabel: (key, line) => label(key, p.outcomeLabel(key, line)),
    scenarioLabel: (key, line) => label(key, p.scenarioLabel(key, line)),
    framingLabel: (key, line) => label(key, p.framingLabel(key, line)),
    betSummary: (key, line) => {
      const original = p.betSummary(key, line);
      return { ...original, market: label(key, original.market) };
    },
  };
}
