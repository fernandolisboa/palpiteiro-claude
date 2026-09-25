import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Session } from "next-auth";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ai/engine/analysis-engine-flag", () => ({
  resetAnalysisEngineMemo: vi.fn(),
}));
vi.mock("@/lib/db/queries/ai-config", () => ({
  setAdminFlag: vi.fn(),
  setDefaultModelId: vi.fn(),
  setGenerationParams: vi.fn(),
}));

import {
  updateAdminFlag,
  updateDefaultModel,
  updateGenerationParams,
} from "@/app/actions/ai-config";
import { auth } from "@/auth";
import { resetAnalysisEngineMemo } from "@/lib/ai/engine/analysis-engine-flag";
import {
  setAdminFlag,
  setDefaultModelId,
  setGenerationParams,
} from "@/lib/db/queries/ai-config";

const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const mockSet = vi.mocked(setDefaultModelId);
const mockSetParams = vi.mocked(setGenerationParams);
const mockSetFlag = vi.mocked(setAdminFlag);
const mockResetMemo = vi.mocked(resetAnalysisEngineMemo);

const ADMIN = {
  user: { id: "u1", email: "a@b.com", role: "admin" },
  expires: "2099-01-01",
} as unknown as Session;

const USER = {
  user: { id: "u2", email: "c@d.com", role: "user" },
  expires: "2099-01-01",
} as unknown as Session;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  mockAuth.mockReset();
  mockSet.mockReset();
  mockSetParams.mockReset();
  mockSetFlag.mockReset();
  mockResetMemo.mockReset();
});

describe("updateDefaultModel", () => {
  it("non-admin caller is rejected and setter is NOT called (gate in the action)", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updateDefaultModel(
      null,
      form({ modelId: "claude-haiku-4-5" }),
    );
    expect(res.ok).toBe(false);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("admin + userSelectable modelId → setter called with (modelId, userId), returns ok", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateDefaultModel(
      null,
      form({ modelId: "claude-haiku-4-5" }),
    );
    expect(res).toEqual({ ok: true });
    expect(mockSet).toHaveBeenCalledWith("claude-haiku-4-5", "u1");
  });

  it("admin + invalid modelId → not ok, setter not called", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateDefaultModel(null, form({ modelId: "foo" }));
    expect(res.ok).toBe(false);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("admin + Sonnet 4.5 (promovido a userSelectable em #240) → setter chamado, ok", async () => {
    // Antes admin-only; após #240 ambos os Sonnets podem ser padrão global. Este
    // é o caso de aceite central da issue #240.
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateDefaultModel(
      null,
      form({ modelId: "claude-sonnet-4-5-20250929" }),
    );
    expect(res).toEqual({ ok: true });
    expect(mockSet).toHaveBeenCalledWith("claude-sonnet-4-5-20250929", "u1");
  });

  it("admin + id removido em #374 (Opus 4.8 / Sonnet 4.6 / gpt-5-mini) → not ok, setter not called", async () => {
    // Após #374 esses ids saíram do registry: isModelAllowedForAudience os trata
    // como desconhecidos, então não são mais salváveis como default global. Guarda
    // de remoção complementar à do Fable (#241) logo abaixo.
    mockAuth.mockResolvedValue(ADMIN);
    for (const modelId of [
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "gpt-5-mini",
    ]) {
      const res = await updateDefaultModel(null, form({ modelId }));
      expect(res.ok).toBe(false);
    }
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("admin + id stale/removido (Fable, fora do registry após #241) → not ok, setter not called", async () => {
    // Um id de modelo aposentado (Fable removido em #241) deixa de ser salvável:
    // isModelAllowedForAudience o trata como desconhecido. Cobre a queda graciosa
    // sem mudança de runtime.
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateDefaultModel(
      null,
      form({ modelId: "claude-fable-5" }),
    );
    expect(res.ok).toBe(false);
    expect(mockSet).not.toHaveBeenCalled();
  });
});

describe("updateGenerationParams", () => {
  const valid = { maxTokens: "12000", effort: "medium", temperature: "0.4" };

  it("non-admin caller is rejected and setter is NOT called", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updateGenerationParams(null, form(valid));
    expect(res.ok).toBe(false);
    expect(mockSetParams).not.toHaveBeenCalled();
  });

  it("admin + valid → setter called with parsed (params, userId), returns ok", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateGenerationParams(null, form(valid));
    expect(res).toEqual({ ok: true });
    expect(mockSetParams).toHaveBeenCalledWith(
      { maxTokens: 12000, effort: "medium", temperature: 0.4 },
      "u1",
    );
  });

  it("admin + maxTokens fora do range → not ok, setter not called", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateGenerationParams(
      null,
      form({ ...valid, maxTokens: "999999" }),
    );
    expect(res.ok).toBe(false);
    expect(mockSetParams).not.toHaveBeenCalled();
  });

  it("admin + effort inválido (xhigh) → not ok, setter not called", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateGenerationParams(
      null,
      form({ ...valid, effort: "xhigh" }),
    );
    expect(res.ok).toBe(false);
    expect(mockSetParams).not.toHaveBeenCalled();
  });

  it("admin + temperature fora de [0,1] → not ok, setter not called", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateGenerationParams(
      null,
      form({ ...valid, temperature: "2" }),
    );
    expect(res.ok).toBe(false);
    expect(mockSetParams).not.toHaveBeenCalled();
  });
});

describe("updateAdminFlag (#514) — analysisEngine (#511)", () => {
  it("não-admin é rejeitado e o setter não é chamado", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updateAdminFlag(
      null,
      form({ key: "analysisEngine", value: "code_jev" }),
    );
    expect(res.ok).toBe(false);
    expect(mockSetFlag).not.toHaveBeenCalled();
  });

  it("admin + motor válido → setter chamado e memo do motor zerado", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateAdminFlag(
      null,
      form({ key: "analysisEngine", value: "code_jev" }),
    );
    expect(res).toEqual({ ok: true });
    expect(mockSetFlag).toHaveBeenCalledWith("analysisEngine", "code_jev", "u1");
    expect(mockResetMemo).toHaveBeenCalledTimes(1);
  });

  it("admin + motor inválido → erro, setter não chamado", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateAdminFlag(
      null,
      form({ key: "analysisEngine", value: "jev_direto" }),
    );
    expect(res.ok).toBe(false);
    expect(mockSetFlag).not.toHaveBeenCalled();
    expect(mockResetMemo).not.toHaveBeenCalled();
  });

  it("flag boolean não mexe no memo do motor", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateAdminFlag(
      null,
      form({ key: "enableClvCapture", value: "true" }),
    );
    expect(res).toEqual({ ok: true });
    expect(mockSetFlag).toHaveBeenCalledWith("enableClvCapture", true, "u1");
    expect(mockResetMemo).not.toHaveBeenCalled();
  });
});
