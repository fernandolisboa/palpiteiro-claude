import { describe, expect, it } from "vitest";

import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";
import { templatedNarrative } from "@/lib/ai/underdog/fallback";
import { NEWS_EVIDENCE_VERSION } from "@/lib/match-news/apply";
import type { MatchModelNews, StoredNewsClaim } from "@/lib/match-news/types";
import { computeUnderdogFacts, underdogBaseFromSnapshot } from "@/lib/underdog/compute";
import { UNDERDOG_CALC_VERSION } from "@/lib/underdog/constants";
import { buildFactsBlock } from "@/lib/underdog/facts";
import { signalLabel, signalOrigin } from "@/lib/underdog/labels";
import { newsSignals } from "@/lib/underdog/signals";
import { UnderdogFactsSchema, UnderdogSignalSchema } from "@/lib/underdog/types";
import { toUnderdogPanelView } from "@/lib/view/underdog";

import { answers, KICKOFF, NOW, snapshot } from "./fixtures";

// Sinal de notícia do ge no painel do azarão (#672, C2; underdog_calc_v2). Azarão =
// Flamengo (visitante), favorito = Palmeiras (mandante).

const TEAMS = { home: "Palmeiras", away: "Flamengo" };
const CTX = { teams: TEAMS, competition: "Brasileirão Série A", kickoffLabel: "sáb, 21 nov, 16:30" };
const JEV = answers();
const URL1 = "https://ge.globo.com/futebol/times/palmeiras/noticia/1.ghtml";

function claim(over: Partial<StoredNewsClaim>): StoredNewsClaim {
  return {
    team: "home",
    topic: "absence",
    role: "defense",
    index: 0,
    status: "unverified",
    evidence: "",
    sides: [],
    playerChecks: [],
    signals: [{ questionId: "defense_weakened_home", strength: "unverified" }],
    sources: ["N1"],
    ...over,
  } as StoredNewsClaim;
}

function news(over: Partial<MatchModelNews> = {}): MatchModelNews {
  return {
    batchId: "b-1",
    itemsRead: 6,
    claims: [claim({})],
    sources: [{ ref: "N1", url: URL1, title: "Palmeiras perde zagueiro titular para o clássico" }],
    evidence: { defense_weakened_home: 0.7 },
    moved: ["defense_weakened_home"],
    notes: [],
    versions: { extract: "match_news_extract_v1", newsEvidence: NEWS_EVIDENCE_VERSION },
    ...over,
  };
}

const snap = (n: MatchModelNews) =>
  snapshot({
    jevStatus: "applied",
    judgments: {
      applied: true,
      answers: JEV,
      multipliers: null,
      versions: { judgments: "j", weights: "w", jevModel: "m", jevModelServed: "m" },
      failure: null,
      stateHash: "h",
      aiCallId: null,
      reusedFromPredictionId: null,
      reusedFromModelSnapshotId: null,
      news: n,
    },
  });

describe("newsSignals", () => {
  it("fator do favorito movido pela notícia vira sinal a favor, com a matéria citada", () => {
    expect(newsSignals("away", news(), JEV)).toEqual([
      {
        kind: "news",
        factor: "defense_weakened",
        strength: "unverified",
        ref: "N1",
        url: URL1,
        title: "Palmeiras perde zagueiro titular para o clássico",
      },
    ]);
  });

  it("fator do próprio azarão (contra ele) não entra; peso do jogo do azarão entra", () => {
    const against = news({
      claims: [claim({ team: "away", signals: [{ questionId: "defense_weakened_away", strength: "unverified" }] })],
    });
    expect(newsSignals("away", against, JEV)).toEqual([]);
    const stakes = news({
      claims: [
        claim({ topic: "stakes", team: "away", role: undefined, signals: [{ questionId: "high_stakes_away", strength: "unverified" }] }),
      ],
    });
    expect(newsSignals("away", stakes, JEV)).toMatchObject([{ kind: "news", factor: "high_stakes" }]);
  });

  it("o que o JEV já considerava não vira sinal de notícia (nunca repete o 'jev')", () => {
    const high = answers({ defense_weakened_home: 0.8 });
    expect(newsSignals("away", news(), high)).toEqual([]);
    expect(newsSignals("away", null, JEV)).toEqual([]);
  });

  it("título com casa de aposta ou linguagem de valor: some; URL não-https: some", () => {
    const betano = news({
      sources: [{ ref: "N1", url: URL1, title: "Palmeiras x Flamengo pelo Brasileirão Betano" }],
    });
    expect(newsSignals("away", betano, JEV)[0]).toMatchObject({ url: URL1, title: null });
    const odds = news({ sources: [{ ref: "N1", url: URL1, title: "As odds do clássico" }] });
    expect(newsSignals("away", odds, JEV)[0]).toMatchObject({ title: null });
    const http = news({ sources: [{ ref: "N1", url: "http://ge.globo.com/x", title: "Ok" }] });
    expect(newsSignals("away", http, JEV)[0]).toMatchObject({ url: null, title: null });
  });
});

