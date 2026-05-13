import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  evaluateQuotaLevel,
  extractQuota,
  logCall,
} from "@/lib/providers/http/quota-logger";

function makeHeaders(record: Record<string, string>): Headers {
  return new Headers(record);
}

describe("extractQuota", () => {
  it("reads api-football style headers", () => {
    const headers = makeHeaders({
      "x-ratelimit-requests-remaining": "75",
      "x-ratelimit-requests-limit": "100",
      "X-RateLimit-Remaining": "9",
    });
    const quota = extractQuota(headers, {
      daily: "x-ratelimit-requests-remaining",
      dailyLimit: "x-ratelimit-requests-limit",
      perMinute: "X-RateLimit-Remaining",
    });
    expect(quota.dailyRemaining).toBe(75);
    expect(quota.dailyLimit).toBe(100);
    expect(quota.perMinuteRemaining).toBe(9);
  });

  it("reads odds-api style headers with static monthly limit", () => {
    const headers = makeHeaders({
      "x-requests-remaining": "412",
      "x-requests-used": "88",
    });
    const quota = extractQuota(headers, {
      monthly: "x-requests-remaining",
      monthlyUsed: "x-requests-used",
      monthlyLimit: 500,
    });
    expect(quota.monthlyRemaining).toBe(412);
    expect(quota.monthlyUsed).toBe(88);
    expect(quota.monthlyLimit).toBe(500);
  });

  it("returns null for absent or invalid headers", () => {
    const headers = makeHeaders({ "x-ratelimit-requests-remaining": "abc" });
    const quota = extractQuota(headers, {
      daily: "x-ratelimit-requests-remaining",
      dailyLimit: "x-not-present",
    });
    expect(quota.dailyRemaining).toBeNull();
    expect(quota.dailyLimit).toBeNull();
  });
});

describe("evaluateQuotaLevel", () => {
  it("returns ok when remaining is above WARN threshold", () => {
    expect(
      evaluateQuotaLevel({
        dailyRemaining: 50,
        dailyLimit: 100,
        perMinuteRemaining: null,
        monthlyRemaining: null,
        monthlyUsed: null,
        monthlyLimit: null,
      }),
    ).toBe("ok");
  });

  it("returns warn at < 20% remaining", () => {
    expect(
      evaluateQuotaLevel({
        dailyRemaining: 15,
        dailyLimit: 100,
        perMinuteRemaining: null,
        monthlyRemaining: null,
        monthlyUsed: null,
        monthlyLimit: null,
      }),
    ).toBe("warn");
  });

  it("returns error at < 5% remaining", () => {
    expect(
      evaluateQuotaLevel({
        dailyRemaining: 4,
        dailyLimit: 100,
        perMinuteRemaining: null,
        monthlyRemaining: null,
        monthlyUsed: null,
        monthlyLimit: null,
      }),
    ).toBe("error");
  });

  it("picks the worst (lowest) ratio when multiple are present", () => {
    // monthly 80/500 = 16% → warn; daily 50/100 = 50% → ok. Worst wins.
    expect(
      evaluateQuotaLevel({
        dailyRemaining: 50,
        dailyLimit: 100,
        perMinuteRemaining: null,
        monthlyRemaining: 80,
        monthlyUsed: 420,
        monthlyLimit: 500,
      }),
    ).toBe("warn");
  });

  it("returns ok when limit is unknown (no thresholds to compare)", () => {
    expect(
      evaluateQuotaLevel({
        dailyRemaining: 1,
        dailyLimit: null,
        perMinuteRemaining: null,
        monthlyRemaining: null,
        monthlyUsed: null,
        monthlyLimit: null,
      }),
    ).toBe("ok");
  });
});

describe("logCall", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("emits a JSON log line at info level when quota is healthy", () => {
    logCall({
      provider: "api-football",
      endpoint: "/fixtures",
      cache_hit: false,
      latency_ms: 42,
      status_code: 200,
      attempt: 1,
      quota: {
        dailyRemaining: 80,
        dailyLimit: 100,
        perMinuteRemaining: 9,
        monthlyRemaining: null,
        monthlyUsed: null,
        monthlyLimit: null,
      },
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(payload.provider).toBe("api-football");
    expect(payload.quota_daily_remaining).toBe(80);
    expect(payload.level).toBe("ok");
  });

  it("uses console.warn on low quota", () => {
    logCall({
      provider: "api-football",
      endpoint: "/fixtures",
      cache_hit: false,
      latency_ms: 42,
      status_code: 200,
      attempt: 1,
      quota: {
        dailyRemaining: 15,
        dailyLimit: 100,
        perMinuteRemaining: null,
        monthlyRemaining: null,
        monthlyUsed: null,
        monthlyLimit: null,
      },
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(payload.level).toBe("warn");
  });

  it("uses console.error on critical quota", () => {
    logCall({
      provider: "odds-api",
      endpoint: "/sports",
      cache_hit: false,
      latency_ms: 42,
      status_code: 200,
      attempt: 1,
      quota: {
        dailyRemaining: null,
        dailyLimit: null,
        perMinuteRemaining: null,
        monthlyRemaining: 10,
        monthlyUsed: 490,
        monthlyLimit: 500,
      },
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(payload.level).toBe("error");
  });

  it("omits quota fields on cache hits", () => {
    logCall({
      provider: "api-football",
      endpoint: "/fixtures",
      cache_hit: true,
      latency_ms: 1,
      status_code: null,
      attempt: 0,
      quota: {
        dailyRemaining: 4,
        dailyLimit: 100,
        perMinuteRemaining: null,
        monthlyRemaining: null,
        monthlyUsed: null,
        monthlyLimit: null,
      },
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(payload.cache_hit).toBe(true);
    expect(payload.quota_daily_remaining).toBeUndefined();
    expect(payload.level).toBe("ok");
  });
});
