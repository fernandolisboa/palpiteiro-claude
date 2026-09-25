import { describe, expect, it } from "vitest";

import {
  adaptiveTimeoutMs,
  CLIENT_MAX_RETRIES,
  CLIENT_TIMEOUT_MS,
  requestTiming,
} from "../timeouts";

describe("adaptiveTimeoutMs (#524 review)", () => {
  it("escala com max_tokens e effort", () => {
    // 15s + (16000 × share) / 60 tok/s
    expect(adaptiveTimeoutMs(16000, "low")).toBe(81_667);
    expect(adaptiveTimeoutMs(16000, "medium")).toBe(148_333);
    expect(adaptiveTimeoutMs(16000, "high")).toBe(215_000);
    expect(adaptiveTimeoutMs(16000, "xhigh")).toBe(281_667);
    expect(adaptiveTimeoutMs(16000, "max")).toBe(281_667);
  });

  it("effort ausente conta como high", () => {
    expect(adaptiveTimeoutMs(16000, undefined)).toBe(
      adaptiveTimeoutMs(16000, "high"),
    );
  });

  it("piso de 60s e teto de 600s", () => {
    expect(adaptiveTimeoutMs(1000, "low")).toBe(60_000);
    expect(adaptiveTimeoutMs(128_000, "max")).toBe(600_000);
  });
});

describe("requestTiming", () => {
  const now = 1_000_000;

  it("sem prazo: adaptive leva o timeout escalado + retries do client", () => {
    expect(
      requestTiming({
        thinkingMode: "adaptive",
        maxTokens: 16000,
        effort: "high",
      }),
    ).toEqual({
      kind: "options",
      options: { timeout: 215_000, maxRetries: CLIENT_MAX_RETRIES },
    });
  });

  it("sem prazo: temperature usa as opções do client", () => {
    expect(
      requestTiming({ thinkingMode: "temperature", maxTokens: 16000 }),
    ).toEqual({ kind: "client-default" });
  });

  it("com prazo: só os retries que cabem inteiros no restante", () => {
    const at = (deadlineMs: number) =>
      requestTiming({
        thinkingMode: "temperature",
        maxTokens: 16000,
        deadlineAt: now + deadlineMs,
        now,
      });
    // 245s disponíveis (250 − 5 de margem): 3 × 60 + 2 × 8 = 196 cabe → teto de 2 retries.
    expect(at(250_000)).toEqual({
      kind: "options",
      options: { timeout: CLIENT_TIMEOUT_MS, maxRetries: 2 },
    });
    // 135s: 2 × 60 + 8 = 128 cabe → 1 retry.
    expect(at(140_000)).toEqual({
      kind: "options",
      options: { timeout: 60_000, maxRetries: 1 },
    });
    // 125s: 2 × 60 cabia, mas com o backoff (128s) não → sem retry.
    expect(at(130_000)).toEqual({
      kind: "options",
      options: { timeout: 60_000, maxRetries: 0 },
    });
  });

  it("prazo apertado: timeout = restante − margem, sem retry", () => {
    expect(
      requestTiming({
        thinkingMode: "adaptive",
        maxTokens: 16000,
        effort: "high",
        deadlineAt: now + 100_000,
        now,
      }),
    ).toEqual({ kind: "options", options: { timeout: 95_000, maxRetries: 0 } });
  });

  it("prazo menor que a margem: no-budget (não chama)", () => {
    expect(
      requestTiming({
        thinkingMode: "temperature",
        maxTokens: 16000,
        deadlineAt: now + 5_000,
        now,
      }),
    ).toEqual({ kind: "no-budget" });
  });
});
