import { describe, expect, it } from "vitest";

import { templatedNarrative } from "@/lib/ai/underdog/fallback";
import type { UnderdogViewRecord } from "@/lib/db/queries/underdog-views";
import {
  computeUnderdogFacts,
  underdogBaseFromSnapshot,
} from "@/lib/underdog/compute";
import type { UnderdogPick } from "@/lib/underdog/gate";
import { KICKOFF, NOW, snapshot } from "@/lib/underdog/__tests__/fixtures";
import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";
import {
  toUnderdogPanelView,
  toUnderdogSlot,
  type UnderdogTeaserData,
} from "@/lib/view/underdog";

const TEAMS = { home: "Palmeiras", away: "Flamengo" };
const base = underdogBaseFromSnapshot(snapshot(), KICKOFF, NOW)!;
const facts = computeUnderdogFacts(base, [
  { kind: "h2h", games: 5, underdogWins: 3, favoriteWins: 1 },
  { kind: "jev", factor: "rotation_risk" },
]);
const stored: UnderdogViewRecord = {
  id: "r",
  matchId: "m",
  modelSnapshotId: "s",
  createdAt: NOW,
  side: facts.side,
  facts,
  narrative: templatedNarrative(facts, TEAMS),
  narrativeSource: "template",
  versions: { calc: "c", advocate: "a", review: "r", matchModel: "m" },
};
const PALPITE = { probableScore: { home: 1, away: 0 } };
const data = (over: Partial<UnderdogTeaserData> = {}): UnderdogTeaserData => ({
  current: base.pick,
  baseStatus: "ok",
  stored: null,
  ...over,
});
const MOVED: UnderdogPick = {
  side: "away",
  chances: { underdog: 30, draw: 28, favorite: 42 },
};
const args = (
  over: Partial<Parameters<typeof toUnderdogSlot>[0]> = {}
): Parameters<typeof toUnderdogSlot>[0] => ({
  data: data(),
  preMatch: true,
  heroPalpite: PALPITE,
  runInFlight: false,
  teams: TEAMS,
  ...over,
});

describe("toUnderdogPanelView", () => {
  it("nomes de exibição, % inteiros, placares mandante × visitante, origem dos sinais", () => {
    const v = toUnderdogPanelView(stored, TEAMS, "current");
    expect(v.underdogName).toBe("Flamengo");
    expect(v.favoriteName).toBe("Palmeiras");
    expect(v.chances.underdog).toBe(`${Math.round(facts.chances.underdog)}%`);
    expect(v.scorelines[0].label).toBe("0 × 1");
    expect(v.scenarios[0].label).toBe(
      "Se Flamengo estiver vencendo por 1 × 0 aos 30'"
    );
    expect(v.signals).toEqual([
      {
        label: "Flamengo venceu 3 dos últimos 5 confrontos",
        origin: "dados",
        note: null,
      },
      {
        label: "Palmeiras pode poupar titulares, pelo JEV",
        origin: "modelo",
        note: "já está na chance acima",
      },
    ]);
    expect(containsValueLanguage(JSON.stringify(v))).toBe(false);
  });
});

describe("toUnderdogSlot", () => {
  it("sem texto guardado e porta aberta → teaser que cobra", () => {
    const slot = toUnderdogSlot(args());
    expect(slot).toEqual({
      teaser: {
        underdogName: "Flamengo",
        pct: `${Math.round(base.pick.chances.underdog)}%`,
      },
      view: null,
    });
  });

  it.each([
    ["flag desligada", { data: null }],
    ["fora do pré-jogo", { preMatch: false }],
    ["sem palpite", { heroPalpite: null }],
    ["run em andamento", { runInFlight: true }],
    [
      "sem azarão",
      { data: data({ current: null, baseStatus: "no_underdog" }) },
    ],
    [
      "base indisponível",
      { data: data({ current: null, baseStatus: "unavailable" }) },
    ],
    [
      "palpite dá a vitória ao azarão",
      { heroPalpite: { probableScore: { home: 0, away: 1 } } },
    ],
  ])("%s → nada", (_l, over) => {
    expect(toUnderdogSlot(args(over))).toBeNull();
  });

  it("texto guardado que vale → current, teaser com o % congelado", () => {
    const slot = toUnderdogSlot(args({ data: data({ stored }) }));
    expect(slot?.view?.freshness).toBe("current");
  });

  it("mudança material com a porta aberta → refresh, teaser com o % atual", () => {
    const slot = toUnderdogSlot(
      args({ data: data({ current: MOVED, stored }) })
    );
    expect(slot?.view?.freshness).toBe("refresh");
    expect(slot?.teaser.pct).toBe("30%");
  });

  it("base atual sem azarão claro → o texto pago fica, changed, sem botão", () => {
    const slot = toUnderdogSlot(
      args({
        data: data({ current: null, baseStatus: "no_underdog", stored }),
      })
    );
    expect(slot?.view?.freshness).toBe("changed");
    expect(slot?.teaser.underdogName).toBe("Flamengo");
  });

  it("mudança material e o palpite agora dá a vitória ao azarão → changed", () => {
    const slot = toUnderdogSlot(
      args({
        data: data({ current: MOVED, stored }),
        heroPalpite: { probableScore: { home: 0, away: 1 } },
      })
    );
    expect(slot?.view?.freshness).toBe("changed");
  });

  it.each([
    ["mais de 24h / refit atrasado", { heroPalpite: PALPITE }],
    ["indisponível e sem palpite", { heroPalpite: null }],
    ["indisponível com run em andamento", { runInFlight: true }],
  ])(
    "base indisponível (%s) → o texto fica sem aviso de mudança",
    (_l, over) => {
      const slot = toUnderdogSlot(
        args({
          data: data({ current: null, baseStatus: "unavailable", stored }),
          ...over,
        })
      );
      expect(slot?.view?.freshness).toBe("current");
      expect(slot?.teaser.pct).toBe(
        `${Math.round(stored.facts.chances.underdog)}%`
      );
    }
  );

  it.each([
    ["run em andamento", { runInFlight: true }],
    ["sem palpite na tela", { heroPalpite: null }],
  ])(
    "mudança material com o botão suspenso (%s) → recalculated, nunca changed",
    (_l, over) => {
      const slot = toUnderdogSlot(
        args({ data: data({ current: MOVED, stored }), ...over })
      );
      expect(slot?.view?.freshness).toBe("recalculated");
      expect(slot?.teaser.pct).toBe("30%");
    }
  );

  it("botão suspenso sem mudança material → current", () => {
    const slot = toUnderdogSlot(
      args({ data: data({ stored }), runInFlight: true, heroPalpite: null })
    );
    expect(slot?.view?.freshness).toBe("current");
  });

  it("depois do apito nem o texto guardado aparece", () => {
    expect(
      toUnderdogSlot(
        args({
          data: data({ current: null, baseStatus: "unavailable", stored }),
          preMatch: false,
        })
      )
    ).toBeNull();
  });
});
