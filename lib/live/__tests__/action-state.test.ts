import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/queries/ai-config", () => ({ getEnableLiveMode: vi.fn() }));
vi.mock("@/lib/live/in-play-state", () => ({ getInPlayState: vi.fn() }));

import { getEnableLiveMode } from "@/lib/db/queries/ai-config";
import { loadActionLiveContext } from "@/lib/live/action-state";
import { getInPlayState, type InPlayMatch } from "@/lib/live/in-play-state";

const mockLiveMode = vi.mocked(getEnableLiveMode);
const mockState = vi.mocked(getInPlayState);

const NOW = new Date("2026-10-15T20:00:00.000Z");

function match(over: Partial<InPlayMatch> = {}): InPlayMatch {
  return {
    id: "m1",
    league: "brasileirao_a",
    kickoffAt: new Date(NOW.getTime() - 60 * 60_000),
    homeTeam: "Flamengo",
    awayTeam: "Palmeiras",
    status: "live",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLiveMode.mockResolvedValue(true);
  mockState.mockResolvedValue(null);
});

describe("loadActionLiveContext (#580)", () => {
  it("pré-jogo: não lê a flag nem o estado", async () => {
    const ctx = await loadActionLiveContext(
      match({ status: "scheduled", kickoffAt: new Date(NOW.getTime() + 60_000) }),
      NOW
    );
    expect(ctx).toEqual({ now: NOW, liveMode: false, state: null });
    expect(mockLiveMode).not.toHaveBeenCalled();
    expect(mockState).not.toHaveBeenCalled();
  });

  it("encerrado/adiado/cancelado no banco: o motivo de hoje, sem ler", async () => {
    for (const status of ["finished", "postponed", "cancelled"] as const) {
      const ctx = await loadActionLiveContext(match({ status }), NOW);
      expect(ctx.state).toBeNull();
    }
    expect(mockLiveMode).not.toHaveBeenCalled();
    expect(mockState).not.toHaveBeenCalled();
  });

  it("flag desligada: sem estado", async () => {
    mockLiveMode.mockResolvedValue(false);
    const ctx = await loadActionLiveContext(match(), NOW);
    expect(ctx).toEqual({ now: NOW, liveMode: false, state: null });
    expect(mockState).not.toHaveBeenCalled();
  });

  it("ao vivo: relê com a idade máxima de registro (2 min), `scheduled` stale incluso", async () => {
    await loadActionLiveContext(match(), NOW);
    await loadActionLiveContext(match({ status: "scheduled" }), NOW);
    expect(mockState).toHaveBeenCalledTimes(2);
    expect(mockState).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }), {
      now: NOW,
      maxAgeMs: 120_000,
    });
  });
});
