import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Session } from "next-auth";

// "Analisar meu palpite" ao vivo (#594, PLAN-580 §9.1). Fronteiras mockadas (sem LLM,
// banco nem provider reais); o gate, a fase e a leitura em jogo rodam de verdade.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/queries/matches", () => ({ getMatchById: vi.fn() }));
vi.mock("@/lib/db/queries/users", () => ({ getUserAccessState: vi.fn() }));
vi.mock("@/lib/db/queries/ai-config", () => ({
  getEnableUserContext: vi.fn(),
  getEnableLiveMode: vi.fn(),
}));
vi.mock("@/lib/live/in-play-state", () => ({ getInPlayState: vi.fn() }));
vi.mock("@/lib/db/queries/user-palpite-analyses", () => ({
  insertUserPalpiteAnalysis: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ checkPalpitesRateLimit: vi.fn() }));
vi.mock("@/lib/server/request-timezone", () => ({
  getRequestTimeZone: vi.fn(async () => "America/Sao_Paulo"),
}));
vi.mock("@/lib/user-palpite/model-base", () => ({ resolvePalpiteModelBase: vi.fn() }));
vi.mock("@/lib/user-palpite/facts", () => ({ fetchPalpiteFacts: vi.fn() }));
vi.mock("@/lib/ai/user-palpite/extract", () => ({ extractPalpiteClaims: vi.fn() }));
vi.mock("@/lib/ai/user-palpite/narrate", () => ({ narratePalpite: vi.fn() }));
vi.mock("@/lib/auth/whitelist", () => ({ isEmailAllowed: vi.fn(() => false) }));

import { analyzeUserPalpite } from "@/app/actions/user-palpite";
import { auth } from "@/auth";
import { extractPalpiteClaims } from "@/lib/ai/user-palpite/extract";
import { narratePalpite } from "@/lib/ai/user-palpite/narrate";
import { USER_PALPITE_NARRATE_LIVE_VERSION } from "@/lib/ai/user-palpite/narrate-cartridge";
import { getEnableLiveMode, getEnableUserContext } from "@/lib/db/queries/ai-config";
import { getMatchById } from "@/lib/db/queries/matches";
import { insertUserPalpiteAnalysis } from "@/lib/db/queries/user-palpite-analyses";
import { getUserAccessState } from "@/lib/db/queries/users";
import { getInPlayState } from "@/lib/live/in-play-state";
import { readLiveStamp } from "@/lib/live/stamp";
import { checkPalpitesRateLimit } from "@/lib/rate-limit";
import {
  resolvePalpiteModelBase,
  type PalpiteModelBase,
} from "@/lib/user-palpite/model-base";

const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const MATCH_ID = "550e8400-e29b-41d4-a716-446655440000";
const NOW = Date.now();
const KICKOFF = new Date(NOW - 63 * 60_000);

const BASE: PalpiteModelBase = {
  origin: "live",
  snapshotId: null,
  modelVersion: null,
  snapshotWeightsVersion: null,
  source: "dixon_coles",
  degraded: false,
  fallbackReason: null,
  staleBase: false,
  lambdaHomeBase: 1.6,
  lambdaAwayBase: 1.0,
  rho: null,
  jevAnswers: null,
};

function state(over: Record<string, unknown> = {}) {
  return {
    matchId: MATCH_ID,
    statusShort: "2H",
    elapsed: 63,
    extra: null,
    minuteLabel: "63'",
    score: { home: 1, away: 0 },
    red: { home: 0, away: 0 },
    fetchedAt: new Date(NOW - 10_000),
    ageMs: 10_000,
    ...over,
  };
}

function form(over: Record<string, string | undefined> = {}): FormData {
  const fields: Record<string, string | undefined> = {
    matchId: MATCH_ID,
    palpite: JSON.stringify({ kind: "score", home: 2, away: 0 }),
    reason: "o Palmeiras está sem o centroavante",
    pageLive: "1",
    ...over,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({
    user: { id: "u1", email: "a@b.com", role: "user" },
    expires: "2099-01-01",
  } as unknown as Session);
  vi.mocked(getUserAccessState).mockResolvedValue({ role: "user", allowed: true } as never);
  vi.mocked(getEnableUserContext).mockResolvedValue(true);
  vi.mocked(getEnableLiveMode).mockResolvedValue(true);
  vi.mocked(getMatchById).mockResolvedValue({
    id: MATCH_ID,
    league: "brasileirao_a",
    status: "live",
    homeTeam: "Flamengo",
    awayTeam: "Palmeiras",
    kickoffAt: KICKOFF,
    neutralVenue: false,
  } as never);
  vi.mocked(getInPlayState).mockResolvedValue(state() as never);
  vi.mocked(resolvePalpiteModelBase).mockResolvedValue(BASE);
  vi.mocked(checkPalpitesRateLimit).mockResolvedValue({
    ok: true,
    limit: 50,
    remaining: 49,
    reset: 0,
  } as never);
  vi.mocked(extractPalpiteClaims).mockResolvedValue({
    ok: true,
    claims: [],
    warnings: [],
    aiCallId: null,
  } as never);
  vi.mocked(narratePalpite).mockImplementation(async ({ input }) => ({
    narration: {
      veredito: input.codeVerdict,
      resumo: "Resumo.",
      pontos: [],
      discordancias: [],
    },
    source: "llm",
    aiCallId: null,
  }));
  vi.mocked(insertUserPalpiteAnalysis).mockResolvedValue("a1");
});

