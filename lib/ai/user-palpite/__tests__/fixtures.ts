import type { NarrationInput } from "@/lib/ai/user-palpite/narrate-cartridge";
import { scorelineMatrix } from "@/lib/quant/scoreline-model";
import { codeVerdict, palpiteLabel, readPalpite } from "@/lib/user-palpite/reading";
import type { UserPalpite } from "@/lib/user-palpite/types";

export const TEAMS = { home: "Flamengo", away: "Palmeiras" };

export function narrationInput(over: Partial<NarrationInput> = {}): NarrationInput {
  const palpite: UserPalpite = over.palpite ?? { kind: "score", home: 2, away: 0 };
  const read = (lh: number) =>
    readPalpite({ matrix: scorelineMatrix(lh, 1.0), lambdaHome: lh, lambdaAway: 1.0 }, palpite);
  const without = read(1.6);
  const withCtx = read(1.5);
  return {
    teams: TEAMS,
    competition: "Brasileirão",
    kickoffLabel: "20/05 16:00",
    palpite,
    palpiteLabel: palpiteLabel(palpite, TEAMS),
    modelLabel: "Dixon-Coles · JEV aplicado",
    jevApplied: true,
    without,
    with: withCtx,
    codeVerdict: codeVerdict(withCtx, palpite, []),
    claims: [
      {
        index: 0,
        teamLabel: "Palmeiras",
        topic: "absence",
        text: "o jogador citado, atacante, está fora",
        status: "unverifiable",
        evidence:
          "Não está na nossa lista de desfalques do Palmeiras; pode ser informação mais nova que a nossa.",
        effect: "ataque do Palmeiras ajustado para baixo",
      },
      {
        index: 1,
        teamLabel: "Flamengo",
        topic: "form",
        text: "o Flamengo vem de três vitórias",
        status: "contradicted",
        evidence: "Últimos 5 jogos do Flamengo: 1V 2E 2D.",
        effect: "nenhum",
      },
    ],
    facts: ["Forma (últimos jogos, do mais recente): Flamengo: V E E D D; Palmeiras: V V V E D"],
    ...over,
  };
}
