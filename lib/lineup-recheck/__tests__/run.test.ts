import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Cron da reconferência com a escalação (#619, PR B), com todas as fronteiras mockadas.
// O que importa: quando NÃO toca em provider (flag, lock, sem candidato, escalação que não
// saiu), uma chamada JEV por jogo pra N pais, o marcador por jogo, e que o limite diário,
// a The Odds API e a Anthropic nunca são chamados.

const getEnableLineupRecheck = vi.fn();
vi.mock("@/lib/db/queries/ai-config", () => ({
  getEnableLineupRecheck: () => getEnableLineupRecheck(),
}));

const getLineupRecheckCandidates = vi.fn();
vi.mock("@/lib/db/queries/lineup-recheck", () => ({
  getLineupRecheckCandidates: (...a: unknown[]) => getLineupRecheckCandidates(...a),
}));

const recheckPredictionWithLineup = vi.fn();
const resolveModelBaseJudgments = vi.fn();
vi.mock("@/lib/ai/predict", () => ({
  recheckPredictionWithLineup: (...a: unknown[]) => recheckPredictionWithLineup(...a),
  resolveModelBaseJudgments: (...a: unknown[]) => resolveModelBaseJudgments(...a),
}));

const hasTypeSafeKey = vi.fn();
vi.mock("@/lib/ai/providers/typesafe/client", () => ({
  hasTypeSafeKey: () => hasTypeSafeKey(),
}));

const fetchMatchJudgmentData = vi.fn();
vi.mock("@/lib/model-base/judgment-data", () => ({
  fetchMatchJudgmentData: (...a: unknown[]) => fetchMatchJudgmentData(...a),
}));

vi.mock("@/lib/model-base/compute-match-models", () => ({
  COMPUTE_MATCH_MODELS_LOCK_KEY: "model-base:compute:lock",
}));

const getLineups = vi.fn();
const getStandings = vi.fn();
const getSportsDataProvider = vi.fn(() => ({ getLineups, getStandings }));
vi.mock("@/lib/providers/sports-data", () => ({
  getSportsDataProvider: () => getSportsDataProvider(),
}));

// KV fake: chave → carimbo.
const kv = new Map<string, number>();
const acquireKvLock = vi.fn(async (key: string) => {
  if (kv.has(key)) return false;
  kv.set(key, Date.now());
  return true;
});
vi.mock("@/lib/sync/lock", () => ({
  acquireKvLock: (key: string) => acquireKvLock(key),
  releaseKvLock: async (key: string) => {
    kv.delete(key);
  },
  readKvStamp: async (key: string) => kv.get(key) ?? null,
  writeKvStamp: async (key: string, stamp: number) => {
    kv.set(key, stamp);
  },
}));

// Fronteiras que este cron nunca toca.
const rateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkAnalysisRateLimit: rateLimit,
  checkPalpitesRateLimit: rateLimit,
  checkBetParseRateLimit: rateLimit,
  checkBetSlipsRateLimit: rateLimit,
}));
const getOddsProvider = vi.fn();
vi.mock("@/lib/providers/odds", () => ({
  getOddsProvider: () => getOddsProvider(),
}));
const ensureOddsSnapshotsFresh = vi.fn();
vi.mock("@/lib/odds/fetch-and-snapshot", () => ({
  ensureOddsSnapshotsFresh: (...a: unknown[]) => ensureOddsSnapshotsFresh(...a),
}));
const anthropicCreate = vi.fn();
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({ messages: { create: anthropicCreate } }),
}));

import type { MatchJudgmentInput } from "@/lib/ai/engine/judgment-input";
import type { LineupRecheckCandidate } from "@/lib/db/queries/lineup-recheck";
import {
  isLineupInformative,
  LINEUP_RECHECK_LOCK_KEY,
  lineupRecheckMarkerKey,
  runLineupRechecks,
} from "@/lib/lineup-recheck/run";

const NOW = new Date("2026-05-15T18:20:00.000Z");
const min = (n: number) => n * 60_000;

function match(id: string, koMin: number) {
  return {
    id,
    league: "brasileirao_a",
    homeTeam: `Casa ${id}`,
    awayTeam: `Fora ${id}`,
    kickoffAt: new Date(NOW.getTime() + min(koMin)),
    status: "scheduled",
  };
}

function candidate(
  id: string,
  m: ReturnType<typeof match>,
  createdAt = new Date(NOW.getTime() - min(600)),
  marketKey = "match_result"
): LineupRecheckCandidate {
  return {
    prediction: { id, matchId: m.id, createdAt },
    match: m,
    marketKey,
  } as unknown as LineupRecheckCandidate;
}

