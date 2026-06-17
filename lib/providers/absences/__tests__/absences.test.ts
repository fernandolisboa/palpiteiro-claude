import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AbsencesFallbackProvider } from "@/lib/providers/absences/fallback-provider";
import { SportsDataAbsencesAdapter } from "@/lib/providers/absences/sports-data-absences-adapter";
import {
  normalizeSidelined,
  SportMonksAbsencesAdapter,
} from "@/lib/providers/absences/sportmonks/adapter";
import type { AbsencesProvider } from "@/lib/providers/absences/types";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import {
  SportsDataNotFoundError,
  SportsDataTransientError,
  SportsDataUnsupportedError,
  type FixtureRef,
  type NormalizedInjury,
  type ProviderCapabilities,
  type SportsDataProvider,
} from "@/lib/providers/sports-data/types";

const REF: FixtureRef = {
  league: "brasileirao_a",
  kickoffAt: "2026-05-15T19:00:00.000Z",
  homeTeam: "Flamengo",
  awayTeam: "Palmeiras",
};
const INJ = (name: string): NormalizedInjury => ({
  player: { name },
  type: "injury",
  status: "injured",
  source: "official",
});

function fakeAbsences(opts: {
  name: string;
  supports: boolean;
  leagues?: SupportedLeague[];
  fixture?: () => Promise<{ home: NormalizedInjury[]; away: NormalizedInjury[] }>;
}): AbsencesProvider & { spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(
    opts.fixture ?? (async () => ({ home: [], away: [] })),
  );
  const capabilities: ProviderCapabilities = {
    name: opts.name,
    supportsInjuries: opts.supports,
    supportsLineups: false,
    supportsAbsences: opts.supports,
    supportedLeagues: new Set<SupportedLeague>(opts.leagues ?? ["brasileirao_a"]),
  };
  return {
    spy,
    capabilities,
    getAbsencesByFixture: spy as never,
    getAbsencesByTeam: async () => [],
  };
}

describe("AbsencesFallbackProvider — contrato de cascata (ADR 0026 D4, #227)", () => {
  it("primário Transient → cai no fallback", async () => {
    const primary = fakeAbsences({
      name: "p",
      supports: true,
      fixture: async () => {
        throw new SportsDataTransientError("outage", "p", "getAbsencesByFixture", null);
      },
    });
    const fallback = fakeAbsences({
      name: "f",
      supports: true,
      fixture: async () => ({ home: [INJ("Beltrano")], away: [] }),
    });
    const cascade = new AbsencesFallbackProvider(primary, fallback);
    const out = await cascade.getAbsencesByFixture(REF);
    expect(out.home[0]?.player.name).toBe("Beltrano");
    expect(fallback.spy).toHaveBeenCalledTimes(1);
  });

  it("primário NotFound → BUBBLE (não cascateia)", async () => {
    const primary = fakeAbsences({
      name: "p",
      supports: true,
      fixture: async () => {
        throw new SportsDataNotFoundError("input err", "p", "getAbsencesByFixture");
      },
    });
    const fallback = fakeAbsences({ name: "f", supports: true });
    const cascade = new AbsencesFallbackProvider(primary, fallback);
    await expect(cascade.getAbsencesByFixture(REF)).rejects.toThrow(
      SportsDataNotFoundError,
    );
    expect(fallback.spy).not.toHaveBeenCalled();
  });

  it("gate ANTES de invocar: provider sem supportsAbsences NUNCA é chamado", async () => {
    const primary = fakeAbsences({ name: "p", supports: false }); // gated out
    const fallback = fakeAbsences({
      name: "f",
      supports: true,
      fixture: async () => ({ home: [INJ("X")], away: [] }),
    });
    const cascade = new AbsencesFallbackProvider(primary, fallback);
    await cascade.getAbsencesByFixture(REF);
    expect(primary.spy).not.toHaveBeenCalled(); // filtrado fora, não tentado
    expect(fallback.spy).toHaveBeenCalledTimes(1);
  });

  it("nenhum suporta a liga → lança Unsupported (predict degrada pra unavailable)", async () => {
    const primary = fakeAbsences({ name: "p", supports: true, leagues: ["champions_league"] });
    const fallback = fakeAbsences({ name: "f", supports: false });
    const cascade = new AbsencesFallbackProvider(primary, fallback);
    await expect(cascade.getAbsencesByFixture(REF)).rejects.toThrow(
      SportsDataUnsupportedError,
    );
    expect(primary.spy).not.toHaveBeenCalled();
  });
});

