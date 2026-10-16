import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocka o shim @/lib/ai/anthropic: `models.list` devolve um async iterable, como o
// PagePromise do SDK no for-await. Nenhuma chamada real.
const modelsList = vi.fn();
const getClient = vi.fn(() => ({ models: { list: modelsList } }));
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => getClient(),
}));

import { LIST_REQUEST_OPTIONS, listApiModels } from "../models-catalog";

const CAPS = {
  effort: { supported: true },
  thinking: { supported: true, types: { adaptive: { supported: true } } },
};

async function* page(rows: Record<string, unknown>[]) {
  for (const r of rows) yield r;
}

beforeEach(() => {
  modelsList.mockReset();
  getClient.mockClear();
});

describe("listApiModels — listagem sem cache que lança (ADR 0062)", () => {
  it("mapeia id/display_name/created_at/capabilities/max_tokens", async () => {
    modelsList.mockImplementation(() =>
      page([
        {
          id: "claude-sonnet-5-6",
          display_name: "Claude Sonnet 5.6",
          created_at: "2026-11-01T00:00:00Z",
          type: "model",
          capabilities: CAPS,
          max_input_tokens: 1_000_000,
          max_tokens: 128_000,
        },
        {
          id: "claude-x",
          display_name: "X",
          created_at: "2026-11-01T00:00:00Z",
          type: "model",
          capabilities: null,
          max_input_tokens: null,
          max_tokens: null,
        },
      ]),
    );
    expect(await listApiModels()).toEqual([
      {
        id: "claude-sonnet-5-6",
        displayName: "Claude Sonnet 5.6",
        createdAt: "2026-11-01T00:00:00Z",
        capabilities: CAPS,
        maxTokens: 128_000,
      },
      {
        id: "claude-x",
        displayName: "X",
        createdAt: "2026-11-01T00:00:00Z",
        capabilities: null,
        maxTokens: null,
      },
    ]);
  });

  it("sem cache: cada leitura lista de novo", async () => {
    modelsList.mockImplementation(() => page([]));
    await listApiModels();
    await listApiModels();
    expect(modelsList).toHaveBeenCalledTimes(2);
  });

  it("erro da API (ou sem chave) propaga, em vez de virar lista vazia", async () => {
    modelsList.mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(listApiModels()).rejects.toThrow("boom");
    getClient.mockImplementationOnce(() => {
      throw new Error("ANTHROPIC_API_KEY is not set");
    });
    await expect(listApiModels()).rejects.toThrow("ANTHROPIC_API_KEY");
  });

  it("cada request da listagem vai com timeout de 10s e 2 retries", async () => {
    modelsList.mockImplementation(() => page([]));
    await listApiModels();
    expect(modelsList).toHaveBeenCalledWith({ limit: 100 }, LIST_REQUEST_OPTIONS);
    expect(LIST_REQUEST_OPTIONS).toEqual({ timeout: 10_000, maxRetries: 2 });
  });
});
