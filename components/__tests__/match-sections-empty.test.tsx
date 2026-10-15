import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const provider = {
  getTeamForm: vi.fn(),
  getH2H: vi.fn(),
  getStandings: vi.fn(),
  getInjuriesByFixture: vi.fn(),
  getLineups: vi.fn(),
};
vi.mock("@/lib/providers/sports-data", () => ({ getSportsDataProvider: () => provider }));

import { MatchSections } from "@/components/match-sections";
import { MatchAuxiliarySections } from "@/components/match-sections-auxiliary";
import { SportsDataUnsupportedError, type FixtureRef } from "@/lib/providers/sports-data/types";

const REF: FixtureRef = {
  league: "brasileirao_a",
  kickoffAt: "2026-10-20T22:00:00.000Z",
  homeTeam: "Flamengo",
  awayTeam: "Palmeiras",
};

const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
// O MatchCollapsible é um Card com um botão de abrir/fechar.
const collapsibles = (h: string) => (h.match(/data-slot="card"/g) ?? []).length;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  provider.getTeamForm.mockResolvedValue([]);
  provider.getH2H.mockResolvedValue([]);
  provider.getStandings.mockResolvedValue(undefined);
  provider.getInjuriesByFixture.mockRejectedValue(new SportsDataUnsupportedError("sem lesões", "stub", "getInjuriesByFixture"));
  provider.getLineups.mockResolvedValue(undefined);
});

describe("aba Dados compacta (#576)", () => {
  it("sem dado: cada bloco vira uma linha com título e motivo, sem cartão", async () => {
    const h =
      renderToStaticMarkup(await MatchSections({ fixtureRef: REF, leagueKey: "bsa" })) +
      renderToStaticMarkup(await MatchAuxiliarySections({ fixtureRef: REF }));
    const t = text(h);
    expect(collapsibles(h)).toBe(0);
    for (const [title, reason] of [
      ["Partidas recentes", "sem jogos recentes"],
      ["Confrontos diretos (H2H)", "nenhum confronto recente"],
      ["Classificação · Brasileirão", "classificação indisponível"],
      ["Lesões e suspensões", "dados indisponíveis"],
      ["Escalações", "ainda não divulgadas"],
    ]) {
      expect(t).toContain(`${title} ${reason}`);
    }
  });

  it("desfalques disponíveis e zerados: 'nenhuma baixa reportada'", async () => {
    provider.getInjuriesByFixture.mockResolvedValue({ home: [], away: [] });
    const t = text(renderToStaticMarkup(await MatchAuxiliarySections({ fixtureRef: REF })));
    expect(t).toContain("Lesões e suspensões nenhuma baixa reportada");
  });

  it("com dado: o bloco fica no MatchCollapsible de sempre", async () => {
    provider.getInjuriesByFixture.mockResolvedValue({
      home: [{ player: { name: "Pedro" }, type: "injury", status: "injured" }],
      away: [],
    });
    provider.getLineups.mockResolvedValue({
      home: { team: "Flamengo", starters: [{ name: "Rossi" }] },
      away: { team: "Palmeiras", starters: [{ name: "Weverton" }] },
    });
    const h = renderToStaticMarkup(await MatchAuxiliarySections({ fixtureRef: REF }));
    expect(collapsibles(h)).toBe(2);
    expect(text(h)).toContain("1 baixas");
    expect(text(h)).toContain("divulgadas");
  });
});
