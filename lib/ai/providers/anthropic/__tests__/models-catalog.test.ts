import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MODEL_REGISTRY } from "@/lib/ai/models";

// Mocka o shim @/lib/ai/anthropic: `models.list` devolve um async iterable, como o
// PagePromise do SDK no for-await. Nenhuma chamada real.
const modelsList = vi.fn();
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({ models: { list: modelsList } }),
}));

import {
  type ApiModelInfo,
  listApiModels,
  resetApiModelsCacheForTests,
  unregisteredApiModels,
} from "../models-catalog";

const REGISTRY_IDS = Object.keys(MODEL_REGISTRY);

function info(id: string, createdAt: string): ApiModelInfo {
  return { id, displayName: id, createdAt };
}

describe("unregisteredApiModels — diff puro API × registry (#524)", () => {
  it("lista só ids claude-* fora do registry, na ordem da API", () => {
    const api = [
      info("claude-fable-6", "2026-10-01T00:00:00Z"),
      info("claude-fable-5-1", "2026-08-01T00:00:00Z"),
      info("claude-opus-5-5", "2026-09-01T00:00:00Z"),
      info("claude-opus-5", "2026-05-01T00:00:00Z"),
      info("claude-sonnet-5", "2026-04-01T00:00:00Z"),
      info("claude-sonnet-4-5-20250929", "2025-09-29T00:00:00Z"),
      info("claude-haiku-4-5-20251001", "2025-10-01T00:00:00Z"),
      info("text-embedding-x", "2026-01-01T00:00:00Z"),
    ];
    expect(unregisteredApiModels(api, REGISTRY_IDS).map((m) => m.id)).toEqual([
      "claude-fable-6",
      "claude-opus-5",
    ]);
  });

  it("snapshot datado de um alias do registry conta como cadastrado (claude-haiku-4-5-20251001)", () => {
    const api = [info("claude-haiku-4-5-20251001", "2025-10-01T00:00:00Z")];
    expect(unregisteredApiModels(api, ["claude-haiku-4-5"])).toEqual([]);
  });

  it("prefixo sem data NÃO conta como cadastrado (claude-sonnet-5-1 ≠ claude-sonnet-5)", () => {
    const api = [
      info("claude-sonnet-5", "2026-04-01T00:00:00Z"),
      info("claude-sonnet-5-1", "2026-11-01T00:00:00Z"),
    ];
    expect(
      unregisteredApiModels(api, ["claude-sonnet-5"]).map((m) => m.id),
    ).toEqual(["claude-sonnet-5-1"]);
  });

  it("corta legados: modelos anteriores ao cadastrado mais antigo listado", () => {
    const api = [
      info("claude-sonnet-4-5-20250929", "2025-09-29T00:00:00Z"),
      info("claude-opus-4-1-20250805", "2025-08-05T00:00:00Z"),
      info("claude-3-haiku-20240307", "2024-03-07T00:00:00Z"),
      info("claude-opus-4-8", "2026-02-01T00:00:00Z"),
    ];
    expect(unregisteredApiModels(api, REGISTRY_IDS).map((m) => m.id)).toEqual([
      "claude-opus-4-8",
    ]);
  });

  it("sem nenhum cadastrado na lista da API não há corte; createdAt inválido não é cortado", () => {
    const api = [
      info("claude-3-haiku-20240307", "2024-03-07T00:00:00Z"),
      info("claude-x", "not-a-date"),
    ];
    expect(unregisteredApiModels(api, REGISTRY_IDS).map((m) => m.id)).toEqual([
      "claude-3-haiku-20240307",
      "claude-x",
    ]);
  });

  it("deduplica e devolve [] com a API vazia", () => {
    const dup = info("claude-fable-6", "2026-10-01T00:00:00Z");
    expect(unregisteredApiModels([dup, dup], REGISTRY_IDS)).toHaveLength(1);
    expect(unregisteredApiModels([], REGISTRY_IDS)).toEqual([]);
  });
});

describe("listApiModels — cache + falha silenciosa", () => {
  let prevKey: string | undefined;
  beforeEach(() => {
    prevKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
    modelsList.mockReset();
    resetApiModelsCacheForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
    vi.restoreAllMocks();
  });

  async function* page(ids: string[]) {
    for (const id of ids) {
      yield {
        id,
        display_name: `Name ${id}`,
        created_at: "2026-09-01T00:00:00Z",
        type: "model",
        capabilities: null,
        max_input_tokens: null,
        max_tokens: null,
      };
    }
  }

  it("mapeia id/display_name/created_at e cacheia (1 chamada pra 2 leituras)", async () => {
    modelsList.mockImplementation(() => page(["claude-a", "claude-b"]));
    const first = await listApiModels();
    const second = await listApiModels();
    expect(first).toEqual([
      {
        id: "claude-a",
        displayName: "Name claude-a",
        createdAt: "2026-09-01T00:00:00Z",
      },
      {
        id: "claude-b",
        displayName: "Name claude-b",
        createdAt: "2026-09-01T00:00:00Z",
      },
    ]);
    expect(second).toBe(first);
    expect(modelsList).toHaveBeenCalledTimes(1);
  });

  it("sem ANTHROPIC_API_KEY → [] sem chamar a API", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await listApiModels()).toEqual([]);
    expect(modelsList).not.toHaveBeenCalled();
  });

  it("erro da API → [] (sem throw), e a falha também é cacheada", async () => {
    modelsList.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(await listApiModels()).toEqual([]);
    expect(await listApiModels()).toEqual([]);
    expect(modelsList).toHaveBeenCalledTimes(1);
  });
});