function input(over: Partial<MatchJudgmentInput> = {}): MatchJudgmentInput {
  return {
    stateInput: {} as MatchJudgmentInput["stateInput"],
    absences: { home: [], away: [] },
    providerAbsences: { home: [], away: [] },
    lineup: {
      home: { status: "announced", changes: "3-4", leftOut: [] },
      away: { status: "announced", changes: null, leftOut: [] },
    },
    ...over,
  };
}

const RUN_OK = { answers: { x: 1 }, aiCallId: "jev-1", failure: null };
const LINEUP = { fixtureId: "f", home: {}, away: {} };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  kv.clear();
  getEnableLineupRecheck.mockResolvedValue(true);
  hasTypeSafeKey.mockReturnValue(true);
  getLineupRecheckCandidates.mockResolvedValue([]);
  getLineups.mockResolvedValue(LINEUP);
  getStandings.mockResolvedValue({ league: "brasileirao_a" });
  fetchMatchJudgmentData.mockResolvedValue({ data: true });
  resolveModelBaseJudgments.mockResolvedValue({ input: input(), run: RUN_OK });
  recheckPredictionWithLineup.mockResolvedValue({
    kind: "persisted",
    predictionId: "new",
    flipped: false,
    oddsFrom: "snapshot",
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  // Em nenhum caminho: limite diário, The Odds API, Anthropic.
  expect(rateLimit).not.toHaveBeenCalled();
  expect(getOddsProvider).not.toHaveBeenCalled();
  expect(ensureOddsSnapshotsFresh).not.toHaveBeenCalled();
  expect(anthropicCreate).not.toHaveBeenCalled();
  // O lock do run nunca fica preso.
  expect(kv.has(LINEUP_RECHECK_LOCK_KEY)).toBe(false);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function expectNoProviderCalls() {
  expect(getLineups).not.toHaveBeenCalled();
  expect(getStandings).not.toHaveBeenCalled();
  expect(fetchMatchJudgmentData).not.toHaveBeenCalled();
  expect(resolveModelBaseJudgments).not.toHaveBeenCalled();
  expect(recheckPredictionWithLineup).not.toHaveBeenCalled();
}

describe("runLineupRechecks: quando não faz nada", () => {
  it("flag OFF → sai sem query de candidatos nem provider", async () => {
    getEnableLineupRecheck.mockResolvedValue(false);
    const s = await runLineupRechecks({ now: NOW });
    expect(s.skipped).toBe("flag_off");
    expect(getLineupRecheckCandidates).not.toHaveBeenCalled();
    expectNoProviderCalls();
  });

  it("cron da base com o lock tomado → pula o run inteiro", async () => {
    kv.set("model-base:compute:lock", NOW.getTime());
    const s = await runLineupRechecks({ now: NOW });
    expect(s.skipped).toBe("model_base_running");
    expect(getLineupRecheckCandidates).not.toHaveBeenCalled();
    expectNoProviderCalls();
  });

  it("outro run com o lock → skipped locked", async () => {
    kv.set(LINEUP_RECHECK_LOCK_KEY, NOW.getTime());
    const s = await runLineupRechecks({ now: NOW });
    expect(s.skipped).toBe("locked");
    expectNoProviderCalls();
    kv.delete(LINEUP_RECHECK_LOCK_KEY);
  });

  it("sem candidatos → 1 query e sai, sem provider", async () => {
    const s = await runLineupRechecks({ now: NOW });
    expect(getLineupRecheckCandidates).toHaveBeenCalledWith({ now: NOW });
    expect(s).toMatchObject({ candidates: 0, matches: 0, errors: 0 });
    expect(s.skipped).toBeUndefined();
    expect(getSportsDataProvider).not.toHaveBeenCalled();
    expectNoProviderCalls();
  });

  it("sem chave do JEV → sai sem provider", async () => {
    getLineupRecheckCandidates.mockResolvedValue([candidate("p1", match("m1", 40))]);
    hasTypeSafeKey.mockReturnValue(false);
    const s = await runLineupRechecks({ now: NOW });
    expect(s.skipped).toBe("missing_jev_key");
    expectNoProviderCalls();
  });

  it("escalação ainda não saiu → só a sonda, sem marcador", async () => {
    getLineupRecheckCandidates.mockResolvedValue([candidate("p1", match("m1", 40))]);
    getLineups.mockResolvedValue(undefined);
    const s = await runLineupRechecks({ now: NOW });
    expect(getLineups).toHaveBeenCalledTimes(1);
    expect(getLineups).toHaveBeenCalledWith({
      league: "brasileirao_a",
      kickoffAt: match("m1", 40).kickoffAt.toISOString(),
      homeTeam: "Casa m1",
      awayTeam: "Fora m1",
    });
    expect(getStandings).not.toHaveBeenCalled();
    expect(fetchMatchJudgmentData).not.toHaveBeenCalled();
    expect(resolveModelBaseJudgments).not.toHaveBeenCalled();
    expect(s.lineupNotOut).toBe(1);
    expect(kv.has(lineupRecheckMarkerKey("m1"))).toBe(false);
  });

  it("jogo a ≤ 2 min do KO não começa", async () => {
    getLineupRecheckCandidates.mockResolvedValue([candidate("p1", match("m1", 2))]);
    const s = await runLineupRechecks({ now: NOW });
    expect(s.kickoffTooClose).toBe(1);
    expect(getLineups).not.toHaveBeenCalled();
  });
});

describe("runLineupRechecks: escalação publicada", () => {
  it("1 chamada JEV por jogo serve N pais (usuários e mercados)", async () => {
    const m1 = match("m1", 40);
    getLineupRecheckCandidates.mockResolvedValue([
      candidate("p1", m1),
      candidate("p2", m1, undefined, "over_under"),
      candidate("p3", m1),
    ]);
    recheckPredictionWithLineup
      .mockResolvedValueOnce({ kind: "persisted", predictionId: "n1", flipped: true, oddsFrom: "snapshot" })
      .mockResolvedValueOnce({ kind: "persisted", predictionId: "n2", flipped: false, oddsFrom: "parent" })
      .mockResolvedValueOnce({ kind: "skipped", reason: "superseded" });
    const s = await runLineupRechecks({ now: NOW });

    expect(getStandings).toHaveBeenCalledTimes(1);
    expect(fetchMatchJudgmentData).toHaveBeenCalledTimes(1);
    expect(resolveModelBaseJudgments).toHaveBeenCalledTimes(1);
    expect(resolveModelBaseJudgments).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: "m1",
        logScope: "recheck_lineups",
        judgeIf: isLineupInformative,
      })
    );
    expect(recheckPredictionWithLineup).toHaveBeenCalledTimes(3);
    const judgments = recheckPredictionWithLineup.mock.calls.map((c) => c[0].judgment);
    expect(new Set(judgments).size).toBe(1);
    expect(judgments[0]).toEqual({ input: input(), run: RUN_OK });
    expect(recheckPredictionWithLineup.mock.calls[1][0].parent.marketKey).toBe("over_under");
    expect(s).toMatchObject({
      candidates: 3,
      matches: 1,
      persisted: 2,
      flipped: 1,
      oddsFromParent: 1,
      parentsSkipped: { superseded: 1 },
      errors: 0,
    });
    // Marcador com o instante da busca dos candidatos.
    expect(kv.get(lineupRecheckMarkerKey("m1"))).toBe(NOW.getTime());
  });

  it("JEV sem resposta → nenhuma row e o marcador volta a não existir", async () => {
    getLineupRecheckCandidates.mockResolvedValue([candidate("p1", match("m1", 40))]);
    resolveModelBaseJudgments.mockResolvedValue({
      input: input(),
      run: { ...RUN_OK, answers: null, failure: { kind: "timeout" } },
    });
    const s = await runLineupRechecks({ now: NOW });
    expect(recheckPredictionWithLineup).not.toHaveBeenCalled();
    expect(s.jevFailed).toBe(1);
    expect(kv.has(lineupRecheckMarkerKey("m1"))).toBe(false);
  });

  it("falha na porta do JEV (null) não mexe no marcador: fica o carimbo anterior", async () => {
    const old = NOW.getTime() - min(60);
    kv.set(lineupRecheckMarkerKey("m1"), old);
    getLineupRecheckCandidates.mockResolvedValue([
      candidate("p1", match("m1", 40), new Date(NOW.getTime() - min(5))),
    ]);
    resolveModelBaseJudgments.mockResolvedValue(null);
    const s = await runLineupRechecks({ now: NOW });
    expect(s.jevFailed).toBe(1);
    expect(kv.get(lineupRecheckMarkerKey("m1"))).toBe(old);
  });

  it("escalação sem informação nova → sem row, marcador fica", async () => {
    getLineupRecheckCandidates.mockResolvedValue([candidate("p1", match("m1", 40))]);
    resolveModelBaseJudgments.mockResolvedValue({ input: input(), run: null });
    const s = await runLineupRechecks({ now: NOW });
    expect(s.uninformative).toBe(1);
    expect(recheckPredictionWithLineup).not.toHaveBeenCalled();
    expect(kv.get(lineupRecheckMarkerKey("m1"))).toBe(NOW.getTime());
  });

  it("tabela que falha → dado indisponível, sem JEV, marcador solto", async () => {
    getLineupRecheckCandidates.mockResolvedValue([candidate("p1", match("m1", 40))]);
    getStandings.mockRejectedValue(new Error("boom"));
    const s = await runLineupRechecks({ now: NOW });
    expect(s.dataUnavailable).toBe(1);
    expect(resolveModelBaseJudgments).not.toHaveBeenCalled();
    expect(kv.has(lineupRecheckMarkerKey("m1"))).toBe(false);
  });

  it("marcador existente: pais de antes dele pulam sem sonda; pai mais novo entra", async () => {
    const m1 = match("m1", 40);
    const marker = NOW.getTime() - min(20);
    kv.set(lineupRecheckMarkerKey("m1"), marker);
    getLineupRecheckCandidates.mockResolvedValue([
      candidate("old", m1, new Date(marker - 1000)),
    ]);
    let s = await runLineupRechecks({ now: NOW });
    expect(s.alreadyDone).toBe(1);
    expect(getLineups).not.toHaveBeenCalled();

    getLineupRecheckCandidates.mockResolvedValue([
      candidate("old", m1, new Date(marker - 1000)),
      candidate("new", m1, new Date(marker + 1000)),
    ]);
    s = await runLineupRechecks({ now: NOW });
    expect(recheckPredictionWithLineup).toHaveBeenCalledTimes(1);
    expect(recheckPredictionWithLineup.mock.calls[0][0].parent.prediction.id).toBe("new");
    expect(s.persisted).toBe(1);
  });

  it("prazo de início (120 s): o jogo seguinte fica pro próximo run", async () => {
    getLineupRecheckCandidates.mockResolvedValue([
      candidate("p1", match("m1", 40)),
      candidate("p2", match("m2", 50)),
    ]);
    fetchMatchJudgmentData.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 121_000);
      return { data: true };
    });
    const s = await runLineupRechecks({ now: NOW });
    expect(resolveModelBaseJudgments).toHaveBeenCalledTimes(1);
    expect(s.skippedDeadline).toBe(1);
    expect(getLineups).toHaveBeenCalledTimes(1);
  });

  it("reconferência que lança conta erro e não derruba os demais pais", async () => {
    const m1 = match("m1", 40);
    getLineupRecheckCandidates.mockResolvedValue([candidate("p1", m1), candidate("p2", m1)]);
    recheckPredictionWithLineup.mockRejectedValueOnce(new Error("db down"));
    const s = await runLineupRechecks({ now: NOW });
    expect(s.errors).toBe(1);
    expect(s.persisted).toBe(1);
  });

  it("pai que lança: sem marcador novo, e o próximo run refaz o jogo", async () => {
    const m1 = match("m1", 40);
    const old = NOW.getTime() - min(60);
    kv.set(lineupRecheckMarkerKey("m1"), old);
    const p1 = candidate("p1", m1, new Date(NOW.getTime() - min(5)));
    const p2 = candidate("p2", m1, new Date(NOW.getTime() - min(5)));
    getLineupRecheckCandidates.mockResolvedValue([p1, p2]);
    recheckPredictionWithLineup.mockRejectedValueOnce(new Error("db down"));
    await runLineupRechecks({ now: NOW });
    expect(kv.get(lineupRecheckMarkerKey("m1"))).toBe(old);

    // p2 virou reconferência (sai dos candidatos pelo DISTINCT ON); p1 volta.
    recheckPredictionWithLineup.mockClear();
    getLineupRecheckCandidates.mockResolvedValue([p1]);
    const s = await runLineupRechecks({ now: NOW });
    expect(recheckPredictionWithLineup).toHaveBeenCalledTimes(1);
    expect(recheckPredictionWithLineup.mock.calls[0][0].parent.prediction.id).toBe("p1");
    expect(s).toMatchObject({ persisted: 1, errors: 0, alreadyDone: 0 });
    expect(kv.get(lineupRecheckMarkerKey("m1"))).toBe(NOW.getTime());
  });

  it("marcador só depois da passada: um run que morre no meio não marca o jogo", async () => {
    const m1 = match("m1", 40);
    getLineupRecheckCandidates.mockResolvedValue([candidate("p1", m1), candidate("p2", m1)]);
    const markerDuringLoop: boolean[] = [];
    recheckPredictionWithLineup.mockImplementation(async () => {
      markerDuringLoop.push(kv.has(lineupRecheckMarkerKey("m1")));
      return { kind: "persisted", predictionId: "n", flipped: false, oddsFrom: "snapshot" };
    });
    await runLineupRechecks({ now: NOW });
    expect(markerDuringLoop).toEqual([false, false]);
    expect(kv.get(lineupRecheckMarkerKey("m1"))).toBe(NOW.getTime());
  });

  it("pulos determinísticos (sem odds, superseded) marcam o jogo", async () => {
    const m1 = match("m1", 40);
    getLineupRecheckCandidates.mockResolvedValue([candidate("p1", m1), candidate("p2", m1)]);
    recheckPredictionWithLineup
      .mockResolvedValueOnce({ kind: "skipped", reason: "no_odds" })
      .mockResolvedValueOnce({ kind: "skipped", reason: "superseded" });
    await runLineupRechecks({ now: NOW });
    expect(kv.get(lineupRecheckMarkerKey("m1"))).toBe(NOW.getTime());
  });

  it("o log do run traz as contagens de sem odds, superseded e sem informação", async () => {
    const m1 = match("m1", 40);
    const m2 = match("m2", 50);
    getLineupRecheckCandidates.mockResolvedValue([
      candidate("p1", m1),
      candidate("p2", m1),
      candidate("p3", m2),
    ]);
    resolveModelBaseJudgments
      .mockResolvedValueOnce({ input: input(), run: RUN_OK })
      .mockResolvedValueOnce({ input: input(), run: null });
    recheckPredictionWithLineup
      .mockResolvedValueOnce({ kind: "skipped", reason: "no_odds" })
      .mockResolvedValueOnce({ kind: "skipped", reason: "superseded" });
    await runLineupRechecks({ now: NOW });
    const logged = vi
      .mocked(console.log)
      .mock.calls.map((c) => JSON.parse(String(c[0])))
      .find((l) => l.event === "run_complete");
    expect(logged).toMatchObject({
      scope: "recheck_lineups",
      uninformative: 1,
      parentsSkipped: { no_odds: 1, superseded: 1, kickoff_passed: 0 },
    });
  });
});