describe("SportMonks adapter — normalização + key-gating (#227)", () => {
  const ORIGINAL = process.env.SPORTMONKS_API_TOKEN;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.SPORTMONKS_API_TOKEN;
    else process.env.SPORTMONKS_API_TOKEN = ORIGINAL;
  });

  it("sem SPORTMONKS_API_TOKEN → supportsAbsences=false (cascade filtra)", () => {
    delete process.env.SPORTMONKS_API_TOKEN;
    expect(new SportMonksAbsencesAdapter().capabilities.supportsAbsences).toBe(false);
  });

  it("com token → supportsAbsences=true (BR/CL)", () => {
    process.env.SPORTMONKS_API_TOKEN = "tok-test";
    const caps = new SportMonksAbsencesAdapter().capabilities;
    expect(caps.supportsAbsences).toBe(true);
    expect(caps.supportedLeagues.has("brasileirao_a")).toBe(true);
  });

  it("normalizeSidelined: lesão → injury com source:official", () => {
    const n = normalizeSidelined({
      player: { name: "Gabigol" },
      type: { name: "Knee Injury", model_type: "injury" },
      category: "injured",
    });
    expect(n).toEqual({
      player: { name: "Gabigol" },
      type: "injury",
      reason: "Knee Injury",
      status: "injured",
      source: "official",
    });
  });

  it("normalizeSidelined: suspensão → suspension/suspended", () => {
    const n = normalizeSidelined({
      player: { name: "Arrascaeta" },
      type: { model_type: "suspension" },
      category: "suspended",
    });
    expect(n?.type).toBe("suspension");
    expect(n?.status).toBe("suspended");
    expect(n?.source).toBe("official");
  });

  it("normalizeSidelined: entrada sem player → null (descartada)", () => {
    expect(normalizeSidelined({ type: { model_type: "injury" } })).toBeNull();
    expect(normalizeSidelined("lixo")).toBeNull();
  });
});

describe("SportsDataAbsencesAdapter — delega ao SportsDataProvider injetado (#227)", () => {
  it("getAbsencesByFixture → getInjuriesByFixture; capabilities passthrough", async () => {
    const getInjuriesByFixture = vi.fn(async () => ({
      home: [INJ("X")],
      away: [INJ("Y")],
    }));
    const caps: ProviderCapabilities = {
      name: "sd",
      supportsInjuries: true,
      supportsLineups: true,
      supportsAbsences: true,
      supportedLeagues: new Set<SupportedLeague>(["brasileirao_a"]),
    };
    const fakeSD = { capabilities: caps, getInjuriesByFixture } as unknown as SportsDataProvider;
    const adapter = new SportsDataAbsencesAdapter(() => fakeSD);
    expect(adapter.capabilities.supportsAbsences).toBe(true);
    const out = await adapter.getAbsencesByFixture(REF);
    expect(out.home[0]?.player.name).toBe("X");
    expect(getInjuriesByFixture).toHaveBeenCalledWith(REF);
  });

  it("resolve LAZY (por chamada) — respeita troca do provider", async () => {
    let current = { home: [INJ("first")], away: [] };
    const fakeSD = {
      capabilities: { name: "sd", supportsInjuries: true, supportsLineups: false, supportsAbsences: true, supportedLeagues: new Set<SupportedLeague>(["brasileirao_a"]) },
      getInjuriesByFixture: async () => current,
    } as unknown as SportsDataProvider;
    const adapter = new SportsDataAbsencesAdapter(() => fakeSD);
    current = { home: [INJ("second")], away: [] };
    const out = await adapter.getAbsencesByFixture(REF);
    expect(out.home[0]?.player.name).toBe("second");
  });
});

describe("getAbsencesProvider — factory + test seam (#227)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("default compõe sports-data (primary) + sportmonks (fallback)", async () => {
    const mod = await import("@/lib/providers/absences");
    const p = mod.getAbsencesProvider();
    expect(p.capabilities.name).toContain("absences-fallback");
    expect(p.capabilities.name).toContain("sportmonks");
  });

  it("__setAbsencesProviderForTesting sobrescreve; undefined limpa", async () => {
    const mod = await import("@/lib/providers/absences");
    const fake = fakeAbsences({ name: "fake", supports: true });
    mod.__setAbsencesProviderForTesting(fake);
    expect(mod.getAbsencesProvider()).toBe(fake);
    mod.__setAbsencesProviderForTesting(undefined);
    expect(mod.getAbsencesProvider()).not.toBe(fake);
  });
});