describe("painel com sinal de notícia", () => {
  const facts = computeUnderdogFacts(underdogBaseFromSnapshot(snap(news()), KICKOFF, NOW)!, [
    { kind: "h2h", games: 5, underdogWins: 3, favoriteWins: 1 },
  ]);
  const newsSignal = facts.signals.find((s) => s.kind === "news")!;

  it("calc v2; o sinal vem depois dos de dado e valida no schema", () => {
    expect(UNDERDOG_CALC_VERSION).toBe("underdog_calc_v2");
    expect(facts.signals.map((s) => s.kind)).toEqual(["h2h", "news"]);
    expect(UnderdogFactsSchema.safeParse(facts).success).toBe(true);
  });

  it("row antiga (calc v1, sem sinal de notícia) segue lendo", () => {
    const old = { ...facts, signals: [{ kind: "jev", factor: "rotation_risk" }] };
    expect(UnderdogFactsSchema.safeParse(old).success).toBe(true);
    expect(UnderdogSignalSchema.safeParse({ kind: "news", factor: "x" }).success).toBe(false);
  });

  it("rótulo do código, origem 'notícia' e link com o título seguro", () => {
    expect(signalLabel(newsSignal, { underdog: "Flamengo", favorite: "Palmeiras" })).toBe(
      "Desfalque na defesa do Palmeiras, segundo o ge",
    );
    expect(signalOrigin(newsSignal)).toBe("notícia");
    const view = toUnderdogPanelView(
      { facts, narrative: templatedNarrative(facts, TEAMS), narrativeSource: "template" },
      TEAMS,
      "current",
    );
    const row = view.signals.find((s) => s.origin === "notícia")!;
    expect(row).toEqual({
      label: "Desfalque na defesa do Palmeiras, segundo o ge",
      origin: "notícia",
      note: expect.any(String),
      link: { url: URL1, title: "Palmeiras perde zagueiro titular para o clássico" },
    });
  });

  it("sem título seguro, a tela mostra só a frase (sem link)", () => {
    const f = { ...facts, signals: [{ ...newsSignal, title: "Brasileirão Betano: Palmeiras x Flamengo" }] };
    const view = toUnderdogPanelView(
      { facts: f, narrative: templatedNarrative(f, TEAMS), narrativeSource: "template" },
      TEAMS,
      "current",
    );
    expect(view.signals[0].link).toBeUndefined();
  });

  it("advogado: linha F# do código com a conferência, sem título, sem URL, sem valor", () => {
    const block = buildFactsBlock(facts, CTX);
    const lines = block.text.split("\n");
    const line = lines.find((l) => l.startsWith("[F2]"))!;
    expect(line).toBe(
      "[F2] Segundo o ge, não conferido: desfalque na defesa do Palmeiras (esse fator já está na chance do modelo acima).",
    );
    const all = block.text;
    expect(all).not.toContain("zagueiro titular");
    expect(all).not.toContain("ge.globo.com");
    expect(containsValueLanguage(line)).toBe(false);
  });

  it("template do azarão: a frase do sinal de notícia diz que já está na chance", () => {
    const f = { ...facts, signals: [newsSignal] };
    const narrative = templatedNarrative(f, TEAMS);
    expect(narrative.sentences.map((x) => x.text)).toContain(
      "Desfalque na defesa do Palmeiras, segundo o ge (já está na chance).",
    );
  });
});
