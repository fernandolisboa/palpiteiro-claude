import { afterEach, describe, expect, it, vi } from "vitest";

// Logging extraído de predict.ts (#315): garante que o SWALLOW foi preservado pelo
// refactor — uma falha do insert de auditoria NUNCA re-throwa (não mascara o erro
// primário); só loga em console.error. Mockamos `@/lib/db` (insert que rejeita) e
// asseramos: nada lançado + console.error chamado.

const insert = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    insert: (...args: unknown[]) => insert(...args),
  },
}));

import {
  persistAiCallError,
  persistJudgmentAiCall,
  truncate,
} from "@/lib/ai/ai-call-logging";
import { MODEL_REGISTRY } from "@/lib/ai/models";

afterEach(() => {
  vi.restoreAllMocks();
  insert.mockReset();
});

const baseArgs = {
  provider: "anthropic" as const,
  userId: "u-1",
  matchId: "m-1",
  model: MODEL_REGISTRY["claude-haiku-5-5"],
  inputPayload: { foo: "bar" },
  outputPayload: { error: "boom" },
  inputTokens: 10,
  outputTokens: 20,
  latencyMs: 100,
  status: "invalid_output" as const,
  errorMessage: "validation failed",
  promptVersion: "palpites_v1",
};

describe("persistAiCallError — swallow preservado", () => {
  it("engole a falha do insert (não re-throw) e loga em console.error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    insert.mockReturnValue({
      values: vi.fn(() => ({
        returning: () => Promise.reject(new Error("db down")),
      })),
    });

    await expect(persistAiCallError(baseArgs)).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(consoleError.mock.calls[0][0] as string);
    expect(logged.scope).toBe("persistAiCallError");
    expect(logged.error).toBe("ai_call_audit_insert_failed");
    expect(logged.originalStatus).toBe("invalid_output");
  });

  it("caminho ok: insere a row de erro sem logar e devolve o id", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const values = vi.fn((_row: Record<string, unknown>) => ({
      returning: () => Promise.resolve([{ id: "err-1" }]),
    }));
    insert.mockReturnValue({ values });

    await expect(persistAiCallError(baseArgs)).resolves.toBe("err-1");
    expect(values).toHaveBeenCalledTimes(1);
    const row = values.mock.calls[0][0];
    expect(row.status).toBe("invalid_output");
    expect(row.provider).toBe("anthropic");
    expect(row.model).toBe("claude-haiku-5-5");
    expect(row.costUsd).toBe("0.000011"); // (10*0.1 + 20*0.5)/1e6 = 0.000011
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("trunca o errorMessage no teto (2000 chars)", async () => {
    const values = vi.fn((_row: { errorMessage: string }) => ({
      returning: () => Promise.resolve([{ id: "err-2" }]),
    }));
    insert.mockReturnValue({ values });
    await persistAiCallError({ ...baseArgs, errorMessage: "x".repeat(5000) });
    const row = values.mock.calls[0][0];
    expect(row.errorMessage.length).toBe(2000);
    expect(row.errorMessage.endsWith("…")).toBe(true);
  });
});

describe("persistJudgmentAiCall — chamada de sistema (#555)", () => {
  it("userId null grava user_id null, provider typesafe, e devolve o id", async () => {
    const returning = vi.fn(() => Promise.resolve([{ id: "call-1" }]));
    const values = vi.fn((_row: Record<string, unknown>) => ({ returning }));
    insert.mockReturnValue({ values });

    const id = await persistJudgmentAiCall({
      userId: null,
      matchId: "m-1",
      model: "jev-1.13.0",
      promptVersion: "jev_judgments_v1",
      inputPayload: {},
      outputPayload: {},
      inputTokens: 1500,
      latencyMs: 110.4,
      costUsd: 0.000063,
      status: "ok",
      errorMessage: null,
    });

    expect(id).toBe("call-1");
    const row = values.mock.calls[0][0];
    expect(row.userId).toBeNull();
    expect(row.provider).toBe("typesafe");
    expect(row.latencyMs).toBe(110);
  });
});

describe("truncate", () => {
  it("não toca strings dentro do limite", () => {
    expect(truncate("abc", 10)).toBe("abc");
  });
  it("trunca com elipse no comprimento do limite", () => {
    const out = truncate("abcdef", 4);
    expect(out).toBe("abc…");
    expect(out.length).toBe(4);
  });
});
