import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  NARRATOR_VERSION,
  NarratorOutputSchema,
  SYSTEM_PROMPT,
} from "@/lib/ai/markets/_narrator";
import {
  buildLiveNarratorMessage,
  checkLiveNarrationFidelity,
  LIVE_SYSTEM_PROMPT,
  liveNarratorCartridge,
  NARRATOR_LIVE_VERSION,
  templatedLiveNarration,
  type LiveNarratorDecision,
} from "@/lib/ai/markets/_narrator/live";

// Mesma lista do guard de tela (components/__tests__/no-bookmaker-copy.test.ts): o
// prompt ao vivo também não cita casa nenhuma.
const BOOKMAKER_NAME =
  /\b(betano|bet365|pinnacle|betfair|sportingbet|superbet|novibet|kto)\b/i;
const containsBookmakerName = (s: string) => BOOKMAKER_NAME.test(s);

const TEAMS = { home: "CR Flamengo", away: "Fluminense FC" };

function decision(over: Partial<LiveNarratorDecision> = {}): LiveNarratorDecision {
  return {
    teams: TEAMS,
    situation: { moment: "aos 63'", score: { home: 1, away: 0 }, red: { home: 0, away: 1 } },
    remainingGoals: { home: 0.48, away: 0.31 },
    readings: [
      {
        marketKey: "match_result",
        marketLabel: "Resultado final",
        line: null,
        selections: [
          { key: "home", label: "Vitória do CR Flamengo", modelProbPct: 71.4, decided: false },
          { key: "draw", label: "Empate", modelProbPct: 21.2, decided: false },
          { key: "away", label: "Vitória do Fluminense FC", modelProbPct: 7.4, decided: false },
        ],
      },
      {
        marketKey: "btts",
        marketLabel: "Ambas marcam",
        line: null,
        selections: [
          { key: "yes", label: "Ambas marcam: sim", modelProbPct: 27.9, decided: false },
          { key: "no", label: "Ambas marcam: não", modelProbPct: 72.1, decided: false },
        ],
      },
    ],
    ...over,
  };
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

describe("narrator_live_v1", () => {
  it("versão própria; o narrador de pré-jogo fica intacto", () => {
    expect(NARRATOR_LIVE_VERSION).toBe("narrator_live_v1");
    expect(liveNarratorCartridge.version).toBe("narrator_live_v1");
    expect(NARRATOR_VERSION).toBe("narrator_v1.1");
    expect(LIVE_SYSTEM_PROMPT).not.toBe(SYSTEM_PROMPT);
    // Mesmo schema e mesma ferramenta do pré-jogo (só o texto muda).
    expect(liveNarratorCartridge.outputSchema).toBe(NarratorOutputSchema);
    expect(liveNarratorCartridge.toolName).toBe("submit_narration");
  });

  it("prompt pinado (mudou? bump da versão + commit prompt:)", () => {
    expect(sha(LIVE_SYSTEM_PROMPT)).toMatchInlineSnapshot(`"ef74c6b66e5866fc"`);
  });

  it("o prompt diz que não há aposta ao vivo e proíbe os termos de aposta", () => {
    expect(LIVE_SYSTEM_PROMPT).toContain("sem odd ao vivo, o app não recomenda aposta");
    expect(LIVE_SYSTEM_PROMPT).toMatch(/sem "aposte", sem falar em valor, edge ou stake/);
    expect(containsBookmakerName(LIVE_SYSTEM_PROMPT)).toBe(false);
  });

  it("mensagem: situação do jogo (momento, placar, expulsões) e a leitura de todos os mercados", () => {
    const msg = buildLiveNarratorMessage(decision(), { leagueLabel: "Brasileirão Série A" });
    expect(msg).toContain("## Situação do jogo");
    expect(msg).toContain("- Momento: aos 63'");
    expect(msg).toContain("- Placar: CR Flamengo 1 × 0 Fluminense FC");
    expect(msg).toContain("- Expulsões (cartão vermelho): Fluminense FC 1");
    expect(msg).toContain("## Leitura ao vivo (fixa — não altere)");
    expect(msg).toContain("Vitória do CR Flamengo 71,4%");
    expect(msg).toContain("Ambas marcam: não 72,1%");
    expect(msg).not.toMatch(/\bodd\s+\d|implícit|edge/i);
    expect(containsBookmakerName(msg)).toBe(false);
  });

  it("seleção decidida vai marcada", () => {
    const d = decision({
      readings: [
        {
          marketKey: "over_under",
          marketLabel: "Total de gols",
          line: 2.5,
          selections: [
            { key: "over", label: "Mais de 2,5 gols (over 2,5)", modelProbPct: 100, decided: true },
            { key: "under", label: "Menos de 2,5 gols (under 2,5)", modelProbPct: 0, decided: true },
          ],
        },
      ],
    });
    expect(buildLiveNarratorMessage(d, { leagueLabel: "x" })).toContain(
      "Mais de 2,5 gols (over 2,5) 100,0% (já decidido)",
    );
  });

  describe("fidelidade", () => {
    const ok = {
      rationale:
        "Aos 63', o CR Flamengo vence por 1 × 0 e joga com um a mais. O modelo dá 71,4% para a vitória do mandante e 21,2% para o empate.",
      key_factors: ["Placar 1 × 0 aos 63'", "Fluminense FC com um expulso"],
    };

    it("aceita os percentuais da leitura", () => {
      expect(checkLiveNarrationFidelity(ok, decision())).toEqual({ ok: true });
    });

    it("reprova percentual inventado", () => {
      const r = checkLiveNarrationFidelity(
        { ...ok, rationale: "Aos 63', 1 × 0. O mandante tem 80% de chance." },
        decision(),
      );
      expect(r.ok).toBe(false);
    });

    it("reprova recomendação de qualquer seleção", () => {
      const r = checkLiveNarrationFidelity(
        { ...ok, rationale: "Aos 63', 1 × 0: recomendamos o empate." },
        decision(),
      );
      expect(r.ok).toBe(false);
    });

    it.each(["aposte no mandante", "há valor aqui", "o edge é grande", "stake baixa"])(
      "reprova termo de aposta: %s",
      (phrase) => {
        const r = checkLiveNarrationFidelity(
          { ...ok, rationale: `Aos 63', 1 × 0; ${phrase}.` },
          decision(),
        );
        expect(r.ok).toBe(false);
      },
    );
  });

  it("fallback templado: momento, placar, sem aposta, só os números do 1º mercado — e passa na própria fidelidade", () => {
    const out = templatedLiveNarration(decision());
    expect(NarratorOutputSchema.safeParse(out).success).toBe(true);
    expect(out.rationale).toContain("Aos 63', CR Flamengo 1 × 0 Fluminense FC.");
    expect(out.rationale).toContain("Sem odd ao vivo, o app não recomenda aposta.");
    expect(out.rationale).toContain("71,4%");
    expect(out.rationale).not.toContain("72,1%");
    expect(out.key_factors.length).toBeGreaterThanOrEqual(2);
    expect(checkLiveNarrationFidelity(out, decision())).toEqual({ ok: true });
  });
});
