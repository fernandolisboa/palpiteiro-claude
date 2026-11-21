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
import { toUnderdogPanelView, toUnderdogSlot } from "@/lib/view/underdog";

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
const args = (over: Partial<Parameters<typeof toUnderdogSlot>[0]> = {}) => ({
  data: { current: base.pick, stored: null },
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
    ["sem azarão", { data: { current: null, stored: null } }],
  ])("%s → nada", (_l, over) => {
    expect(toUnderdogSlot(args(over))).toBeNull();
  });

  it("texto guardado que vale → current, teaser com o % congelado", () => {
    const slot = toUnderdogSlot(args({ data: { current: base.pick, stored } }));
    expect(slot?.view?.freshness).toBe("current");
  });

  it("mudança material com a porta aberta → refresh, teaser com o % atual", () => {
    const moved: UnderdogPick = {
      side: "away",
      chances: { underdog: 30, draw: 28, favorite: 42 },
    };
    const slot = toUnderdogSlot(args({ data: { current: moved, stored } }));
    expect(slot?.view?.freshness).toBe("refresh");
    expect(slot?.teaser.pct).toBe("30%");
  });

  it("base atual sem azarão → o texto pago fica, changed, sem botão", () => {
    const slot = toUnderdogSlot(
      args({ data: { current: null, stored }, heroPalpite: null })
    );
    expect(slot?.view?.freshness).toBe("changed");
    expect(slot?.teaser.underdogName).toBe("Flamengo");
  });

  it("depois do apito nem o texto guardado aparece", () => {
    expect(
      toUnderdogSlot(args({ data: { current: null, stored }, preMatch: false }))
    ).toBeNull();
  });
});
