import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { classifyAnthropicError, serializeAnthropicError } from "../errors";

// Cobre o mapeamento de erro do adapter Anthropic em ISOLAMENTO: sem client real,
// sem ANTHROPIC_API_KEY, sem chamada paga (regra dura do CLAUDE.md). Espelha o que
// classify/serialize faziam inline em predict.ts pré-#230 — agora atrás do seam.
// Asserções exatas só onde o SDK NÃO transforma a string (Error comum / não-Error);
// pros tipos de SDK (que reescrevem `message` via makeMessage) checamos o STATUS
// mapeado + a extração de header, que é a lógica que de fato vive aqui.
describe("anthropic adapter — classifyAnthropicError", () => {
  it("APIConnectionTimeoutError → timeout", () => {
    const err = new Anthropic.APIConnectionTimeoutError({
      message: "timed out",
    });
    const out = classifyAnthropicError(err);
    expect(out.status).toBe("timeout");
    expect(typeof out.message).toBe("string");
  });

  it("RateLimitError → rate_limited (anexa retry-after do header)", () => {
    const err = new Anthropic.RateLimitError(
      429,
      undefined,
      "slow down",
      new Headers({ "retry-after": "30" }),
    );
    const out = classifyAnthropicError(err);
    expect(out.status).toBe("rate_limited");
    expect(out.message).toContain("retry-after=30");
  });

  it("APIError → provider_error (anexa status + request-id do header)", () => {
    const err = new Anthropic.APIError(
      500,
      undefined,
      "internal server error",
      new Headers({ "request-id": "req_123" }),
    );
    const out = classifyAnthropicError(err);
    expect(out.status).toBe("provider_error");
    expect(out.message).toContain("request-id=req_123");
  });

  it("Error comum → provider_error com a própria mensagem", () => {
    expect(classifyAnthropicError(new Error("boom"))).toEqual({
      status: "provider_error",
      message: "boom",
    });
  });

  it("valor não-Error → provider_error com String(err)", () => {
    expect(classifyAnthropicError("kaput")).toEqual({
      status: "provider_error",
      message: "kaput",
    });
  });
});

describe("anthropic adapter — serializeAnthropicError", () => {
  it("APIError → {name, message, status, requestId}", () => {
    const err = new Anthropic.APIError(
      503,
      undefined,
      "unavailable",
      new Headers({ "request-id": "req_xyz" }),
    );
    const out = serializeAnthropicError(err);
    expect(out.status).toBe(503);
    expect(out.requestId).toBe("req_xyz");
    expect(typeof out.name).toBe("string");
    expect(typeof out.message).toBe("string");
  });

  it("Error comum → {name, message}", () => {
    expect(serializeAnthropicError(new Error("oops"))).toEqual({
      name: "Error",
      message: "oops",
    });
  });

  it("valor não-Error → {error: String(err)}", () => {
    expect(serializeAnthropicError(42)).toEqual({ error: "42" });
  });
});
