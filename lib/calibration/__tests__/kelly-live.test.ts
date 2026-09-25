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
  resetKellyGateMemo,
} from "@/lib/calibration/kelly-live";

beforeEach(() => {
  vi.clearAllMocks();
  resetKellyGateMemo();
  getEnableKellyStaking.mockResolvedValue(true);
  getAllDashboardRows.mockResolvedValue([]);
  getOverUnderCalibrationRows.mockResolvedValue([]);
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
