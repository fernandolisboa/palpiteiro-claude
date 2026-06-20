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
vi.mock("@/lib/db/queries/palpite-outcomes", () => ({
  upsertPalpiteOutcomeOverride: vi.fn(),
}));

import {
  overridePalpiteOutcome,
  overridePredictionOutcome,
} from "@/app/actions/settlement";
import { auth } from "@/auth";
import { upsertPalpiteOutcomeOverride } from "@/lib/db/queries/palpite-outcomes";
import { getPredictionForOverride } from "@/lib/db/queries/predictions";
import { upsertOutcomeOverride } from "@/lib/db/queries/prediction-outcomes";

// `auth` é um tipo sobrecarregado (também serve de middleware); estreitamos pro
// uso como `auth()` -> Promise<Session | null> pra tipar o mock.
const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const getRow = vi.mocked(getPredictionForOverride);
const upsert = vi.mocked(upsertOutcomeOverride);
const upsertPalpite = vi.mocked(upsertPalpiteOutcomeOverride);

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
  upsertPalpite.mockReset();
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
    // Pin the guard's nature: it's a POST-fetch business rule (the odd is read
    // from the row), not an early input reject — so getRow ran, but no DB write.
    expect(getRow).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("overridePalpiteOutcome", () => {
  it("rejects when there is no session (unauthenticated)", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await overridePalpiteOutcome(
      null,
      form({ palpiteId: "pal1", result: "won" }),
    );
    expect(res).toMatchObject({ ok: false });
    expect(upsertPalpite).not.toHaveBeenCalled();
  });

  it("rejects a non-admin session", async () => {
    mockAuth.mockResolvedValue(session("user"));
    const res = await overridePalpiteOutcome(
      null,
      form({ palpiteId: "pal1", result: "won" }),
    );
    expect(res).toMatchObject({ ok: false });
    expect(upsertPalpite).not.toHaveBeenCalled();
  });

  it("rejects an absent palpiteId before any DB write", async () => {
    const res = await overridePalpiteOutcome(null, form({ result: "won" }));
    expect(res).toMatchObject({ ok: false });
    expect(upsertPalpite).not.toHaveBeenCalled();
  });

  it("rejects void/push (palpite has no stake) — só won/lost", async () => {
    const resVoid = await overridePalpiteOutcome(
      null,
      form({ palpiteId: "pal1", result: "void" }),
    );
    expect(resVoid).toMatchObject({ ok: false });
    const resPush = await overridePalpiteOutcome(
      null,
      form({ palpiteId: "pal1", result: "push" }),
    );
    expect(resPush).toMatchObject({ ok: false });
    expect(upsertPalpite).not.toHaveBeenCalled();
  });

  it("override puro (sem yellowCardsTotal) → resultData null, trust-the-admin", async () => {
    const res = await overridePalpiteOutcome(
      null,
      form({ palpiteId: "pal1", result: "won" }),
    );
    expect(res).toEqual({ ok: true });
    expect(upsertPalpite).toHaveBeenCalledWith({
      palpiteId: "pal1",
      result: "won",
      resultData: null,
      overrideByUserId: "u-admin",
    });
  });

  it("yellowCardsTotal válido → grava o fato no resultData", async () => {
    const res = await overridePalpiteOutcome(
      null,
      form({ palpiteId: "pal1", result: "won", yellowCardsTotal: "7" }),
    );
    expect(res).toEqual({ ok: true });
    expect(upsertPalpite).toHaveBeenCalledWith(
      expect.objectContaining({
        palpiteId: "pal1",
        result: "won",
        resultData: {
          homeScore: null,
          awayScore: null,
          totalGoals: 0,
          yellowCardsTotal: 7,
        },
      }),
    );
  });

  it("yellowCardsTotal não-inteiro/negativo → rejeita antes de escrever", async () => {
    const resNeg = await overridePalpiteOutcome(
      null,
      form({ palpiteId: "pal1", result: "won", yellowCardsTotal: "-2" }),
    );
    expect(resNeg).toMatchObject({ ok: false });
    const resFloat = await overridePalpiteOutcome(
      null,
      form({ palpiteId: "pal1", result: "lost", yellowCardsTotal: "3.5" }),
    );
    expect(resFloat).toMatchObject({ ok: false });
    expect(upsertPalpite).not.toHaveBeenCalled();
  });
});
