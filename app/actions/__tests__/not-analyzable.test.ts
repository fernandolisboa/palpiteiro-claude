import { describe, expect, it } from "vitest";

import {
  capabilityBlockedMessage,
  capabilityGateMessage,
} from "@/app/actions/not-analyzable";
import type { LiveStateInput } from "@/lib/live/phase";

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
