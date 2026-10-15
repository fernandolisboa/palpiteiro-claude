import { describe, expect, it } from "vitest";

import type { LiveStateInput } from "@/lib/live/phase";
import {
  EMPTY_HERO_UNAVAILABLE_COPY,
  matchCapabilities,
  matchPhase,
  matchUnavailableReason,
  unavailableNoticeCopy,
  type MatchCapabilities,
  type MatchPhase,
  type MatchUnavailableReason,
} from "@/lib/view/match-availability";

const NOW = new Date("2026-09-28T20:00:00.000Z");
const FUTURE = new Date(NOW.getTime() + 60 * 1000);
const PAST = new Date(NOW.getTime() - 60 * 1000);

describe("matchUnavailableReason", () => {
  it("scheduled com kickoff no futuro → analisável (null)", () => {
    expect(matchUnavailableReason("scheduled", FUTURE, NOW)).toBeNull();
  });

  it("scheduled já apitado (enum stale até o cron virar) → já começou, não encerrado", () => {
    expect(matchUnavailableReason("scheduled", PAST, NOW)).toBe("started");
    expect(matchUnavailableReason("scheduled", NOW, NOW)).toBe("started");
  });

  it("scheduled sem kickoff (caminho de race) → decide só pelo status", () => {
    expect(matchUnavailableReason("scheduled", undefined, NOW)).toBeNull();
  });

  it.each(["live", "postponed", "cancelled", "finished"] as const)(
    "%s → o próprio motivo, qualquer kickoff",
    (status) => {
      expect(matchUnavailableReason(status, FUTURE, NOW)).toBe(status);
      expect(matchUnavailableReason(status, PAST, NOW)).toBe(status);
    }
  );

  it("status desconhecido → encerrado (fail-closed)", () => {
    expect(matchUnavailableReason("", undefined, NOW)).toBe("finished");
    expect(matchUnavailableReason("abandoned", FUTURE, NOW)).toBe("finished");
  });
});

describe("copy por motivo", () => {
  it("só encerrado e cancelado dizem que acabou", () => {
    expect(EMPTY_HERO_UNAVAILABLE_COPY.finished).toBe(
      "Jogo encerrado, sem palpite por aqui."
    );
    expect(EMPTY_HERO_UNAVAILABLE_COPY.cancelled).toContain("cancelado");
    expect(EMPTY_HERO_UNAVAILABLE_COPY.live).toContain("em andamento");
    expect(EMPTY_HERO_UNAVAILABLE_COPY.postponed).toContain("adiado");
    expect(EMPTY_HERO_UNAVAILABLE_COPY.started).toContain("já começou");
    for (const reason of ["started", "live", "postponed"] as const) {
      expect(EMPTY_HERO_UNAVAILABLE_COPY[reason]).not.toMatch(
        /encerrado|cancelado/
      );
      const { label, detail } = unavailableNoticeCopy(reason, null);
      expect(`${label} ${detail}`).not.toMatch(/encerrado|cancelado/);
    }
  });

  it("aviso do encerrado mostra o placar quando há", () => {
    expect(unavailableNoticeCopy("finished", { home: 2, away: 1 })).toEqual({
      label: "jogo encerrado",
      detail:
        "Placar final 2–1. Análise indisponível para jogos já encerrados.",
    });
    expect(unavailableNoticeCopy("finished", null).detail).toBe(
      "Análise indisponível para jogos já encerrados."
    );
  });

  it("cancelado tem rótulo próprio, sem placar", () => {
    expect(unavailableNoticeCopy("cancelled", { home: 0, away: 0 })).toEqual({
      label: "jogo cancelado",
      detail: "Análise indisponível para jogos cancelados.",
    });
  });
});

describe("copy dos motivos ao vivo (ADR 0060)", () => {
  it.each(["extra_time", "interrupted", "live_unavailable"] as const)(
    "%s tem copy própria e não diz encerrado",
    (reason) => {
      expect(EMPTY_HERO_UNAVAILABLE_COPY[reason]).not.toMatch(
        /encerrado|cancelado/
      );
      const { label, detail } = unavailableNoticeCopy(reason, {
        home: 1,
        away: 0,
      });
      expect(label).not.toBe("");
      expect(`${label} ${detail}`).not.toMatch(/encerrado|cancelado/);
    }
  );
});

