import { describe, expect, it } from "vitest";

import type { NormalizedInjury } from "@/lib/providers/sports-data/types";

import { buildAbsences } from "@/lib/ai/markets/over_under/build-input";
import { renderContextSections } from "@/lib/ai/markets/over_under/user-message";
import type { OverUnderInput } from "@/lib/ai/markets/over_under/schemas";

type PlayerAbsence = OverUnderInput["home"]["absences"][number];

// Proveniência de desfalques (ADR 0026, #226): seam oficial-primeiro. Testes PUROS
// — sem API/DB/Anthropic. Cobrem o mapeamento (buildAbsences) e a renderização
// ("fonte:" no user-message, compartilhado v2+v3 via renderContextSections).

const inj = (over: Partial<NormalizedInjury> = {}): NormalizedInjury => ({
  player: { name: "Fulano" },
  type: "injury",
  status: "injured",
  ...over,
});

describe("buildAbsences — proveniência (source) + não-regressão", () => {
  it("propaga source quando presente", () => {
    const out = buildAbsences([inj({ source: "official" })]);
    expect(out[0]).toEqual({
      player: "Fulano",
      role: "MID",
      status: "injured",
      source: "official",
    });
  });

  it("OMITE a chave source quando ausente (spread condicional, sem source:undefined)", () => {
    const out = buildAbsences([inj()]);
    expect(out[0]).toEqual({ player: "Fulano", role: "MID", status: "injured" });
    expect("source" in out[0]).toBe(false);
  });

  it("mantém role:'MID' hardcoded e dropa reason (não regride o #226)", () => {
    const out = buildAbsences([
      inj({ reason: "Joelho", status: "suspended", type: "suspension", source: "official" }),
    ]);
    expect(out[0].role).toBe("MID");
    expect("reason" in out[0]).toBe(false);
    expect(out[0].status).toBe("suspended");
  });
});

describe("user-message — renderização de 'fonte:' (renderContextSections, compartilhado v2+v3)", () => {
  const team = (absences: PlayerAbsence[], available = true) => ({
    form: { matches: [] },
    standing: {
      position: 1,
      played: 10,
      points: 20,
      goals_for: 15,
      goals_against: 8,
    },
    absences_available: available,
    absences,
  });
  const ctx = (homeAbsences: PlayerAbsence[], homeAvailable = true) => ({
    match: {
      id: "m1",
      home_team: { id: "h", name: "Flamengo" },
      away_team: { id: "a", name: "Palmeiras" },
      league: "brasileirao_a",
      kickoff_at: "2026-05-15T12:00:00.000Z",
      venue: "Maracanã",
    },
    home: team(homeAbsences, homeAvailable),
    away: team([]),
    h2h: [],
  });
  const absence = (over: Partial<PlayerAbsence> = {}): PlayerAbsence => ({
    player: "Fulano",
    role: "MID",
    status: "injured",
    ...over,
  });

  it("renderiza 'fonte: official' quando o desfalque tem source", () => {
    const msg = renderContextSections(ctx([absence({ source: "official" })])).join("\n");
    expect(msg).toContain("- Fulano (MID, injured, fonte: official)");
  });

  it("NÃO renderiza 'fonte:' quando o desfalque não tem source", () => {
    const msg = renderContextSections(ctx([absence()])).join("\n");
    expect(msg).toContain("- Fulano (MID, injured)");
    expect(msg).not.toContain("fonte:");
  });

  it("preserva 'dados indisponíveis' quando absences_available=false (ADR 0006)", () => {
    const msg = renderContextSections(ctx([], false)).join("\n");
    expect(msg).toContain("dados indisponíveis nesta análise");
  });

  it("renderiza 'fonte:' no lado VISITANTE também (per-side, não só mandante)", () => {
    const input = {
      ...ctx([]),
      away: team([absence({ player: "Beltrano", source: "official" })]),
    };
    const msg = renderContextSections(input).join("\n");
    expect(msg).toContain("- Beltrano (MID, injured, fonte: official)");
  });
});