describe("isLineupInformative", () => {
  it("mudanças contadas de um lado ou desfalcado entre os titulares → informativo", () => {
    expect(isLineupInformative(input())).toBe(true);
    const unknown = input({
      lineup: {
        home: { status: "announced", changes: null, leftOut: [] },
        away: { status: "announced", changes: null, leftOut: [] },
      },
    });
    expect(isLineupInformative(unknown)).toBe(false);
    expect(
      isLineupInformative({
        ...unknown,
        providerAbsences: {
          home: [{} as MatchJudgmentInput["absences"]["home"][number]],
          away: [],
        },
      })
    ).toBe(true);
    expect(
      isLineupInformative({
        ...unknown,
        lineup: { home: { status: "not_announced" }, away: { status: "not_announced" } },
      })
    ).toBe(false);
  });

  it("escalação anunciada com desfalcado em dúvida que sobrou na lista → informativo", () => {
    const absent = (status: "doubtful" | "injured") =>
      ({
        injury: { player: { name: "X" }, type: "injury", status },
      }) as MatchJudgmentInput["absences"]["home"][number];
    const unknown = input({
      lineup: {
        home: { status: "announced", changes: null, leftOut: [] },
        away: { status: "announced", changes: null, leftOut: [] },
      },
    });
    // Em dúvida no banco (ou fora) com a escalação saída: o v3 o trata como fora do jogo.
    const doubtful = {
      ...unknown,
      absences: { home: [], away: [absent("doubtful")] },
      providerAbsences: { home: [], away: [absent("doubtful")] },
    };
    expect(isLineupInformative(doubtful)).toBe(true);
    // Lesionado já era fora antes da escalação: nada novo.
    expect(
      isLineupInformative({
        ...unknown,
        absences: { home: [absent("injured")], away: [] },
        providerAbsences: { home: [absent("injured")], away: [] },
      })
    ).toBe(false);
    // Sem a escalação daquele lado, a dúvida segue dúvida.
    expect(
      isLineupInformative({
        ...doubtful,
        lineup: { ...doubtful.lineup, away: { status: "not_announced" } },
      })
    ).toBe(false);
  });
});