const ALL_CLOSED: MatchCapabilities = {
  analyze: false,
  seuPalpite: false,
  registerBets: false,
  pool: false,
  analyzeMarkets: false,
};
const ALL_OPEN: MatchCapabilities = {
  analyze: true,
  seuPalpite: true,
  registerBets: true,
  pool: true,
  analyzeMarkets: true,
};

const KICKOFF = new Date(NOW.getTime() - 30 * 60_000);
function liveState(over: Partial<LiveStateInput> = {}): LiveStateInput {
  return {
    statusShort: "1H",
    elapsed: 30,
    extra: null,
    fetchedAt: new Date(NOW.getTime() - 20_000),
    ...over,
  };
}

describe("matchPhase", () => {
  it("pré-jogo: kickoff no futuro, com ou sem estado e flag", () => {
    const pre = { status: "scheduled", kickoffAt: FUTURE };
    expect(matchPhase(pre, null, NOW)).toEqual({
      kind: "pre",
      reason: null,
      actionable: false,
    });
    expect(matchPhase(pre, liveState(), NOW, { liveMode: true }).kind).toBe(
      "pre"
    );
  });

  // Flag OFF ou sem estado = exatamente o gate de hoje.
  it.each([
    ["scheduled", PAST],
    ["scheduled", FUTURE],
    ["live", PAST],
    ["postponed", PAST],
    ["cancelled", PAST],
    ["finished", PAST],
    ["abandoned", PAST],
  ] as const)(
    "%s (kickoff %s): sem estado ou flag OFF, reason = matchUnavailableReason",
    (status, kickoffAt) => {
      const match = { status, kickoffAt };
      const today = matchUnavailableReason(status, kickoffAt, NOW);
      for (const phase of [
        matchPhase(match, null, NOW),
        matchPhase(match, liveState(), NOW, { liveMode: false }),
      ]) {
        expect(phase.reason).toBe(today);
        expect(phase.actionable).toBe(false);
      }
      // Flag ON sem estado lido: depois do apito vira "placar indisponível"; os outros
      // motivos (adiado, encerrado…) ficam como hoje.
      const withoutState =
        today === "started" || today === "live" ? "live_unavailable" : today;
      for (const phase of [
        matchPhase(match, null, NOW, { liveMode: true }),
        matchPhase(match, liveState({ fetchedAt: null }), NOW, {
          liveMode: true,
        }),
      ]) {
        expect(phase.reason).toBe(withoutState);
        expect(phase.actionable).toBe(false);
      }
    }
  );

  it.each<[string, Partial<LiveStateInput>, MatchPhase]>([
    ["1H fresco", {}, { kind: "in_play", reason: "live", actionable: true }],
    [
      "2H fresco",
      { statusShort: "2H", elapsed: 63 },
      { kind: "in_play", reason: "live", actionable: true },
    ],
    [
      "HT",
      { statusShort: "HT", elapsed: 45 },
      { kind: "half_time", reason: "live", actionable: true },
    ],
    [
      "NS atrasado",
      { statusShort: "NS", elapsed: null },
      { kind: "in_play", reason: "live", actionable: true },
    ],
    [
      "1H sem elapsed",
      { elapsed: null },
      { kind: "in_play", reason: "live_unavailable", actionable: false },
    ],
    [
      "LIVE",
      { statusShort: "LIVE" },
      { kind: "in_play", reason: "live_unavailable", actionable: false },
    ],
    [
      "estado de 3 min",
      { fetchedAt: new Date(NOW.getTime() - 180_000) },
      { kind: "in_play", reason: "live_unavailable", actionable: false },
    ],
    [
      "ET",
      { statusShort: "ET", elapsed: 95 },
      { kind: "extra_time", reason: "extra_time", actionable: false },
    ],
    [
      "P",
      { statusShort: "P", elapsed: 120 },
      { kind: "extra_time", reason: "extra_time", actionable: false },
    ],
    [
      "INT",
      { statusShort: "INT" },
      { kind: "interrupted", reason: "interrupted", actionable: false },
    ],
    [
      "FT",
      { statusShort: "FT", elapsed: 90 },
      { kind: "finished", reason: "finished", actionable: false },
    ],
    [
      "PST",
      { statusShort: "PST" },
      { kind: "postponed", reason: "postponed", actionable: false },
    ],
    [
      "ABD",
      { statusShort: "ABD" },
      { kind: "cancelled", reason: "cancelled", actionable: false },
    ],
    [
      "desconhecido",
      { statusShort: "XYZ" },
      {
        kind: "started_unknown",
        reason: "live_unavailable",
        actionable: false,
      },
    ],
  ])("ao vivo, %s", (_label, over, expected) => {
    for (const status of ["scheduled", "live"]) {
      expect(
        matchPhase({ status, kickoffAt: KICKOFF }, liveState(over), NOW, {
          liveMode: true,
        })
      ).toEqual(expected);
    }
  });

  it("terminal no DB vence o estado ao vivo", () => {
    expect(
      matchPhase({ status: "finished", kickoffAt: KICKOFF }, liveState(), NOW, {
        liveMode: true,
      })
    ).toEqual({ kind: "finished", reason: "finished", actionable: false });
  });
});

