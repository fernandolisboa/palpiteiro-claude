import { describe, expect, it } from "vitest";

import {
  templateCounterpoint,
  templatedNarrative,
  templateSentences,
} from "@/lib/ai/underdog/fallback";
import {
  checkAdvocateSentence,
  checkCounterpoint,
} from "@/lib/ai/underdog/guards";
import { buildFactsBlock } from "@/lib/underdog/facts";
import type { UnderdogFacts } from "@/lib/underdog/types";

import { CTX, facts, TEAMS } from "./fixtures";

describe("texto padrão", () => {
  it("passa nas próprias guardas", () => {
    const f = facts();
    const b = buildFactsBlock(f, CTX);
    const sentences = templateSentences(f, TEAMS);
    expect(sentences.length).toBeGreaterThanOrEqual(3);
    for (const s of sentences) {
      expect(
        checkAdvocateSentence({ texto: s.text, fatos: s.facts }, b)
      ).toEqual({ ok: true });
    }
    expect(checkCounterpoint(templateCounterpoint(f, TEAMS), b, [])).toEqual({
      ok: true,
    });
  });

  it("passa nas guardas com cada tipo de cenário e de sinal no topo", () => {
    const base = facts();
    const variants: UnderdogFacts[] = [
      { ...base, scenarios: base.scenarios.filter((c) => c.id === "red_60") },
      {
        ...base,
        scenarios: base.scenarios.filter((c) => c.id === "absences_max"),
      },
      { ...base, signals: [{ kind: "jev", factor: "rotation_risk" }] },
      {
        ...base,
        signals: [{ kind: "form", underdog: ["W", "W"], favorite: ["L", "D"] }],
      },
      { ...base, signals: [{ kind: "absences", favorite: 5, underdog: 0 }] },
      { ...base, scenarios: [], signals: [] },
    ];
    for (const f of variants) {
      const b = buildFactsBlock(f, CTX);
      for (const s of templateSentences(f, TEAMS)) {
        expect(
          checkAdvocateSentence({ texto: s.text, fatos: s.facts }, b),
          s.text
        ).toEqual({
          ok: true,
        });
      }
    }
  });

  it("cenário de maior Δ e o complemento arredondado", () => {
    const f = facts();
    const best = [...f.scenarios].sort(
      (a, b) => b.afterPct - b.beforePct - (a.afterPct - a.beforePct)
    )[0];
    expect(templateSentences(f, TEAMS)[1].text).toContain(
      `${Math.round(best.afterPct)}%`
    );
    expect(templateCounterpoint(f, TEAMS)).toBe(
      `Nos outros ${Math.round(f.chances.draw) + Math.round(f.chances.favorite)}% o jogo termina empatado (${Math.round(f.chances.draw)}%) ou com vitória de Palmeiras (${Math.round(f.chances.favorite)}%).`
    );
  });

  it("complemento = soma dos inteiros exibidos (25,4 + 54,4 → 25% + 54% = 79%)", () => {
    const base = facts();
    const f: UnderdogFacts = {
      ...base,
      chances: { underdog: 20.2, draw: 25.4, favorite: 54.4 },
    };
    expect(templateCounterpoint(f, TEAMS)).toBe(
      "Nos outros 79% o jogo termina empatado (25%) ou com vitória de Palmeiras (54%)."
    );
    const b = buildFactsBlock(f, CTX);
    expect(b.allowed.percents).toContain(79);
    expect(b.allowed.percents).not.toContain(80);
    expect(b.text).toContain("Somados, empate ou Palmeiras: 79%.");
    expect(checkCounterpoint(templateCounterpoint(f, TEAMS), b, [])).toEqual({
      ok: true,
    });
  });

  it("narrativa padrão: sem veredito, sem família", () => {
    const n = templatedNarrative(facts(), TEAMS, 4);
    expect(n.sentences.every((s) => s.verdict === null)).toBe(true);
    expect(n).toMatchObject({
      advocateFamily: null,
      verdicts: null,
      total: 4,
      cut: 4,
    });
  });
});
