import { describe, expect, it } from "vitest";

import {
  capabilityBlockedMessage,
  capabilityGateMessage,
  SEU_PALPITE_PRE_MATCH_ONLY,
  seuPalpiteClosedMessage,
} from "@/app/actions/not-analyzable";
import { matchPhase, type LiveStateInput } from "@/lib/live/phase";

const NOW = new Date("2026-10-15T20:00:00Z");
const KICKOFF = new Date(NOW.getTime() - 40 * 60_000);
const LIVE_MATCH = { status: "live", kickoffAt: KICKOFF };
const IN_PROGRESS =
  "Jogo em andamento — a análise fica disponível só antes do apito inicial.";

function state(over: Partial<LiveStateInput> = {}): LiveStateInput {
  return {
    statusShort: "1H",
    elapsed: 40,
    extra: null,
    fetchedAt: new Date(NOW.getTime() - 30_000),
    ...over,
  };
}

describe("capabilityGateMessage (ADR 0060)", () => {
  it("sem estado (como as actions chamam hoje): o gate de pré-jogo de sempre", () => {
    for (const cap of [
      "analyze",
      "seuPalpite",
      "registerBets",
      "pool",
      "analyzeMarkets",
    ] as const) {
      expect(capabilityGateMessage(cap, LIVE_MATCH, { now: NOW })).toBe(
        IN_PROGRESS
      );
      expect(
        capabilityGateMessage(
          cap,
          { status: "scheduled", kickoffAt: new Date(NOW.getTime() + 60_000) },
          { now: NOW }
        )
      ).toBeNull();
    }
  });

  it("flag OFF com estado bom: fecha no apito como antes", () => {
    expect(
      capabilityGateMessage("analyze", LIVE_MATCH, {
        now: NOW,
        state: state(),
        liveMode: false,
        modelReady: true,
      })
    ).toBe(IN_PROGRESS);
  });

  it("ao vivo com estado bom: libera por capacidade", () => {
    const ctx = { now: NOW, state: state(), liveMode: true } as const;
    expect(
      capabilityGateMessage("analyze", LIVE_MATCH, { ...ctx, modelReady: true })
    ).toBeNull();
    expect(capabilityGateMessage("registerBets", LIVE_MATCH, ctx)).toBeNull();
    expect(capabilityGateMessage("analyze", LIVE_MATCH, ctx)).toBe(
      "Sem modelo para a leitura ao vivo deste jogo."
    );
    expect(
      capabilityGateMessage("analyzeMarkets", LIVE_MATCH, {
        ...ctx,
        modelReady: true,
      })
    ).toContain("use Analisar com IA");
  });

  it("estado velho, prorrogação e interrupção: copy pelo motivo", () => {
    const base = { now: NOW, liveMode: true, modelReady: true } as const;
    expect(
      capabilityGateMessage("registerBets", LIVE_MATCH, {
        ...base,
        state: state({ fetchedAt: new Date(NOW.getTime() - 5 * 60_000) }),
      })
    ).toBe("Placar ao vivo indisponível agora. Tente em um minuto.");
    expect(
      capabilityGateMessage("analyze", LIVE_MATCH, {
        ...base,
        state: state({ statusShort: "ET", elapsed: 100 }),
      })
    ).toContain("prorrogação");
    expect(
      capabilityGateMessage("analyze", LIVE_MATCH, {
        ...base,
        state: state({ statusShort: "INT" }),
      })
    ).toContain("interrompido");
  });

  it("capabilityBlockedMessage nunca diz encerrado num jogo ao vivo", () => {
    for (const reason of [
      "started",
      "live",
      "postponed",
      "extra_time",
      "interrupted",
      "live_unavailable",
    ] as const) {
      expect(capabilityBlockedMessage("analyze", reason)).not.toMatch(
        /encerrado|cancelado/
      );
    }
  });
});

describe("seuPalpiteClosedMessage (#594): a aba Seu palpite fechada", () => {
  const phaseOf = (
    match: { status: string; kickoffAt: Date },
    s: LiveStateInput | null,
    liveMode: boolean
  ) => matchPhase(match, s, NOW, { liveMode });

  it("flag desligada ou antes do apito: a copy de sempre", () => {
    expect(seuPalpiteClosedMessage(phaseOf(LIVE_MATCH, null, false))).toBe(
      SEU_PALPITE_PRE_MATCH_ONLY
    );
    expect(
      seuPalpiteClosedMessage(phaseOf(LIVE_MATCH, state(), false), {
        liveMode: false,
      })
    ).toBe(SEU_PALPITE_PRE_MATCH_ONLY);
    const pre = phaseOf(
      { status: "scheduled", kickoffAt: new Date(NOW.getTime() + 3_600_000) },
      null,
      true
    );
    expect(seuPalpiteClosedMessage(pre, { liveMode: true })).toBe(
      SEU_PALPITE_PRE_MATCH_ONLY
    );
  });

  it("ao vivo: por motivo, nunca 'aberto até o apito inicial'", () => {
    const opts = { liveMode: true };
    // Sem estado: placar indisponível.
    expect(
      seuPalpiteClosedMessage(phaseOf(LIVE_MATCH, null, true), opts)
    ).toBe(capabilityBlockedMessage("seuPalpite", "live_unavailable"));
    // Encerrado.
    expect(
      seuPalpiteClosedMessage(
        phaseOf(LIVE_MATCH, state({ statusShort: "FT", elapsed: 90 }), true),
        opts
      )
    ).toBe(capabilityBlockedMessage("seuPalpite", "finished"));
    // Rolando, estado bom, sem placar / sem modelo.
    const inPlay = phaseOf(LIVE_MATCH, state(), true);
    expect(inPlay.actionable).toBe(true);
    expect(seuPalpiteClosedMessage(inPlay, opts)).toBe(
      "Placar ao vivo indisponível agora. Tente em um minuto."
    );
    expect(
      seuPalpiteClosedMessage(inPlay, { ...opts, hasScore: true })
    ).toBe("Sem modelo para a leitura ao vivo deste jogo.");
    for (const p of [
      phaseOf(LIVE_MATCH, null, true),
      phaseOf(LIVE_MATCH, state({ statusShort: "FT", elapsed: 90 }), true),
      inPlay,
    ]) {
      expect(seuPalpiteClosedMessage(p, opts)).not.toBe(
        SEU_PALPITE_PRE_MATCH_ONLY
      );
    }
  });
});
