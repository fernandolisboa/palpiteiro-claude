import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Session } from "next-auth";

// parseBet ao vivo (#580, PLAN-580 §9.2): recusa ANTES do LLM o que o registro
// (registerBetSlip) recusaria. Nenhuma chamada real: o parse (LLM) é um mock.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/queries/matches", () => ({ getMatchById: vi.fn() }));
vi.mock("@/lib/db/queries/users", () => ({ getUserAccessState: vi.fn() }));
vi.mock("@/lib/db/queries/ai-config", () => ({ getEnableLiveMode: vi.fn() }));
vi.mock("@/lib/live/in-play-state", () => ({ getInPlayState: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkBetParseRateLimit: vi.fn() }));
vi.mock("@/lib/ai/bet-parse/parse", () => ({ parseBetText: vi.fn() }));

import { parseBet } from "@/app/actions/bets";
import { auth } from "@/auth";
import { parseBetText } from "@/lib/ai/bet-parse/parse";
import { getEnableLiveMode } from "@/lib/db/queries/ai-config";
import { getMatchById } from "@/lib/db/queries/matches";
import { getUserAccessState } from "@/lib/db/queries/users";
import { getInPlayState, type InPlayState } from "@/lib/live/in-play-state";
import { checkBetParseRateLimit } from "@/lib/rate-limit";

const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const mockParse = vi.mocked(parseBetText);
const mockInPlayState = vi.mocked(getInPlayState);

const MATCH_ID = "550e8400-e29b-41d4-a716-446655440000";

function match(status: string, kickoffAt: Date) {
  return {
    id: MATCH_ID,
    league: "brasileirao_a",
    status,
    homeTeam: "Flamengo",
    awayTeam: "Palmeiras",
    kickoffAt,
  } as unknown as Awaited<ReturnType<typeof getMatchById>>;
}

function liveState(over: Partial<InPlayState> = {}): InPlayState {
  return {
    matchId: MATCH_ID,
    statusShort: "2H",
    elapsed: 63,
    extra: null,
    fetchedAt: new Date(Date.now() - 30_000),
    minuteLabel: "63'",
    score: { home: 1, away: 0 },
    red: { home: 0, away: 0 },
    penalties: null,
    ageMs: 30_000,
    ...over,
  };
}

function form(gridLive?: "0" | "1"): FormData {
  const fd = new FormData();
  fd.append("matchId", MATCH_ID);
  fd.append("text", "Flamengo vence, odd 1,80");
  if (gridLive) fd.append("gridLive", gridLive);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({
    user: { id: "u2", email: "c@d.com", role: "user" },
    expires: "2099-01-01",
  } as unknown as Session);
  vi.mocked(getUserAccessState).mockResolvedValue({
    role: "user",
    allowed: true,
  } as Awaited<ReturnType<typeof getUserAccessState>>);
  vi.mocked(getMatchById).mockResolvedValue(
    match("live", new Date(Date.now() - 60 * 60_000))
  );
  vi.mocked(getEnableLiveMode).mockResolvedValue(true);
  mockInPlayState.mockResolvedValue(liveState());
  vi.mocked(checkBetParseRateLimit).mockResolvedValue({
    ok: true,
    limit: 20,
    remaining: 19,
    reset: 0,
  } as Awaited<ReturnType<typeof checkBetParseRateLimit>>);
  mockParse.mockResolvedValue({
    ok: true,
    legs: [
      {
        kind: "match_result",
        params: { selection: "home" },
        userOdd: 1.8,
      },
    ] as never,
    warnings: [],
    aiCallId: null,
  });
});

describe("parseBet — ao vivo, recusa antes do LLM", () => {
  it("tabela ao vivo e placar do servidor: chama o parse", async () => {
    const res = await parseBet(null, form("1"));
    expect(res.ok).toBe(true);
    expect(mockParse).toHaveBeenCalledTimes(1);
  });

  it("estado sem placar: 'Placar ao vivo indisponível', sem LLM", async () => {
    mockInPlayState.mockResolvedValue(liveState({ score: null }));
    const res = await parseBet(null, form("1"));
    expect(res).toEqual({
      ok: false,
      error: "Placar ao vivo indisponível agora. Tente em um minuto.",
      kind: "nao-analisavel",
    });
    expect(mockParse).not.toHaveBeenCalled();
    expect(checkBetParseRateLimit).not.toHaveBeenCalled();
  });

  it("página aberta antes do apito (tabela de pré-jogo): pede pra atualizar, sem LLM", async () => {
    for (const fd of [form("0"), form()]) {
      mockParse.mockClear();
      const res = await parseBet(null, fd);
      expect(res).toEqual({
        ok: false,
        error: "O jogo começou. Atualize a página para registrar ao vivo.",
        kind: "nao-analisavel",
      });
      expect(mockParse).not.toHaveBeenCalled();
    }
  });

  it("pré-jogo: o caminho de sempre, com ou sem gridLive", async () => {
    vi.mocked(getMatchById).mockResolvedValue(
      match("scheduled", new Date(Date.now() + 60 * 60_000))
    );
    for (const fd of [form("0"), form("1"), form()]) {
      mockParse.mockClear();
      expect((await parseBet(null, fd)).ok).toBe(true);
      expect(mockParse).toHaveBeenCalledTimes(1);
    }
    expect(mockInPlayState).not.toHaveBeenCalled();
  });
});
