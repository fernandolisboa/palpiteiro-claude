import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CostSummary } from "@/lib/db/queries/ai-costs";

// Mock da fonte de gasto. getCostSummary é a única porta pro DB aqui.
vi.mock("@/lib/db/queries/ai-costs", () => ({
  getCostSummary: vi.fn(),
}));

// Resend: a named export `Resend` cuja instância expõe `emails.send`. Hoist do
// send mock pra que a factory possa referenciá-lo.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
    constructor(_key?: unknown) {
      void _key;
    }
  },
}));

// Upstash: construtor como classe real (sobrevive ao vi.resetModules()), com
// get/set mockados e hoisted.
const { getMock, setMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  setMock: vi.fn(),
}));
vi.mock("@upstash/redis", () => ({
  Redis: class {
    __cfg: unknown;
    constructor(cfg: unknown) {
      this.__cfg = cfg;
    }
    get = getMock;
    set = setMock;
  },
}));

import { getCostSummary } from "@/lib/db/queries/ai-costs";

const costMock = vi.mocked(getCostSummary);

function summary(todayUsd: number): CostSummary {
  return { totalUsd: todayUsd, todayUsd, last7dUsd: todayUsd, totalCalls: 1 };
}

// O guard de warn-once é module-scoped; re-importar fresco (resetModules) zera-o.
async function load() {
  const mod = await import("@/lib/notifications/spend-alert");
  return mod.runSpendAlert;
}

const NOW = new Date("2026-06-08T23:00:00Z");
const EXPECTED_KEY = "spend-alert:sent:2026-06-08";

beforeEach(() => {
  vi.resetModules();
  costMock.mockReset();
  sendMock.mockReset();
  getMock.mockReset();
  setMock.mockReset();
  vi.stubEnv("DAILY_AI_SPEND_ALERT_USD", "10");
  vi.stubEnv("SPEND_ALERT_EMAIL", "alert@example.com");
  vi.stubEnv("AUTH_RESEND_KEY", "re_test");
  vi.stubEnv("RESEND_FROM_EMAIL", "from@example.com");
  vi.stubEnv("KV_REST_API_URL", "https://kv.example");
  vi.stubEnv("KV_REST_API_TOKEN", "tok");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runSpendAlert", () => {
  it("skips (no_threshold) when threshold unset, touching no DB/KV/Resend", async () => {
    vi.stubEnv("DAILY_AI_SPEND_ALERT_USD", "");
    const run = await load();
    const res = await run(NOW);
    expect(res).toEqual({ skipped: "no_threshold" });
    expect(sendMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
    expect(costMock).not.toHaveBeenCalled();
  });

  it("skips (no_threshold) for NaN/zero/negative thresholds", async () => {
    for (const bad of ["not-a-number", "0", "-5"]) {
      vi.resetModules();
      costMock.mockReset();
      sendMock.mockReset();
      vi.stubEnv("DAILY_AI_SPEND_ALERT_USD", bad);
      const run = await load();
      const res = await run(NOW);
      expect(res).toEqual({ skipped: "no_threshold" });
      expect(sendMock).not.toHaveBeenCalled();
      expect(costMock).not.toHaveBeenCalled();
    }
  });

  it("sends once and marks the day when over threshold and not yet sent", async () => {
    costMock.mockResolvedValue(summary(25));
    getMock.mockResolvedValue(null);
    sendMock.mockResolvedValue({ data: { id: "msg_1" }, error: null });
    const run = await load();
    const res = await run(NOW);

    expect(res).toEqual({ sent: true, spendUsd: 25, thresholdUsd: 10 });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0] as {
      to: string;
      from: string;
      subject: string;
      text: string;
    };
    expect(arg.to).toBe("alert@example.com");
    expect(arg.from).toBe("from@example.com");
    expect(arg.text).toContain("$25.00");
    expect(arg.text).toContain("$10.00");
    expect(arg.subject).toContain("$25.00");
    expect(setMock).toHaveBeenCalledWith(EXPECTED_KEY, "1", {
      ex: 60 * 60 * 48,
    });
  });

  it("skips (already_sent) when the KV day key is set, without sending", async () => {
    costMock.mockResolvedValue(summary(25));
    getMock.mockResolvedValue("1");
    const run = await load();
    const res = await run(NOW);

    expect(res).toEqual({
      skipped: "already_sent",
      spendUsd: 25,
      thresholdUsd: 10,
    });
    expect(getMock).toHaveBeenCalledWith(EXPECTED_KEY);
    expect(sendMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it("skips (under_threshold) without querying KV when spend is below threshold", async () => {
    costMock.mockResolvedValue(summary(5));
    const run = await load();
    const res = await run(NOW);

    expect(res).toEqual({
      skipped: "under_threshold",
      spendUsd: 5,
      thresholdUsd: 10,
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
  });

  it("treats spend == threshold as under_threshold (boundary, <=)", async () => {
    costMock.mockResolvedValue(summary(10));
    const run = await load();
    const res = await run(NOW);

    expect(res).toEqual({
      skipped: "under_threshold",
      spendUsd: 10,
      thresholdUsd: 10,
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("fails open (still sends) and warns once when KV env is unset", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    costMock.mockResolvedValue(summary(25));
    sendMock.mockResolvedValue({ data: { id: "msg_1" }, error: null });
    const run = await load();

    const res1 = await run(NOW);
    const res2 = await run(NOW);

    expect(res1).toEqual({ sent: true, spendUsd: 25, thresholdUsd: 10 });
    expect(res2).toEqual({ sent: true, spendUsd: 25, thresholdUsd: 10 });
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(getMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
    // warn-once: módulo importado uma vez, então só o primeiro run avisa.
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("skips (no_recipient) before touching KV when SPEND_ALERT_EMAIL is unset", async () => {
    vi.stubEnv("SPEND_ALERT_EMAIL", "");
    costMock.mockResolvedValue(summary(25));
    const run = await load();
    const res = await run(NOW);

    expect(res).toEqual({ skipped: "no_recipient" });
    expect(sendMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
  });

  it("propagates a send failure and does NOT mark the day as sent", async () => {
    costMock.mockResolvedValue(summary(25));
    getMock.mockResolvedValue(null);
    sendMock.mockRejectedValue(new Error("resend boom"));
    const run = await load();

    await expect(run(NOW)).rejects.toThrow("resend boom");
    expect(setMock).not.toHaveBeenCalled();
  });

  it("treats a resolved { data: null, error } as failure and does NOT mark the day as sent", async () => {
    costMock.mockResolvedValue(summary(25));
    getMock.mockResolvedValue(null);
    // Resend devolve erros de API como valor RESOLVIDO, não como rejeição.
    sendMock.mockResolvedValue({
      data: null,
      error: { name: "application_error", message: "domain not verified" },
    });
    const run = await load();

    await expect(run(NOW)).rejects.toThrow("domain not verified");
    expect(setMock).not.toHaveBeenCalled();
  });
});
