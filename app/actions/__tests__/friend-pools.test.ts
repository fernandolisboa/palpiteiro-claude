// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Actions do bolão ao vivo (#580, PLAN-580 §10/§14): o carimbo sai do estado lido no
// servidor, tirar aposta depois do apito é recusado, criar respeita a janela.

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  getUserAccessState: vi.fn(),
  getEnableLiveMode: vi.fn(),
  getInPlayState: vi.fn(),
  getMatchById: vi.fn(),
  getFriendPool: vi.fn(),
  insertFriendPool: vi.fn(),
  insertFriendPoolEntry: vi.fn(),
  deleteFriendPoolEntry: vi.fn(),
  deleteFriendPool: vi.fn(),
  setFriendPoolManualScore: vi.fn(),
  setFriendPoolBetsClosed: vi.fn(),
  setFriendPoolBetsExtended: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/lib/auth/whitelist", () => ({ isEmailAllowed: () => false }));
vi.mock("@/lib/db/queries/users", () => ({ getUserAccessState: m.getUserAccessState }));
vi.mock("@/lib/db/queries/ai-config", () => ({ getEnableLiveMode: m.getEnableLiveMode }));
vi.mock("@/lib/live/in-play-state", () => ({ getInPlayState: m.getInPlayState }));
vi.mock("@/lib/db/queries/matches", () => ({ getMatchById: m.getMatchById }));
vi.mock("@/lib/db/queries/friend-pools", () => ({
  getFriendPool: m.getFriendPool,
  insertFriendPool: m.insertFriendPool,
  insertFriendPoolEntry: m.insertFriendPoolEntry,
  deleteFriendPoolEntry: m.deleteFriendPoolEntry,
  deleteFriendPool: m.deleteFriendPool,
  setFriendPoolManualScore: m.setFriendPoolManualScore,
  setFriendPoolBetsClosed: m.setFriendPoolBetsClosed,
  setFriendPoolBetsExtended: m.setFriendPoolBetsExtended,
}));

import {
  addFriendPoolEntry,
  closeFriendPoolBets,
  createFriendPool,
  extendFriendPoolBets,
  removeFriendPoolEntry,
  reopenFriendPoolBets,
  setFriendPoolScore,
} from "@/app/actions/friend-pools";
import { LiveStampSchema } from "@/lib/live/stamp";

const POOL_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "22222222-2222-4222-8222-222222222222";
const MATCH_ID = "33333333-3333-4333-8333-333333333333";
const OWNER = "owner-id";
const KICKOFF = new Date("2026-10-18T19:00:00Z");
const MIN = 60_000;
const at = (min: number) => new Date(KICKOFF.getTime() + min * MIN);

const match = {
  id: MATCH_ID,
  league: "brasileirao_a",
  homeTeam: "Flamengo",
  awayTeam: "Palmeiras",
  kickoffAt: KICKOFF,
  status: "scheduled",
  homeScore: null,
  awayScore: null,
};

function pool(over: Record<string, unknown> = {}) {
  return {
    pool: {
      id: POOL_ID,
      userId: OWNER,
      matchId: MATCH_ID,
      betsClosedAt: null,
      betsExtendedUntil: null,
      betsExtendedByUserId: null,
      manualHomeScore: null,
      manualAwayScore: null,
      entryAmountCents: null,
      ...over,
    },
    match,
    entries: [],
  };
}

