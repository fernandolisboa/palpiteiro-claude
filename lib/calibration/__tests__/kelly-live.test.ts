import { beforeEach, describe, expect, it, vi } from "vitest";

const getEnableKellyStaking = vi.fn();
vi.mock("@/lib/db/queries/ai-config", () => ({
  getEnableKellyStaking: () => getEnableKellyStaking(),
}));
const getAllDashboardRows = vi.fn();
vi.mock("@/lib/db/queries/dashboard", () => ({
  getAllDashboardRows: () => getAllDashboardRows(),
}));
const getOverUnderCalibrationRows = vi.fn();
vi.mock("@/lib/db/queries/calibration", () => ({
  getOverUnderCalibrationRows: () => getOverUnderCalibrationRows(),
}));
vi.mock("@/lib/dashboard/clv-enrich", () => ({
  enrichDashboardRowsWithClosing: async (rows: unknown[]) => rows,
}));

import {
  isKellyStakingActive,
  loadKellyGate,
  resetKellyGateMemo,
} from "@/lib/calibration/kelly-live";
import { logLoss } from "@/lib/calibration/metrics";

beforeEach(() => {
  vi.clearAllMocks();
  resetKellyGateMemo();
  getEnableKellyStaking.mockResolvedValue(true);
  getAllDashboardRows.mockResolvedValue([]);
  getOverUnderCalibrationRows.mockResolvedValue([]);
});

describe("loadKellyGate", () => {
  // O /admin/calibration segmenta por motor (#513), mas o gate que alimenta o staking
  // segue sobre TODAS as análises — nenhum recorte por motor antes do evaluate.
  it("o skill do gate usa as rows de todos os motores", async () => {
    const llm = {
      promptVersion: "over_under_v3.2",
      modelPOver: 0.7,
      marketPOver: 0.5,
      overHappened: 1 as const,
      isBet: true,
      engine: "llm" as const,
      engineConfig: null,
    };
    const jev = {
      ...llm,
      promptVersion: "narrator_v1",
      modelPOver: 0.3,
      engine: "code_jev" as const,
      engineConfig: "lambda=heuristic",
    };
    getOverUnderCalibrationRows.mockResolvedValue([llm, jev]);
    const gate = await loadKellyGate();
    const skill = (p: number) =>
      logLoss([{ p: 0.5, y: 1 }]) - logLoss([{ p, y: 1 }]);
    expect(gate.skillMean).toBeCloseTo((skill(0.7) + skill(0.3)) / 2, 12);
  });
});

describe("isKellyStakingActive", () => {
  it("sem dado → gate fechado → false", async () => {
    expect(await isKellyStakingActive(0)).toBe(false);
  });

  it("kill-switch OFF → false sem ler o gate", async () => {
    getEnableKellyStaking.mockResolvedValue(false);
    expect(await isKellyStakingActive(0)).toBe(false);
    expect(getAllDashboardRows).not.toHaveBeenCalled();
  });

  it("erro de leitura → fail-closed (false), sem lançar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getAllDashboardRows.mockRejectedValue(new Error("db down"));
    expect(await isKellyStakingActive(0)).toBe(false);
  });

  it("memo de 1h por instância", async () => {
    await isKellyStakingActive(0);
    await isKellyStakingActive(59 * 60 * 1000);
    expect(getEnableKellyStaking).toHaveBeenCalledTimes(1);
    await isKellyStakingActive(61 * 60 * 1000);
    expect(getEnableKellyStaking).toHaveBeenCalledTimes(2);
  });
});
