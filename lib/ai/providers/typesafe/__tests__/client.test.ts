import { afterEach, describe, expect, it, vi } from "vitest";

import {
  callSystemOne,
  TYPESAFE_ENDPOINT,
  TYPESAFE_TIMEOUT_MS,
  type TypeSafeNoulQuestion,
} from "../client";
import { TypeSafeError, typeSafeErrorToAiCallStatus } from "../errors";

const QUESTIONS: Record<string, TypeSafeNoulQuestion> = {
  q1: { type: "noul", instructions: "Is it raining?" },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const OK_BODY = {
  model: "jev-1.13.0",
  answers: { q1: { type: "noul", noul: 0.8 } },
  usage: { input_tokens: 300, output_tokens: 20 },
};

async function captureError(p: Promise<unknown>): Promise<TypeSafeError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(TypeSafeError);
    return err as TypeSafeError;
  }
  throw new Error("expected rejection");
}

describe("callSystemOne", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("envia POST com Bearer, modelo pinado e devolve a resposta validada", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, OK_BODY));
    const result = await callSystemOne({
      state: { a: 1 },
      questions: QUESTIONS,
      apiKey: "k",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(TYPESAFE_ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer k"
    );
    expect(JSON.parse(init.body as string)).toEqual({
      model: "jev-1.13.0",
      state: { a: 1 },
      questions: QUESTIONS,
    });
    expect(result.response.answers.q1.noul).toBe(0.8);
    expect(result.response.usage.input_tokens).toBe(300);
    expect(result.rawResponse).toEqual(OK_BODY);
  });

  it("sem chave → auth, sem chamar a rede", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const fetchImpl = vi.fn();
    const err = await captureError(
      callSystemOne({ state: "x", questions: QUESTIONS, fetchImpl })
    );
    expect(err.kind).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("401 → auth", async () => {
    const err = await captureError(
      callSystemOne({
        state: "x",
        questions: QUESTIONS,
        apiKey: "bad",
        fetchImpl: async () => jsonResponse(401, { error: "unauthorized" }),
      })
    );
    expect(err.kind).toBe("auth");
    expect(err.httpStatus).toBe(401);
  });

  it("429 → rate_limited", async () => {
    const err = await captureError(
      callSystemOne({
        state: "x",
        questions: QUESTIONS,
        apiKey: "k",
        fetchImpl: async () => jsonResponse(429, { error: "slow down" }),
      })
    );
    expect(err.kind).toBe("rate_limited");
    expect(typeSafeErrorToAiCallStatus(err.kind)).toBe("rate_limited");
  });

  it("529/500 → provider_error", async () => {
    for (const status of [500, 529]) {
      const err = await captureError(
        callSystemOne({
          state: "x",
          questions: QUESTIONS,
          apiKey: "k",
          fetchImpl: async () => jsonResponse(status, {}),
        })
      );
      expect(err.kind).toBe("provider_error");
      expect(err.httpStatus).toBe(status);
    }
  });

  it("estouro do timeout → timeout", async () => {
    const fetchImpl = (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const err = await captureError(
      callSystemOne({
        state: "x",
        questions: QUESTIONS,
        apiKey: "k",
        timeoutMs: 10,
        fetchImpl,
      })
    );
    expect(err.kind).toBe("timeout");
    expect(typeSafeErrorToAiCallStatus(err.kind)).toBe("timeout");
  });

  it("200 cujo corpo nunca fecha → timeout (leitura dentro do teto)", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = async () =>
        new Response(new ReadableStream<Uint8Array>({ start() {} }), {
          status: 200,
        });
      const pending = captureError(
        callSystemOne({
          state: "x",
          questions: QUESTIONS,
          apiKey: "k",
          fetchImpl,
        })
      );
      await vi.advanceTimersByTimeAsync(TYPESAFE_TIMEOUT_MS);
      const err = await pending;
      expect(err.kind).toBe("timeout");
      expect(err.requestPayload).toMatchObject({ model: "jev-1.13.0" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("falha de rede → provider_error", async () => {
    const err = await captureError(
      callSystemOne({
        state: "x",
        questions: QUESTIONS,
        apiKey: "k",
        fetchImpl: async () => {
          throw new TypeError("fetch failed");
        },
      })
    );
    expect(err.kind).toBe("provider_error");
  });

  it("corpo que não é JSON → bad_response", async () => {
    const err = await captureError(
      callSystemOne({
        state: "x",
        questions: QUESTIONS,
        apiKey: "k",
        fetchImpl: async () =>
          new Response("<html>oops</html>", { status: 200 }),
      })
    );
    expect(err.kind).toBe("bad_response");
    expect(typeSafeErrorToAiCallStatus(err.kind)).toBe("invalid_output");
    // Sem JSON não há como saber o custo.
    expect(err.inputTokens).toBeNull();
    expect(err.requestPayload).toMatchObject({ state: "x" });
  });

  it("noul fora de [0,1] → bad_response", async () => {
    const err = await captureError(
      callSystemOne({
        state: "x",
        questions: QUESTIONS,
        apiKey: "k",
        fetchImpl: async () =>
          jsonResponse(200, {
            ...OK_BODY,
            answers: { q1: { type: "noul", noul: 1.7 } },
          }),
      })
    );
    expect(err.kind).toBe("bad_response");
    // 2xx fora do schema também é pago: tokens lidos do JSON cru.
    expect(err.inputTokens).toBe(300);
    expect(err.requestPayload).toMatchObject({
      model: "jev-1.13.0",
      state: "x",
      questions: QUESTIONS,
    });
  });

  it("answer faltando pra uma pergunta → bad_response", async () => {
    const err = await captureError(
      callSystemOne({
        state: "x",
        questions: { ...QUESTIONS, q2: { type: "noul", instructions: "?" } },
        apiKey: "k",
        fetchImpl: async () => jsonResponse(200, OK_BODY),
      })
    );
    expect(err.kind).toBe("bad_response");
    expect(err.message).toContain("q2");
    expect(err.inputTokens).toBe(300);
    expect(err.requestPayload).not.toBeNull();
  });
});