function inPlay(over: Record<string, unknown> = {}) {
  const fetchedAt = new Date(Date.now() - 20_000);
  return {
    matchId: MATCH_ID,
    statusShort: "1H",
    elapsed: 12,
    extra: null,
    fetchedAt,
    minuteLabel: "12'",
    score: { home: 1, away: 0 },
    red: { home: 0, away: 0 },
    ageMs: 20_000,
    ...over,
  };
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const entryForm = () =>
  form({ poolId: POOL_ID, bettorName: "Ana", kind: "exact_score", home: "2", away: "1" });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.auth.mockResolvedValue({ user: { id: OWNER, email: "dono@example.com", role: "user" } });
  m.getUserAccessState.mockResolvedValue({ allowed: true });
  m.getEnableLiveMode.mockResolvedValue(true);
  m.getInPlayState.mockResolvedValue(null);
  m.getFriendPool.mockResolvedValue(pool());
  m.getMatchById.mockResolvedValue(match);
  m.insertFriendPool.mockResolvedValue(POOL_ID);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("addFriendPoolEntry", () => {
  it("antes do apito: anota sem carimbo e sem ler estado", async () => {
    vi.setSystemTime(at(-30));
    expect(await addFriendPoolEntry(null, entryForm())).toEqual({ ok: true });
    expect(m.getInPlayState).not.toHaveBeenCalled();
    expect(m.insertFriendPoolEntry).toHaveBeenCalledWith(
      expect.objectContaining({ isLive: false, liveState: null, bettorName: "Ana" }),
    );
  });

  it("ao vivo: carimbo com minuto e placar lidos no servidor (até 2 min)", async () => {
    vi.setSystemTime(at(12));
    m.getInPlayState.mockResolvedValue(inPlay());
    // Campos de minuto/placar no form são ignorados: só o servidor carimba.
    const fd = entryForm();
    fd.set("minute", "1");
    fd.set("score", "0-0");
    expect(await addFriendPoolEntry(null, fd)).toEqual({ ok: true });
    expect(m.getInPlayState).toHaveBeenCalledWith(
      expect.objectContaining({ id: MATCH_ID }),
      expect.objectContaining({ maxAgeMs: 120_000 }),
    );
    const arg = m.insertFriendPoolEntry.mock.calls[0]![0];
    expect(arg.isLive).toBe(true);
    const stamp = LiveStampSchema.parse(arg.liveState);
    expect(stamp).toMatchObject({
      source: "api_football",
      status: "1H",
      elapsed: 12,
      minuteLabel: "12'",
      score: { home: 1, away: 0 },
      recordedAt: at(12).toISOString(),
    });
  });

  it("estado velho (> 2 min) e a busca não renovou: anota com carimbo de relógio", async () => {
    vi.setSystemTime(at(8));
    m.getInPlayState.mockResolvedValue(
      inPlay({ elapsed: 4, fetchedAt: at(5), minuteLabel: "4'", ageMs: 3 * MIN }),
    );
    expect(await addFriendPoolEntry(null, entryForm())).toEqual({ ok: true });
    const arg = m.insertFriendPoolEntry.mock.calls[0]![0];
    expect(arg.isLive).toBe(true);
    expect(arg.liveState).toMatchObject({ source: "clock", score: null, minuteLabel: null });
  });

  it("provider fora (sem estado) ou getInPlayState lançando: relógio, não bloqueia", async () => {
    vi.setSystemTime(at(10));
    m.getInPlayState.mockRejectedValueOnce(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await addFriendPoolEntry(null, entryForm())).toEqual({ ok: true });
    warn.mockRestore();
    expect(m.insertFriendPoolEntry.mock.calls[0]![0].liveState).toMatchObject({
      source: "clock",
    });
  });

  it("aos 15' de jogo: recusa", async () => {
    vi.setSystemTime(at(17));
    m.getInPlayState.mockResolvedValue(inPlay({ elapsed: 15, minuteLabel: "15'" }));
    expect(await addFriendPoolEntry(null, entryForm())).toEqual({
      ok: false,
      error: "As apostas deste bolão fecharam.",
    });
    expect(m.insertFriendPoolEntry).not.toHaveBeenCalled();
  });

  it("dono fechou: recusa mesmo no 1º tempo", async () => {
    vi.setSystemTime(at(5));
    m.getFriendPool.mockResolvedValue(pool({ betsClosedAt: at(4) }));
    m.getInPlayState.mockResolvedValue(inPlay({ elapsed: 5 }));
    expect((await addFriendPoolEntry(null, entryForm())).ok).toBe(false);
    expect(m.insertFriendPoolEntry).not.toHaveBeenCalled();
  });

  it("flag OFF: fecha no apito como hoje, sem ler estado", async () => {
    vi.setSystemTime(at(2));
    m.getEnableLiveMode.mockResolvedValue(false);
    expect(await addFriendPoolEntry(null, entryForm())).toEqual({
      ok: false,
      error: "O jogo já começou: as apostas deste bolão fecharam.",
    });
    expect(m.getInPlayState).not.toHaveBeenCalled();
  });
});

describe("removeFriendPoolEntry", () => {
  const fd = () => form({ poolId: POOL_ID, entryId: ENTRY_ID });

  it("antes do apito: tira", async () => {
    vi.setSystemTime(at(-1));
    await removeFriendPoolEntry(fd());
    expect(m.deleteFriendPoolEntry).toHaveBeenCalledWith({
      entryId: ENTRY_ID,
      poolId: POOL_ID,
      userId: OWNER,
    });
  });

  it("depois do apito: recusa, mesmo com as apostas abertas ao vivo", async () => {
    vi.setSystemTime(at(3));
    m.getInPlayState.mockResolvedValue(inPlay({ elapsed: 3 }));
    await removeFriendPoolEntry(fd());
    expect(m.deleteFriendPoolEntry).not.toHaveBeenCalled();
  });
});

describe("createFriendPool", () => {
  const fd = () => form({ matchId: MATCH_ID, title: "", entryAmount: "" });

  it("ao vivo antes do corte: cria", async () => {
    vi.setSystemTime(at(10));
    m.getInPlayState.mockResolvedValue(inPlay({ elapsed: 10 }));
    await createFriendPool(null, fd());
    expect(m.insertFriendPool).toHaveBeenCalled();
    expect(m.redirect).toHaveBeenCalledWith(`/bolao/${POOL_ID}`);
  });

  it("depois do corte: recusa com a copy do ao vivo", async () => {
    vi.setSystemTime(at(20));
    const r = await createFriendPool(null, fd());
    expect(r).toEqual({
      ok: false,
      error:
        "As apostas desse jogo já fecharam (o bolão aceita apostas até os 15 minutos de jogo). Escolha outro jogo.",
    });
    expect(m.insertFriendPool).not.toHaveBeenCalled();
  });

  it("flag OFF: recusa logo depois do apito (hoje)", async () => {
    vi.setSystemTime(at(1));
    m.getEnableLiveMode.mockResolvedValue(false);
    const r = await createFriendPool(null, fd());
    expect(r).toEqual({
      ok: false,
      error: "Esse jogo já começou. Escolha um que ainda não começou.",
    });
  });
});

describe("setFriendPoolScore", () => {
  const fd = () => form({ poolId: POOL_ID, home: "2", away: "1" });

  it("com as apostas abertas ao vivo: recusa com a copy nova", async () => {
    vi.setSystemTime(at(5));
    m.getInPlayState.mockResolvedValue(inPlay({ elapsed: 5 }));
    expect(await setFriendPoolScore(null, fd())).toEqual({
      ok: false,
      error: "O placar só pode ser lançado depois que as apostas fecham.",
    });
  });

  it("depois que as apostas fecham: lança", async () => {
    vi.setSystemTime(at(100));
    expect(await setFriendPoolScore(null, fd())).toEqual({ ok: true });
    expect(m.setFriendPoolManualScore).toHaveBeenCalledWith({
      poolId: POOL_ID,
      userId: OWNER,
      score: { home: 2, away: 1 },
    });
  });
});

describe("closeFriendPoolBets (dono)", () => {
  const fd = () => form({ poolId: POOL_ID });

  it("apostas abertas: grava o fechamento com o dono da sessão", async () => {
    vi.setSystemTime(at(5));
    m.getInPlayState.mockResolvedValue(inPlay({ elapsed: 5 }));
    await closeFriendPoolBets(fd());
    expect(m.getFriendPool).toHaveBeenCalledWith(POOL_ID, OWNER);
    expect(m.setFriendPoolBetsClosed).toHaveBeenCalledWith({
      poolId: POOL_ID,
      userId: OWNER,
      now: at(5),
    });
  });

  it("já fechadas: não grava de novo", async () => {
    vi.setSystemTime(at(30));
    await closeFriendPoolBets(fd());
    expect(m.setFriendPoolBetsClosed).not.toHaveBeenCalled();
  });

  it("bolão de outra pessoa: getFriendPool não acha, nada muda", async () => {
    vi.setSystemTime(at(5));
    m.getFriendPool.mockResolvedValue(null);
    await closeFriendPoolBets(fd());
    expect(m.setFriendPoolBetsClosed).not.toHaveBeenCalled();
  });

  it("flag OFF: sem o controle, nem antes do apito (como antes)", async () => {
    vi.setSystemTime(at(-30));
    m.getEnableLiveMode.mockResolvedValue(false);
    await closeFriendPoolBets(fd());
    expect(m.setFriendPoolBetsClosed).not.toHaveBeenCalled();
  });
});

describe("reopenFriendPoolBets (dono, #601)", () => {
  const fd = () => form({ poolId: POOL_ID });
  const CAP = at(180);

  it("fechado pelo corte dos 15': reabre até o teto, com o dono como quem estendeu", async () => {
    vi.setSystemTime(at(30));
    m.getInPlayState.mockResolvedValue(inPlay({ elapsed: 30, minuteLabel: "30'" }));
    await reopenFriendPoolBets(fd());
    expect(m.getFriendPool).toHaveBeenCalledWith(POOL_ID, OWNER);
    expect(m.getInPlayState).toHaveBeenCalled();
    expect(m.setFriendPoolBetsExtended).toHaveBeenCalledWith({
      poolId: POOL_ID,
      userId: OWNER,
      until: CAP,
      now: at(30),
    });
    expect(m.revalidatePath).toHaveBeenCalledWith(`/bolao/${POOL_ID}`);
    expect(m.revalidatePath).toHaveBeenCalledWith("/bolao");
  });

  it("fechado pelo dono: reabre, e depois anota no 2º tempo com carimbo", async () => {
    vi.setSystemTime(at(70));
    m.getFriendPool.mockResolvedValue(pool({ betsClosedAt: at(10) }));
    m.getInPlayState.mockResolvedValue(
      inPlay({ statusShort: "2H", elapsed: 55, minuteLabel: "55'" }),
    );
    await reopenFriendPoolBets(fd());
    expect(m.setFriendPoolBetsExtended).toHaveBeenCalledTimes(1);
    // O que a query grava: fechamento limpo, extensão até o teto.
    m.getFriendPool.mockResolvedValue(
      pool({ betsClosedAt: null, betsExtendedUntil: CAP, betsExtendedByUserId: OWNER }),
    );
    expect(await addFriendPoolEntry(null, entryForm())).toEqual({ ok: true });
    const call = m.insertFriendPoolEntry.mock.calls[0]![0];
    expect(call.isLive).toBe(true);
    expect(LiveStampSchema.parse(call.liveState)).toMatchObject({
      minuteLabel: "55'",
      score: { home: 1, away: 0 },
    });
    // E o dono pode fechar de novo.
    await closeFriendPoolBets(fd());
    expect(m.setFriendPoolBetsClosed).toHaveBeenCalledWith({
      poolId: POOL_ID,
      userId: OWNER,
      now: at(70),
    });
  });

  it("vale para quem não é admin (é o dono)", async () => {
    vi.setSystemTime(at(30));
    await reopenFriendPoolBets(fd());
    expect(m.setFriendPoolBetsExtended).toHaveBeenCalledTimes(1);
  });

  it("bolão de outra pessoa: getFriendPool não acha, nada muda", async () => {
    vi.setSystemTime(at(30));
    m.getFriendPool.mockResolvedValue(null);
    await reopenFriendPoolBets(fd());
    expect(m.setFriendPoolBetsExtended).not.toHaveBeenCalled();
  });

  it("sem sessão ou id inválido: nada muda", async () => {
    vi.setSystemTime(at(30));
    await reopenFriendPoolBets(form({ poolId: "x" }));
    m.auth.mockResolvedValue(null);
    await reopenFriendPoolBets(fd());
    expect(m.getFriendPool).not.toHaveBeenCalled();
    expect(m.setFriendPoolBetsExtended).not.toHaveBeenCalled();
  });

  it("apostas ainda abertas (antes dos 15'): não grava", async () => {
    vi.setSystemTime(at(5));
    m.getInPlayState.mockResolvedValue(inPlay({ elapsed: 5 }));
    await reopenFriendPoolBets(fd());
    expect(m.setFriendPoolBetsExtended).not.toHaveBeenCalled();
  });

  it("antes do apito, com a flag OFF, com resultado, jogo terminado ou no teto: recusa", async () => {
    vi.setSystemTime(at(-10));
    m.getFriendPool.mockResolvedValue(pool({ betsClosedAt: at(-30) }));
    await reopenFriendPoolBets(fd());

    vi.setSystemTime(at(30));
    m.getEnableLiveMode.mockResolvedValue(false);
    await reopenFriendPoolBets(fd());
    m.getEnableLiveMode.mockResolvedValue(true);

    m.getFriendPool.mockResolvedValue(
      pool({ betsClosedAt: at(10), manualHomeScore: 2, manualAwayScore: 1 }),
    );
    await reopenFriendPoolBets(fd());

    m.getFriendPool.mockResolvedValue(pool());
    vi.setSystemTime(at(115));
    m.getInPlayState.mockResolvedValue(inPlay({ statusShort: "FT", elapsed: 90 }));
    await reopenFriendPoolBets(fd());

    m.getInPlayState.mockResolvedValue(null);
    vi.setSystemTime(at(180));
    await reopenFriendPoolBets(fd());

    expect(m.setFriendPoolBetsExtended).not.toHaveBeenCalled();
  });

  it("jogo encerrado no DB: recusa sem precisar do estado", async () => {
    vi.setSystemTime(at(120));
    m.getFriendPool.mockResolvedValue({ ...pool(), match: { ...match, status: "finished" } });
    await reopenFriendPoolBets(fd());
    expect(m.setFriendPoolBetsExtended).not.toHaveBeenCalled();
  });
});

describe("extendFriendPoolBets (admin)", () => {
  const fd = (minutes = "30") => form({ poolId: POOL_ID, minutes });
  const asAdmin = () =>
    m.auth.mockResolvedValue({ user: { id: OWNER, email: "dono@example.com", role: "admin" } });

  it("admin no próprio bolão: estende a partir de agora", async () => {
    asAdmin();
    vi.setSystemTime(at(20));
    m.getInPlayState.mockResolvedValue(inPlay({ elapsed: 20, minuteLabel: "20'" }));
    await extendFriendPoolBets(fd());
    expect(m.getFriendPool).toHaveBeenCalledWith(POOL_ID, OWNER);
    expect(m.setFriendPoolBetsExtended).toHaveBeenCalledWith({
      poolId: POOL_ID,
      userId: OWNER,
      until: at(50),
      now: at(20),
    });
  });

  it("teto: apito + 3h", async () => {
    asAdmin();
    vi.setSystemTime(at(170));
    await extendFriendPoolBets(fd("60"));
    expect(m.setFriendPoolBetsExtended.mock.calls[0]![0].until).toEqual(at(180));
  });

  it("não-admin não estende", async () => {
    vi.setSystemTime(at(20));
    await extendFriendPoolBets(fd());
    expect(m.getFriendPool).not.toHaveBeenCalled();
    expect(m.setFriendPoolBetsExtended).not.toHaveBeenCalled();
  });

  it("admin não estende o bolão de outra pessoa (getFriendPool filtra pelo dono)", async () => {
    asAdmin();
    vi.setSystemTime(at(20));
    m.getFriendPool.mockImplementation(async (_id: string, userId: string) =>
      userId === "someone-else" ? pool() : null,
    );
    await extendFriendPoolBets(fd());
    expect(m.getFriendPool).toHaveBeenCalledWith(POOL_ID, OWNER);
    expect(m.setFriendPoolBetsExtended).not.toHaveBeenCalled();
  });

  it("antes do apito (kickoff − 10 min): recusa", async () => {
    asAdmin();
    vi.setSystemTime(at(-10));
    await extendFriendPoolBets(fd());
    expect(m.setFriendPoolBetsExtended).not.toHaveBeenCalled();
  });

  it("admin fechou e lançou 2-1: estender recusado e anotar recusado", async () => {
    asAdmin();
    vi.setSystemTime(at(30));
    m.getFriendPool.mockResolvedValue(
      pool({ betsClosedAt: at(10), manualHomeScore: 2, manualAwayScore: 1 }),
    );
    await extendFriendPoolBets(fd());
    expect(m.setFriendPoolBetsExtended).not.toHaveBeenCalled();
    expect(await addFriendPoolEntry(null, entryForm())).toEqual({
      ok: false,
      error: "Este bolão já tem resultado: não entram mais apostas.",
    });
    expect(m.insertFriendPoolEntry).not.toHaveBeenCalled();
  });

  it("extensão gravada antes do placar manual: anotar recusado", async () => {
    vi.setSystemTime(at(30));
    m.getFriendPool.mockResolvedValue(
      pool({ betsExtendedUntil: at(60), manualHomeScore: 2, manualAwayScore: 1 }),
    );
    expect((await addFriendPoolEntry(null, entryForm())).ok).toBe(false);
    expect(m.insertFriendPoolEntry).not.toHaveBeenCalled();
  });

  it("preset fora da lista, jogo terminado ou flag OFF: recusa", async () => {
    asAdmin();
    vi.setSystemTime(at(20));
    await extendFriendPoolBets(fd("45"));
    m.getInPlayState.mockResolvedValue(inPlay({ statusShort: "FT", elapsed: 90 }));
    await extendFriendPoolBets(fd());
    m.getEnableLiveMode.mockResolvedValue(false);
    await extendFriendPoolBets(fd());
    expect(m.setFriendPoolBetsExtended).not.toHaveBeenCalled();
  });
});