describe("analyzeUserPalpite ao vivo", () => {
  it("lê a partir do placar atual sobre a base do apito, narra ao vivo e grava o carimbo", async () => {
    const res = await analyzeUserPalpite(null, form());
    expect(res.ok).toBe(true);
    // Base do APITO, estado relido no servidor (até 2 min), mesma cota de palpites.
    expect(vi.mocked(resolvePalpiteModelBase).mock.calls[0][1]).toEqual({
      asOf: KICKOFF,
    });
    expect(vi.mocked(getInPlayState).mock.calls[0][1]).toMatchObject({ maxAgeMs: 120_000 });
    expect(checkPalpitesRateLimit).toHaveBeenCalledTimes(1);

    const input = vi.mocked(narratePalpite).mock.calls[0][0].input;
    expect(input.live).toEqual({
      moment: "aos 63'",
      score: { home: 1, away: 0 },
      red: { home: 0, away: 0 },
    });
    // 2–0 a partir de 1–0: chance real, e 1–0 (o placar atual) entre os prováveis.
    expect(input.without.palpitePct).toBeGreaterThan(0);
    expect(input.without.topScorelines.every((c) => c.home >= 1)).toBe(true);

    const row = vi.mocked(insertUserPalpiteAnalysis).mock.calls[0][0];
    expect(row.isLive).toBe(true);
    const stamp = readLiveStamp(row.liveState);
    expect(stamp?.score).toEqual({ home: 1, away: 0 });
    expect(stamp?.inPlay?.liveModelVersion).toBe("live_model_v1");
    expect(row.model.versions.narrate).toBe(USER_PALPITE_NARRATE_LIVE_VERSION);
    if (res.ok) expect(res.analysis.liveLabel).toBe("ao vivo · 63' · 1–0");
  });

  it("placar que já passou: recusa antes de cobrar", async () => {
    const res = await analyzeUserPalpite(
      null,
      form({ palpite: JSON.stringify({ kind: "score", home: 0, away: 0 }) }),
    );
    expect(res).toMatchObject({ ok: false, kind: "invalido" });
    expect(checkPalpitesRateLimit).not.toHaveBeenCalled();
  });

  it("página de pré-jogo: pede para atualizar, sem cobrar", async () => {
    const res = await analyzeUserPalpite(null, form({ pageLive: "0" }));
    expect(res).toEqual({
      ok: false,
      error: "O jogo começou. Atualize a página para a leitura ao vivo.",
      kind: "nao-analisavel",
    });
    expect(checkPalpitesRateLimit).not.toHaveBeenCalled();
  });

  it("sem estado utilizável: copy do placar indisponível, sem cobrar nem ler a base", async () => {
    vi.mocked(getInPlayState).mockResolvedValue(null);
    const res = await analyzeUserPalpite(null, form());
    expect(res).toEqual({
      ok: false,
      error: "Placar ao vivo indisponível agora. Tente em um minuto.",
      kind: "nao-analisavel",
    });
    expect(resolvePalpiteModelBase).not.toHaveBeenCalled();
    expect(checkPalpitesRateLimit).not.toHaveBeenCalled();
  });

  it("sem modelo: 'Sem modelo para a leitura ao vivo', sem cobrar", async () => {
    vi.mocked(resolvePalpiteModelBase).mockResolvedValue(null);
    const res = await analyzeUserPalpite(null, form());
    expect(res).toEqual({
      ok: false,
      error: "Sem modelo para a leitura ao vivo deste jogo.",
      kind: "nao-analisavel",
    });
    expect(checkPalpitesRateLimit).not.toHaveBeenCalled();
  });

  it("flag desligada: a copy de antes, sem ler o estado", async () => {
    vi.mocked(getEnableLiveMode).mockResolvedValue(false);
    const res = await analyzeUserPalpite(null, form());
    expect(res).toEqual({
      ok: false,
      error: "Jogo em andamento — a análise fica disponível só antes do apito inicial.",
      kind: "nao-analisavel",
    });
    expect(getInPlayState).not.toHaveBeenCalled();
    expect(checkPalpitesRateLimit).not.toHaveBeenCalled();
  });
});
