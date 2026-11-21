import { describe, expect, it } from "vitest";

import {
  checkVerdictCoherence,
  teamAliases,
  templateNarrative,
  templateVerdict,
  type CoherenceTeams,
} from "@/lib/ai/palpites/verdict-coherence";
import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";

type TestPick = { outcome: "home" | "draw" | "away"; score: { home: number; away: number } };

const PAL_FLA: CoherenceTeams = {
  home: "Palmeiras",
  away: "Flamengo",
  homeAliases: ["SE Palmeiras"],
  awayAliases: ["CR Flamengo"],
};
const homeWin: TestPick = { outcome: "home", score: { home: 2, away: 1 } };
const awayWin: TestPick = { outcome: "away", score: { home: 1, away: 2 } };
const draw: TestPick = { outcome: "draw", score: { home: 1, away: 1 } };

describe("teamAliases", () => {
  it("tira tokens comuns aos dois nomes e sufixos de clube", () => {
    expect(teamAliases(["Atlético-MG"], ["Atlético-GO"])).toEqual(["atletico mg"]);
    expect(teamAliases(["Man City"], ["Man United"])).toEqual(["man city", "city"]);
    expect(teamAliases(["CR Flamengo"], ["SE Palmeiras"])).toEqual(["cr flamengo", "flamengo"]);
  });
});

describe("checkVerdictCoherence — corpus (T6)", () => {
  it("não dispara em vereditos coerentes", () => {
    const ok: [string, TestPick, CoherenceTeams][] = [
      ["Sem zebra: Palmeiras vence", homeWin, PAL_FLA],
      ["O Flamengo assusta, mas o Palmeiras leva", homeWin, PAL_FLA],
      ["Vai dar Palmeiras, 2 a 1", homeWin, PAL_FLA],
      ["Verdão por 2x1 no Allianz", homeWin, PAL_FLA],
      ["Mengão leva fora de casa", awayWin, PAL_FLA],
      ["Flamengo vence por 2 a 1 em São Paulo", awayWin, PAL_FLA],
      ["Palmeiras vence, sem chance de empate", homeWin, PAL_FLA],
      ["Empate truncado nesse clássico", draw, PAL_FLA],
      ["O Flamengo arranca o empate", draw, PAL_FLA],
      ["Vai dar Atlético-MG", homeWin, { home: "Atlético-MG", away: "Atlético-GO" }],
      ["Galo passa pelo Dragão", homeWin, { home: "Atlético-MG", away: "Atlético-GO" }],
      ["City leva o clássico", homeWin, { home: "Man City", away: "Man United" }],
      ["Manchester City atropela", homeWin, { home: "Man City", away: "Man United" }],
    ];
    for (const [verdict, pick, teams] of ok) {
      expect(checkVerdictCoherence(verdict, pick.outcome, pick, teams), verdict).toEqual({
        ok: true,
      });
    }
  });

  it("verdictOutcome divergente dispara (estrutural)", () => {
    const r = checkVerdictCoherence("Vai dar Palmeiras", "home", awayWin, PAL_FLA);
    expect(r.ok).toBe(false);
  });

  it("cita só o outro time num palpite de vitória → dispara", () => {
    expect(checkVerdictCoherence("Vai dar Flamengo", "home", homeWin, PAL_FLA).ok).toBe(false);
    expect(
      checkVerdictCoherence("Vai dar Atlético-GO", "home", homeWin, {
        home: "Atlético-MG",
        away: "Atlético-GO",
      }).ok,
    ).toBe(false);
    expect(
      checkVerdictCoherence("United surpreende", "home", homeWin, {
        home: "Man City",
        away: "Man United",
      }).ok,
    ).toBe(false);
  });

  it("placar diferente do palpite → dispara (em qualquer ordem só o mesmo par passa)", () => {
    expect(checkVerdictCoherence("Palmeiras 3 x 1", "home", homeWin, PAL_FLA).ok).toBe(false);
    expect(checkVerdictCoherence("1–1 no fim", "draw", { ...draw, score: { home: 0, away: 0 } }, PAL_FLA).ok).toBe(false);
    expect(checkVerdictCoherence("Palmeiras vence por 1 a 2?", "home", homeWin, PAL_FLA).ok).toBe(true);
  });

  it("'empate' num palpite de vitória, sem citar o vencedor → dispara", () => {
    expect(checkVerdictCoherence("Empate truncado", "home", homeWin, PAL_FLA).ok).toBe(false);
    expect(checkVerdictCoherence("Clássico empata no fim", "away", awayWin, PAL_FLA).ok).toBe(false);
  });

  it("acento e caixa não importam", () => {
    expect(checkVerdictCoherence("VAI DAR FLAMENGO", "home", homeWin, PAL_FLA).ok).toBe(false);
    expect(
      checkVerdictCoherence("vai dar atletico-go", "home", homeWin, {
        home: "Atlético-MG",
        away: "Atlético-GO",
      }).ok,
    ).toBe(false);
  });
});

describe("templates", () => {
  it("coerentes, sem % e sem linguagem de valor", () => {
    for (const pick of [homeWin, awayWin, draw]) {
      const verdict = templateVerdict(pick, PAL_FLA);
      const narrative = templateNarrative(pick, PAL_FLA);
      expect(checkVerdictCoherence(verdict, pick.outcome, pick, PAL_FLA)).toEqual({ ok: true });
      for (const text of [verdict, narrative]) {
        expect(text).not.toContain("%");
        expect(containsValueLanguage(text)).toBe(false);
      }
      expect(narrative).toContain(`${pick.score.home}–${pick.score.away}`);
    }
    expect(templateVerdict(awayWin, PAL_FLA)).toBe("Vai dar Flamengo");
    expect(templateVerdict(draw, PAL_FLA)).toBe("Empate entre Palmeiras e Flamengo");
  });
});
