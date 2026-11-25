import { describe, expect, it } from "vitest";

import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAnswers, JudgmentQuestionId } from "@/lib/ai/judgments/types";
import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";
import type { MatchModelNews, StoredNewsClaim } from "@/lib/match-news/types";

import { newsFactorsDetail, storedNewsStep } from "../details";
import { STEP_NOTES, newsBatchTimeLabel, newsFactorsLabel } from "../steps";

// O passo de notícias do lote guardado (#672, PLAN-672 §8.1 + ajustes 5 e 10).

const TEAMS = { home: "SE Palmeiras", away: "CR Flamengo" };
// 13h00 em Brasília.
const NOW = new Date("2026-11-21T16:00:00Z");
const AT = new Date("2026-11-21T15:30:00Z");

function answers(over: Partial<Record<JudgmentQuestionId, number>> = {}): JudgmentAnswers {
  return Object.fromEntries(
    JUDGMENT_QUESTION_IDS.map((id) => [id, { value: over[id] ?? 0.3, confidence: null }]),
  ) as JudgmentAnswers;
}

function claim(over: Partial<StoredNewsClaim>): StoredNewsClaim {
  return {
    team: "away",
    topic: "absence",
    role: "defense",
    index: 0,
    status: "unverified",
    evidence: "",
    sides: [],
    playerChecks: [],
    signals: [],
    sources: ["N1"],
    ...over,
  } as StoredNewsClaim;
}

function news(claims: StoredNewsClaim[], notes: string[] = []): MatchModelNews {
  return {
    batchId: "b1",
    itemsRead: 12,
    claims,
    sources: [],
    evidence: {},
    moved: [],
    notes,
    versions: { extract: "match_news_extract_v1", newsEvidence: "news_evidence_v1" },
  };
}

describe("newsBatchTimeLabel / newsFactorsLabel", () => {
  it("hora de Brasília: hoje, ontem e outro dia", () => {
    expect(newsBatchTimeLabel(AT, NOW)).toBe("às 12h30");
    expect(newsBatchTimeLabel(new Date("2026-11-21T01:30:00Z"), NOW)).toBe("ontem às 22h30");
    expect(newsBatchTimeLabel(new Date("2026-11-18T12:05:00Z"), NOW)).toBe("em 18/11 às 09h05");
  });

  it("'N notícias do ge lidas às HH · K viraram fator', com plural e sem a parte do fator", () => {
    const base = { at: AT, now: NOW };
    expect(newsFactorsLabel({ ...base, itemsRead: 12, factors: 1 })).toBe(
      "12 notícias do ge lidas às 12h30 · 1 virou fator",
    );
    expect(newsFactorsLabel({ ...base, itemsRead: 12, factors: 2 })).toBe(
      "12 notícias do ge lidas às 12h30 · 2 viraram fator",
    );
    expect(newsFactorsLabel({ ...base, itemsRead: 1, factors: 0 })).toBe(
      "1 notícia do ge lida às 12h30 · nenhuma virou fator",
    );
    expect(newsFactorsLabel({ ...base, itemsRead: 3, factors: null })).toBe(
      "3 notícias do ge lidas às 12h30",
    );
    expect(newsFactorsLabel({ ...base, itemsRead: 0, factors: 0 })).toBe(STEP_NOTES.newsNoneGe);
  });
});

describe("newsFactorsDetail", () => {
  const JEV = answers({ high_stakes_home: 0.9 });

  it("fator movido, já considerado, contradito e nota, em linhas do código", () => {
    const lines = newsFactorsDetail(
      news(
        [
          claim({ signals: [{ questionId: "defense_weakened_away", strength: "unverified" }] }),
          claim({
            index: 1,
            topic: "stakes",
            team: "home",
            role: undefined,
            status: "confirmed",
            signals: [{ questionId: "high_stakes_home", strength: "confirmed" }],
            sources: ["N2", "N3"],
          }),
          claim({ index: 2, status: "contradicted", sources: ["N4"] }),
        ],
        ["segundo o ge (não conferido): troca de técnico no CR Flamengo"],
      ),
      JEV,
      TEAMS,
    );
    expect(lines).toEqual([
      "Desfalque na defesa do CR Flamengo, segundo o ge (não conferido com os nossos dados)",
      "2 notícias confirmaram o que o modelo já considerava",
      "1 notícia contradita pelos nossos dados ficou de fora",
      "Segundo o ge (não conferido): troca de técnico no CR Flamengo, sem efeito nos números",
    ]);
    for (const l of lines) {
      expect(containsValueLanguage(l)).toBe(false);
      expect(l).not.toMatch(/\d+(,\d+)?\s*%/);
    }
  });

  it("sem JEV, o sinal confirmado move e sai 'confirmado pelos nossos dados'", () => {
    const lines = newsFactorsDetail(
      news([
        claim({
          status: "confirmed",
          signals: [{ questionId: "defense_weakened_away", strength: "confirmed" }],
        }),
      ]),
      null,
      TEAMS,
    );
    expect(lines).toEqual([
      "Desfalque na defesa do CR Flamengo, segundo o ge (confirmado pelos nossos dados)",
    ]);
  });
});

describe("storedNewsStep", () => {
  it("aplicado: rótulo com '· K viraram fator' e as linhas do fator", () => {
    const step = storedNewsStep({
      status: "ok",
      itemsRead: 12,
      checkedAt: AT,
      applied: {
        news: news([
          claim({ signals: [{ questionId: "defense_weakened_away", strength: "unverified" }] }),
        ]),
        jev: answers(),
        factorItems: 1,
        teams: TEAMS,
      },
      now: NOW,
    });
    expect(step.label).toBe("12 notícias do ge lidas às 12h30 · 1 virou fator");
    expect(step.detail).toEqual([
      "Desfalque na defesa do CR Flamengo, segundo o ge (não conferido com os nossos dados)",
    ]);
  });

  it("só texto (motor 'llm' ou notícia sem poder virar fator): sem a parte do fator", () => {
    const step = storedNewsStep({ status: "ok", itemsRead: 4, checkedAt: AT, applied: null, now: NOW });
    expect(step).toEqual({ label: "4 notícias do ge lidas às 12h30", detail: [] });
  });

  it("lote empty ou nenhuma na janela: a frase do ge vazio e quando foi conferido", () => {
    for (const s of [
      { status: "empty" as const, itemsRead: 0 },
      { status: "ok" as const, itemsRead: 0 },
    ]) {
      expect(storedNewsStep({ ...s, checkedAt: AT, applied: null, now: NOW })).toEqual({
        label: STEP_NOTES.newsNoneGe,
        detail: ["Notícias do ge conferidas pela última vez às 12h30"],
      });
    }
  });
});