describe("matchCapabilities", () => {
  it("pré-jogo libera tudo, inclusive a reanálise por mercado", () => {
    expect(
      matchCapabilities(
        matchPhase({ status: "scheduled", kickoffAt: FUTURE }, null, NOW)
      )
    ).toEqual(ALL_OPEN);
  });

  // Flag OFF (default) ou sem estado: nada liberado depois do apito, como antes do #580.
  it.each(["started", "live", "postponed", "cancelled", "finished"] as const)(
    "%s sem estado → nada liberado, com qualquer opção",
    (reason) => {
      const status = reason === "started" ? "scheduled" : reason;
      const phase = matchPhase({ status, kickoffAt: PAST }, null, NOW, {
        liveMode: true,
      });
      // Flag ON sem estado: depois do apito vira "placar indisponível"; os outros
      // motivos ficam. Em todos, nada abre.
      expect(phase.reason).toBe(
        reason === "started" || reason === "live" ? "live_unavailable" : reason
      );
      expect(matchCapabilities(phase)).toEqual(ALL_CLOSED);
      expect(
        matchCapabilities(phase, { liveMode: true, modelReady: true })
      ).toEqual(ALL_CLOSED);
    }
  );

  it("flag OFF com estado bom: nada liberado depois do apito", () => {
    const phase = matchPhase(
      { status: "live", kickoffAt: KICKOFF },
      liveState(),
      NOW,
      { liveMode: false }
    );
    expect(
      matchCapabilities(phase, {
        liveMode: false,
        modelReady: true,
        poolWindowOpen: true,
      })
    ).toEqual(ALL_CLOSED);
  });

  it("ao vivo com estado bom e modelo: tudo menos a reanálise por mercado", () => {
    const phase = matchPhase(
      { status: "live", kickoffAt: KICKOFF },
      liveState(),
      NOW,
      { liveMode: true }
    );
    expect(
      matchCapabilities(phase, {
        liveMode: true,
        modelReady: true,
        poolWindowOpen: true,
      })
    ).toEqual({
      analyze: true,
      seuPalpite: true,
      registerBets: true,
      pool: true,
      analyzeMarkets: false,
    });
  });

  it("ao vivo sem modelo: registra (sem avaliação), não analisa", () => {
    const phase = matchPhase(
      { status: "live", kickoffAt: KICKOFF },
      liveState({ statusShort: "HT", elapsed: 45 }),
      NOW,
      { liveMode: true }
    );
    expect(matchCapabilities(phase, { liveMode: true })).toEqual({
      ...ALL_CLOSED,
      registerBets: true,
    });
  });

  it.each<[MatchUnavailableReason, string, boolean]>([
    ["extra_time", "ET", true],
    ["live_unavailable", "LIVE", true],
    ["interrupted", "SUSP", false],
    ["finished", "FT", false],
    ["postponed", "PST", false],
    ["cancelled", "CANC", false],
  ])(
    "%s ao vivo: nada liberado; o bolão segue a própria janela (aberta: %s → %s)",
    (reason, short, poolCanOpen) => {
      const phase = matchPhase(
        { status: "live", kickoffAt: KICKOFF },
        liveState({ statusShort: short }),
        NOW,
        { liveMode: true }
      );
      expect(phase.reason).toBe(reason);
      expect(
        matchCapabilities(phase, { liveMode: true, modelReady: true })
      ).toEqual(ALL_CLOSED);
      expect(
        matchCapabilities(phase, { liveMode: true, poolWindowOpen: true }).pool
      ).toBe(poolCanOpen);
      expect(
        matchCapabilities(phase, { liveMode: false, poolWindowOpen: true }).pool
      ).toBe(false);
    }
  );
});
