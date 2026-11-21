import {
  computeUnderdogFacts,
  underdogBaseFromSnapshot,
} from "@/lib/underdog/compute";
import { buildFactsBlock, complementPct } from "@/lib/underdog/facts";
import type { UnderdogFacts } from "@/lib/underdog/types";
import type { UnderdogReview } from "@/lib/ai/underdog/schema";
import { KICKOFF, NOW, snapshot } from "@/lib/underdog/__tests__/fixtures";

// Palmeiras 1,4 × Flamengo 1,0 (exemplo da proposta), Flamengo azarão, com um sinal de
// confronto direto. Os números saem do código de verdade.

export const TEAMS = { home: "Palmeiras", away: "Flamengo" };
export const CTX = {
  teams: TEAMS,
  competition: "Brasileirão Série A",
  kickoffLabel: "sáb, 21 nov, 16:30",
};

export function facts(): UnderdogFacts {
  return computeUnderdogFacts(
    underdogBaseFromSnapshot(snapshot(), KICKOFF, NOW)!,
    [{ kind: "h2h", games: 5, underdogWins: 3, favoriteWins: 1 }]
  );
}

export const block = () => buildFactsBlock(facts(), CTX);

const r = (n: number) => Math.round(n);

/** Um rascunho bom: 4 frases, todas com números do bloco. */
export function goodDraft() {
  const f = facts();
  const c1 = f.scenarios[0];
  return {
    frases: [
      {
        texto: `Flamengo vence em ${r(f.chances.underdog)}% das simulações, quase 1 jogo em cada ${Math.round(100 / f.chances.underdog)}.`,
        fatos: ["P1"],
      },
      {
        texto: `Se o Flamengo estiver vencendo por 1 x 0 aos 30', a chance passa de ${r(c1.beforePct)}% para ${r(c1.afterPct)}%.`,
        fatos: ["C1"],
      },
      {
        texto: "O Flamengo venceu 3 dos últimos 5 confrontos.",
        fatos: ["F1"],
      },
      {
        texto: `O placar de zebra mais provável é ${f.scorelines[0].home} x ${f.scorelines[0].away}.`,
        fatos: ["S1"],
      },
    ],
  };
}

export function goodReview(n = 4): UnderdogReview {
  return {
    avaliacoes: Array.from({ length: n }, (_, i) => ({
      indice: i,
      veredito: "apoiada",
      motivo: "Os números estão no bloco.",
    })),
    contraponto: `Nos outros ${complementPct(facts())}% o jogo empata ou o Palmeiras vence.`,
  };
}
