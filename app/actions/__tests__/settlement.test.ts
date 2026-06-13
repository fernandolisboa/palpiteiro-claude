import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Session } from "next-auth";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/queries/predictions", () => ({
  getPredictionForOverride: vi.fn(),
}));
vi.mock("@/lib/db/queries/prediction-outcomes", () => ({
  upsertOutcomeOverride: vi.fn(),
}));

import { overridePredictionOutcome } from "@/app/actions/settlement";
import { auth } from "@/auth";
import { getPredictionForOverride } from "@/lib/db/queries/predictions";
import { upsertOutcomeOverride } from "@/lib/db/queries/prediction-outcomes";

// `auth` é um tipo sobrecarregado (também serve de middleware); estreitamos pro
// uso como `auth()` -> Promise<Session | null> pra tipar o mock.
const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const getRow = vi.mocked(getPredictionForOverride);
const upsert = vi.mocked(upsertOutcomeOverride);

const session = (role: "admin" | "user"): Session =>
  ({ user: { id: `u-${role}`, role }, expires: "" }) as unknown as Session;
const adminSession = session("admin");

function row(oddAtRecommendation: string | null, stakeUnits = "1") {
  return {
    prediction: { oddAtRecommendation, stakeUnits },
    match: {},
    outcome: null,
  } as unknown as Awaited<ReturnType<typeof getPredictionForOverride>>;
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  getRow.mockReset();
  upsert.mockReset();
  mockAuth.mockReset();
  // Default: authenticated admin. Individual tests override for auth cases.
  mockAuth.mockResolvedValue(adminSession);
});

describe("overridePredictionOutcome", () => {
  it("rejects when there is no session (unauthenticated)", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await overridePredictionOutcome(
      null,
      form({ predictionId: "p1", result: "won", homeScore: "2", awayScore: "1" }),
    );
    expect(res).toMatchObject({ ok: false });
    expect(getRow).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects a non-admin session", async () => {
    mockAuth.mockResolvedValue(session("user"));
    const res = await overridePredictionOutcome(
      null,
      form({ predictionId: "p1", result: "won", homeScore: "2", awayScore: "1" }),
    );
    expect(res).toMatchObject({ ok: false });
    expect(getRow).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects an absent score before any DB write (no fabricated 0-0)", async () => {
    const res = await overridePredictionOutcome(
      null,
      form({ predictionId: "p1", result: "won" }), // no scores
    );
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/ausente/i) });
    expect(getRow).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects an invalid result", async () => {
    const res = await overridePredictionOutcome(
      null,
      form({ predictionId: "p1", result: "draw", homeScore: "1", awayScore: "1" }),
    );
    expect(res).toMatchObject({ ok: false });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses to mark won when the prediction has no entry odd", async () => {
    getRow.mockResolvedValue(row(null));
    const res = await overridePredictionOutcome(
      null,
      form({ predictionId: "p1", result: "won", homeScore: "2", awayScore: "1" }),
    );
    expect(res).toMatchObject({ ok: false });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("voids with zero profit and full resultData from the entered score", async () => {
    getRow.mockResolvedValue(row(null));
    const res = await overridePredictionOutcome(
      null,
      form({ predictionId: "p1", result: "void", homeScore: "1", awayScore: "1" }),
    );
    expect(res).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "void",
        profitUnits: 0,
        totalGoals: 2,
        resultData: { homeScore: 1, awayScore: 1, totalGoals: 2 },
      }),
    );
  });

  it("recomputes profit for a won override and passes full resultData", async () => {
    getRow.mockResolvedValue(row("1.900"));
    const res = await overridePredictionOutcome(
      null,
      form({ predictionId: "p1", result: "won", homeScore: "2", awayScore: "1" }),
    );
    expect(res).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "won",
        profitUnits: 0.9,
        totalGoals: 3,
        resultData: { homeScore: 2, awayScore: 1, totalGoals: 3 },
      }),
    );
  });

  it("settles a push override (with entry odd) as profit 0, full resultData", async () => {
    getRow.mockResolvedValue(row("2.000"));
    const res = await overridePredictionOutcome(
      null,
      form({ predictionId: "p1", result: "push", homeScore: "1", awayScore: "1" }),
    );
    expect(res).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "push",
        profitUnits: 0,
        totalGoals: 2,
        resultData: { homeScore: 1, awayScore: 1, totalGoals: 2 },
      }),
    );
  });

  it("refuses a push override when the prediction has no entry odd (sem odd → só void)", async () => {
    // profitForResult("push", null, …) returns 0 (not null), so it's the explicit
    // odd===null guard — not the null-check — that must reject this. getRow IS
    // called (the odd is read from the row); the guard then blocks the DB write.
    getRow.mockResolvedValue(row(null));
    const res = await overridePredictionOutcome(
      null,
      form({ predictionId: "p1", result: "push", homeScore: "1", awayScore: "1" }),
    );
    expect(res).toMatchObject({ ok: false });
    expect(upsert).not.toHaveBeenCalled();
  });
});
