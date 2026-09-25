import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A listagem real chama a API; aqui só o que ela devolve importa. O diff
// (unregisteredApiModels) roda de verdade.
vi.mock("@/lib/ai/providers/anthropic/models-catalog", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/ai/providers/anthropic/models-catalog")
    >();
  return { ...actual, listApiModels: vi.fn() };
});

import { UnregisteredModelsNote } from "@/app/admin/settings/unregistered-models-note";
import { listApiModels } from "@/lib/ai/providers/anthropic/models-catalog";

const mockList = vi.mocked(listApiModels);

beforeEach(() => {
  mockList.mockReset();
});

describe("UnregisteredModelsNote (#524)", () => {
  it("lista os ids da API fora do registry", async () => {
    mockList.mockResolvedValue([
      {
        id: "claude-fable-6",
        displayName: "Claude Fable 6",
        createdAt: "2026-10-01T00:00:00Z",
      },
      {
        id: "claude-opus-5-5",
        displayName: "Claude Opus 5.5",
        createdAt: "2026-09-01T00:00:00Z",
      },
    ]);
    const html = renderToStaticMarkup(await UnregisteredModelsNote());
    expect(html).toContain("claude-fable-6 · Claude Fable 6");
    expect(html).not.toContain("claude-opus-5-5");
  });

  it("nada novo (ou listagem falhou → []) → não renderiza nada", async () => {
    mockList.mockResolvedValue([]);
    expect(await UnregisteredModelsNote()).toBeNull();
  });
});
