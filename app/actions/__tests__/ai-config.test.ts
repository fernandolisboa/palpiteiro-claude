import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Session } from "next-auth";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ai/engine/analysis-engine-flag", () => ({
  resetAnalysisEngineMemo: vi.fn(),
}));
vi.mock("@/lib/ai/model-versions/active", () => ({
  resetActiveModelMemo: vi.fn(),
}));
vi.mock("@/lib/ratings/model-scoreline", () => ({
  resetDixonColesFlagMemo: vi.fn(),
}));
vi.mock("@/lib/ratings/refit-team-ratings", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/ratings/refit-team-ratings")
  >()),
  refitTeamRatings: vi.fn(),
}));
vi.mock("@/lib/db/queries/ai-config", () => ({
  setAdminFlag: vi.fn(),
  setDefaultModelId: vi.fn(),
  setGenerationParams: vi.fn(),
}));

import {
  refitTeamRatingsNow,
  updateAdminFlag,
  updateDefaultModel,
  updateGenerationParams,
} from "@/app/actions/ai-config";
import { auth } from "@/auth";
import { resetAnalysisEngineMemo } from "@/lib/ai/engine/analysis-engine-flag";
import { resetActiveModelMemo } from "@/lib/ai/model-versions/active";
import { resetDixonColesFlagMemo } from "@/lib/ratings/model-scoreline";
import { refitTeamRatings } from "@/lib/ratings/refit-team-ratings";
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
const mockResetDcMemo = vi.mocked(resetDixonColesFlagMemo);
const mockRefit = vi.mocked(refitTeamRatings);
const mockResetActive = vi.mocked(resetActiveModelMemo);

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
  mockResetDcMemo.mockReset();
  mockResetActive.mockReset();
  mockRefit.mockReset();
});

describe("updateDefaultModel", () => {
  it("non-admin caller is rejected and setter is NOT called (gate in the action)", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await updateDefaultModel(
      null,
      form({ modelId: "claude-haiku-5-5" }),
    );
    expect(res.ok).toBe(false);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("admin + userSelectable modelId → setter called with (modelId, userId), returns ok", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateDefaultModel(
      null,
      form({ modelId: "claude-haiku-5-5" }),
    );
    expect(res).toEqual({ ok: true });
    expect(mockSet).toHaveBeenCalledWith("claude-haiku-5-5", "u1");
  });

  it("admin + invalid modelId → not ok, setter not called", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateDefaultModel(null, form({ modelId: "foo" }));
    expect(res.ok).toBe(false);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("admin + Sonnet 5.5 (o DEFAULT_MODEL_ID, ADR 0061) → setter chamado, ok", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateDefaultModel(
      null,
      form({ modelId: "claude-sonnet-5-5" }),
    );
    expect(res).toEqual({ ok: true });
    expect(mockSet).toHaveBeenCalledWith("claude-sonnet-5-5", "u1");
  });

  it("admin + id de versão antiga (aba aberta antes do ADR 0061) → grava o 5.5 da família", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    for (const [modelId, expected] of [
      ["claude-sonnet-4-5-20250929", "claude-sonnet-5-5"],
      ["claude-sonnet-5", "claude-sonnet-5-5"],
      ["claude-haiku-4-5", "claude-haiku-5-5"],
      ["claude-opus-4-8", "claude-opus-5-5"],
      ["claude-fable-5-1", "claude-opus-5-5"],
    ] as const) {
      mockSet.mockClear();
      const res = await updateDefaultModel(null, form({ modelId }));
      expect(res).toEqual({ ok: true });
      expect(mockSet).toHaveBeenCalledWith(expected, "u1");
    }
  });

  it("admin + id desconhecido (gpt-5-mini, lixo) → not ok, setter not called", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    for (const modelId of ["gpt-5-mini", "claude-foo-1", ""]) {
      const res = await updateDefaultModel(null, form({ modelId }));
      expect(res.ok).toBe(false);
    }
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("admin + Opus 5.5 (userSelectable, #524) → ok", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateDefaultModel(
      null,
      form({ modelId: "claude-opus-5-5" }),
    );
    expect(res).toEqual({ ok: true });
    expect(mockSet).toHaveBeenCalledWith("claude-opus-5-5", "u1");
  });
});

