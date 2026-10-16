import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MODEL_REGISTRY } from "@/lib/ai/models";
// O mock global (vitest.setup.ts) já troca getActiveModelState por um vi.fn: aqui só
// mudamos o que ele devolve por caso.
import {
  getActiveModelState,
  type ModelVersionRow,
} from "@/lib/db/queries/model-versions";

import {
  adoptedModelFromRow,
  pricingOf,
  resetActiveModelMemo,
  resolveActiveModel,
} from "../active";

const stateMock = vi.mocked(getActiveModelState);

function row(over: Partial<ModelVersionRow> = {}): ModelVersionRow {
  const t = new Date("2026-11-01T00:00:00Z");
  return {
    id: "claude-sonnet-5-6",
    family: "sonnet",
    displayName: "Claude Sonnet 5.6",
    apiCreatedAt: t,
    capabilities: null,
    maxTokens: 128_000,
    status: "active",
    pricing: { inputPricePerMTok: 2, outputPricePerMTok: 10 },
    priceConfirmedAt: null,
    adoptedAt: t,
    failureReason: null,
    probeAiCallId: null,
    createdAt: t,
    updatedAt: t,
    ...over,
  };
}

beforeEach(() => {
  resetActiveModelMemo();
  stateMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  stateMock.mockResolvedValue({ enabled: false, active: [] });
});

describe("adoptedModelFromRow", () => {
  it("herda da conferida e marca o preço estimado", () => {
    const m = adoptedModelFromRow(row());
    expect(m).toEqual({
      ...MODEL_REGISTRY["claude-sonnet-5-5"],
      id: "claude-sonnet-5-6",
      adopted: { priceEstimated: true, pinnedId: "claude-sonnet-5-5" },
    });
    expect(m?.label).toBe("Sonnet");
  });

  it("preço confirmado e tarifa de prompt longo da row", () => {
    const pricing = {
      inputPricePerMTok: 0.2,
      outputPricePerMTok: 1,
      longPromptPricing: { aboveInputTokens: 200_000, inputPricePerMTok: 1, outputPricePerMTok: 5 },
    };
    const m = adoptedModelFromRow(
      row({ id: "claude-haiku-5-6", family: "haiku", pricing, priceConfirmedAt: new Date() }),
    );
    expect(m).toMatchObject({
      id: "claude-haiku-5-6",
      speed: "fast",
      ...pricing,
      adopted: { priceEstimated: false, pinnedId: "claude-haiku-5-5" },
    });
  });

  it("row sem tarifa longa NÃO herda a da conferida", () => {
    const m = adoptedModelFromRow(
      row({ id: "claude-haiku-5-6", family: "haiku", pricing: { inputPricePerMTok: 1, outputPricePerMTok: 2 } }),
    );
    expect(m?.longPromptPricing).toBeUndefined();
  });

  it("id inválido, família trocada ou preço inválido → null", () => {
    expect(adoptedModelFromRow(row({ id: "claude-sonnet-6-preview" }))).toBeNull();
    expect(adoptedModelFromRow(row({ family: "opus" }))).toBeNull();
    expect(
      adoptedModelFromRow(row({ pricing: { inputPricePerMTok: -1, outputPricePerMTok: 1 } })),
    ).toBeNull();
    expect(
      adoptedModelFromRow(row({ pricing: { foo: 1 } as never })),
    ).toBeNull();
  });

  it("pricingOf copia o preço da conferida (com a tarifa longa do Haiku)", () => {
    expect(pricingOf(MODEL_REGISTRY["claude-haiku-5-5"])).toEqual({
      inputPricePerMTok: 0.1,
      outputPricePerMTok: 0.5,
      longPromptPricing: { aboveInputTokens: 100_000, inputPricePerMTok: 0.5, outputPricePerMTok: 2.5 },
    });
  });
});

