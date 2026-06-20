// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PalpiteSetWithLines, DbPalpiteSet } from "@/lib/db/queries/palpites";
import type { DbMatch } from "@/lib/db/queries/predictions";
import type { PalpiteHeadline } from "@/db/schema";

// Mock da query de DB — o loader é unit-testado contra a query stubada (sem DB real).
// vi.hoisted: a fn precisa existir ANTES do vi.mock hoisted (senão TDZ no factory).
const { getSharedPalpiteSet } = vi.hoisted(() => ({
  getSharedPalpiteSet: vi.fn(),
}));
vi.mock("@/lib/db/queries/palpites", async (orig) => {
  const actual = await orig<typeof import("@/lib/db/queries/palpites")>();
  return { ...actual, getSharedPalpiteSet };
});

import {
  loadSharedPalpite,
  NEUTRAL_DESCRIPTION,
} from "@/app/p/[id]/load-shared-palpite";

// loadSharedPalpite é embrulhado em React cache() → MEMOIZA por argumento no processo de
// teste. Cada `it` usa um UUID FRESCO pra não colidir com a entrada cacheada de outro teste.
let _seq = 0;
function freshUuid(): string {
  _seq += 1;
  const hex = _seq.toString(16).padStart(12, "0");
  // Formato UUID v4 válido (nibble de versão "4", de variante "8") — z.string().uuid() exige.
  return `22222222-2222-4222-8222-${hex}`;
}

const HEADLINE: PalpiteHeadline = {
  verdict: "Vai dar Palmeiras",
  confidence: "media",
  narrative: "Verdão melhor em casa.",
  citedMarkets: ["Resultado (1X2)"],
  sourcePredictionIds: ["leak-pred-1"],
};

function makeSet(over: Partial<DbPalpiteSet> = {}): PalpiteSetWithLines {
  return {
    palpiteSet: {
      id: "11111111-1111-1111-1111-111111111111",
      matchId: "match-1",
      userId: "leak-user",
      aiCallId: "leak-call",
      modelVersion: "leak-model",
      promptVersion: "leak-prompt",
      headline: HEADLINE,
      sharedAt: new Date(),
      createdAt: new Date(),
      ...over,
    },
    aiCall: null,
    palpites: [
      {
        id: "line-1",
        palpiteSetId: "11111111-1111-1111-1111-111111111111",
        type: "exact_score",
        text: "Palmeiras 2 x 1",
        params: { home: 2, away: 1 },
        settleable: true,
        createdAt: new Date(),
        outcome: null,
      },
    ],
  };
}

function makeMatch(over: Partial<DbMatch> = {}): DbMatch {
  return {
    id: "match-1",
    externalId: "ext-1",
    league: "brasileirao_a",
    homeTeam: "SE Palmeiras",
    awayTeam: "SC Corinthians Paulista",
    kickoffAt: new Date("2026-05-15T19:00:00Z"),
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    ...over,
  } as DbMatch;
}

beforeEach(() => {
  getSharedPalpiteSet.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadSharedPalpite — 3 triggers de 404 (ADR §6)", () => {
  it("(i) id não-UUID → null SEM tocar a query (uuid antes da query, evita 22P02)", async () => {
    const out = await loadSharedPalpite("not-a-uuid");
    expect(out).toBeNull();
    expect(getSharedPalpiteSet).not.toHaveBeenCalled();
  });

  it("(ii) UUID válido, query retorna null (sem row / shared_at NULL) → null", async () => {
    getSharedPalpiteSet.mockResolvedValue(null);
    const id = freshUuid();
    const out = await loadSharedPalpite(id);
    expect(out).toBeNull();
    expect(getSharedPalpiteSet).toHaveBeenCalledWith(id);
  });

  it("(iii) row presente mas mapper retorna null (sem headline) → null", async () => {
    getSharedPalpiteSet.mockResolvedValue({
      palpiteSetWithLines: makeSet({ headline: null }),
      match: makeMatch(),
    });
    const out = await loadSharedPalpite(freshUuid());
    expect(out).toBeNull();
  });

  it("happy path → view + match projetado", async () => {
    getSharedPalpiteSet.mockResolvedValue({
      palpiteSetWithLines: makeSet(),
      match: makeMatch(),
    });
    const out = await loadSharedPalpite(freshUuid());
    expect(out).not.toBeNull();
    expect(out!.view.verdict).toBe("Vai dar Palmeiras");
    expect(out!.match.homeTeam).toBe("SE Palmeiras");
  });
});

describe("loadSharedPalpite — gate de placar por status (BLOCKER final-score)", () => {
  it("status='live' com placar populado → finalScore null (não mostra placar ao vivo)", async () => {
    getSharedPalpiteSet.mockResolvedValue({
      palpiteSetWithLines: makeSet(),
      match: makeMatch({ status: "live", homeScore: 1, awayScore: 0 }),
    });
    const out = await loadSharedPalpite(freshUuid());
    expect(out!.match.finalScore).toBeNull();
  });

  it("status='finished' → finalScore {home,away}", async () => {
    getSharedPalpiteSet.mockResolvedValue({
      palpiteSetWithLines: makeSet(),
      match: makeMatch({ status: "finished", homeScore: 2, awayScore: 1 }),
    });
    const out = await loadSharedPalpite(freshUuid());
    expect(out!.match.finalScore).toEqual({ home: 2, away: 1 });
  });

  it("status='postponed' com placar stale → finalScore null", async () => {
    getSharedPalpiteSet.mockResolvedValue({
      palpiteSetWithLines: makeSet(),
      match: makeMatch({ status: "postponed", homeScore: 3, awayScore: 3 }),
    });
    const out = await loadSharedPalpite(freshUuid());
    expect(out!.match.finalScore).toBeNull();
  });
});

describe("loadSharedPalpite — projeção pública não vaza o raw match", () => {
  it("o match projetado só tem homeTeam/awayTeam/league/finalScore", async () => {
    getSharedPalpiteSet.mockResolvedValue({
      palpiteSetWithLines: makeSet(),
      match: makeMatch({ status: "finished", homeScore: 2, awayScore: 1 }),
    });
    const out = await loadSharedPalpite(freshUuid());
    expect(Object.keys(out!.match).sort()).toEqual(
      ["awayTeam", "finalScore", "homeTeam", "league"].sort(),
    );
  });
});

describe("NEUTRAL_DESCRIPTION — firewall-safe", () => {
  it("não carrega 'Recomendações de aposta' nem linguagem de valor", () => {
    expect(NEUTRAL_DESCRIPTION).not.toContain("Recomendações de aposta");
    expect(NEUTRAL_DESCRIPTION).not.toMatch(/%/);
  });
});