describe("updateGenerationParams", () => {
  const valid = { maxTokens: "12000", effort: "medium" };

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
      { maxTokens: 12000, effort: "medium" },
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

  it("admin + effort inválido (ultra) → not ok, setter not called", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateGenerationParams(
      null,
      form({ ...valid, effort: "ultra" }),
    );
    expect(res.ok).toBe(false);
    expect(mockSetParams).not.toHaveBeenCalled();
  });

  it("admin + temperature legada no FormData (aba antiga, ADR 0061) → ignorada; setter só com maxTokens/effort", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateGenerationParams(
      null,
      form({ ...valid, temperature: "2" }),
    );
    expect(res).toEqual({ ok: true });
    expect(mockSetParams).toHaveBeenCalledWith(
      { maxTokens: 12000, effort: "medium" },
      "u1",
    );
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

  it("enableDixonColes zera o memo do flag do DC (ADR 0051), não o do motor", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateAdminFlag(
      null,
      form({ key: "enableDixonColes", value: "false" }),
    );
    expect(res).toEqual({ ok: true });
    expect(mockSetFlag).toHaveBeenCalledWith("enableDixonColes", false, "u1");
    expect(mockResetDcMemo).toHaveBeenCalledTimes(1);
    expect(mockResetMemo).not.toHaveBeenCalled();
    expect(mockResetActive).not.toHaveBeenCalled();
  });

  it("enableAutoModelVersions zera o memo das versões adotadas (ADR 0062)", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    const res = await updateAdminFlag(
      null,
      form({ key: "enableAutoModelVersions", value: "false" }),
    );
    expect(res).toEqual({ ok: true });
    expect(mockSetFlag).toHaveBeenCalledWith("enableAutoModelVersions", false, "u1");
    expect(mockResetActive).toHaveBeenCalledTimes(1);
    expect(mockResetMemo).not.toHaveBeenCalled();
    expect(mockResetDcMemo).not.toHaveBeenCalled();
  });
});

describe("refitTeamRatingsNow (ADR 0051)", () => {
  it("non-admin → acesso negado, refit não roda", async () => {
    mockAuth.mockResolvedValue(USER);
    const res = await refitTeamRatingsNow(null, form({}));
    expect(res).toEqual({ ok: false, error: "Acesso negado." });
    expect(mockRefit).not.toHaveBeenCalled();
  });

  it("separa ajustadas, poucos jogos e falhas", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockRefit.mockResolvedValue([
      {
        league: "brasileirao_a",
        status: "fitted",
        matchCount: 1000,
        teamCount: 28,
        seasons: [2026, 2025, 2024, 2023],
        failedSeasons: [],
      },
      {
        league: "premier_league",
        status: "skipped",
        reason: "too_few_matches",
        matchCount: 40,
        failedSeasons: [],
      },
      {
        league: "la_liga",
        status: "skipped",
        reason: "current_season_failed",
        matchCount: 0,
        failedSeasons: [2026],
      },
      {
        league: "champions_league",
        status: "skipped",
        reason: "partial_fetch_kept_previous",
        matchCount: 300,
        failedSeasons: [2024],
      },
    ]);
    const res = await refitTeamRatingsNow(null, form({}));
    expect(res).toEqual({
      ok: true,
      fitted: 1,
      tooFew: 1,
      failed: ["la_liga", "champions_league"],
    });
  });

  it("refit que lança → erro genérico", async () => {
    mockAuth.mockResolvedValue(ADMIN);
    mockRefit.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await refitTeamRatingsNow(null, form({}));
    expect(res).toEqual({ ok: false, error: "O refit falhou. Veja os logs." });
    spy.mockRestore();
  });
});