describe("resolveActiveModel", () => {
  it("flag desligada ou nada adotado → a conferida", async () => {
    stateMock.mockResolvedValue({ enabled: false, active: [] });
    expect(await resolveActiveModel("sonnet")).toBe(MODEL_REGISTRY["claude-sonnet-5-5"]);
    resetActiveModelMemo();
    stateMock.mockResolvedValue({ enabled: true, active: [] });
    expect(await resolveActiveModel("sonnet")).toBe(MODEL_REGISTRY["claude-sonnet-5-5"]);
  });

  it("adotada da família → ela; outras famílias seguem na conferida", async () => {
    stateMock.mockResolvedValue({ enabled: true, active: [row()] });
    expect((await resolveActiveModel("sonnet")).id).toBe("claude-sonnet-5-6");
    expect(await resolveActiveModel("opus")).toBe(MODEL_REGISTRY["claude-opus-5-5"]);
    expect(stateMock).toHaveBeenCalledTimes(1);
  });

  it("row inválida → conferida, com aviso", async () => {
    stateMock.mockResolvedValue({ enabled: true, active: [row({ id: "lixo" })] });
    expect(await resolveActiveModel("sonnet")).toBe(MODEL_REGISTRY["claude-sonnet-5-5"]);
    expect(console.warn).toHaveBeenCalled();
  });

  it("memo de 60s: uma leitura dentro do TTL, nova leitura depois", async () => {
    stateMock.mockResolvedValue({ enabled: true, active: [row()] });
    const t0 = 1_000_000;
    await resolveActiveModel("sonnet", t0);
    await resolveActiveModel("sonnet", t0 + 59_999);
    expect(stateMock).toHaveBeenCalledTimes(1);
    stateMock.mockResolvedValue({ enabled: true, active: [] });
    expect(await resolveActiveModel("sonnet", t0 + 60_000)).toBe(
      MODEL_REGISTRY["claude-sonnet-5-5"],
    );
    expect(stateMock).toHaveBeenCalledTimes(2);
  });

  it("fail-safe: erro de leitura → conferida, sem memoizar a falha", async () => {
    stateMock.mockRejectedValueOnce(new Error("neon down"));
    expect(await resolveActiveModel("sonnet")).toBe(MODEL_REGISTRY["claude-sonnet-5-5"]);
    stateMock.mockResolvedValue({ enabled: true, active: [row()] });
    expect((await resolveActiveModel("sonnet")).id).toBe("claude-sonnet-5-6");
    expect(stateMock).toHaveBeenCalledTimes(2);
  });

  it("chamadas concorrentes com o memo frio dividem UMA leitura (inFlight)", async () => {
    let release!: () => void;
    stateMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ enabled: true, active: [row()] });
        }),
    );
    const a = resolveActiveModel("sonnet");
    const b = resolveActiveModel("opus");
    await Promise.resolve();
    release();
    expect((await a).id).toBe("claude-sonnet-5-6");
    expect((await b).id).toBe("claude-opus-5-5");
    expect(stateMock).toHaveBeenCalledTimes(1);
  });

  it("reset zera o memo; a leitura que começou antes do reset não grava o memo velho", async () => {
    stateMock.mockResolvedValue({ enabled: true, active: [row()] });
    await resolveActiveModel("sonnet");
    resetActiveModelMemo();
    stateMock.mockResolvedValue({ enabled: true, active: [] });
    expect((await resolveActiveModel("sonnet")).id).toBe("claude-sonnet-5-5");

    // Leitura lenta com a adotada; reset no meio; a próxima leitura não usa o memo dela.
    resetActiveModelMemo();
    let release!: () => void;
    stateMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ enabled: true, active: [row()] });
        }),
    );
    const slow = resolveActiveModel("sonnet");
    await Promise.resolve();
    resetActiveModelMemo();
    release();
    await slow;
    stateMock.mockResolvedValue({ enabled: true, active: [] });
    expect((await resolveActiveModel("sonnet")).id).toBe("claude-sonnet-5-5");
  });
});
