import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AnalysisRequest,
  AnalysisResult,
  AIProvider,
} from "@/lib/ai/providers/types";
import type { NewsMatchContext } from "@/lib/providers/news/types";

// ─── Module mocks (cada boundary que o adapter de notícias toca) ──────────────

// db stub: insert().values().returning() → [{ id: "news-call-1" }].
const insertValues = vi.fn((..._args: unknown[]) => {});
vi.mock("@/lib/db", () => {
  const insert = vi.fn(() => ({
    values: (...args: unknown[]) => {
      insertValues(...args);
      return {
        returning: vi.fn(() => Promise.resolve([{ id: "news-call-1" }])),
      };
    },
  }));
  return { db: { insert } };
});

// persistAiCallError: spy capturável (loga erros auditados, swallow).
const persistAiCallError = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock("@/lib/ai/ai-call-logging", () => ({
  persistAiCallError: (...args: unknown[]) => persistAiCallError(...args),
}));

// Seam de provider (ADR 0027): getProviderForModel → runAnalysis/hasKey capturados.
const runAnalysis = vi.fn();
const hasKey = vi.fn(() => true);
const fakeProvider: AIProvider = {
  providerKey: "anthropic",
  hasKey: () => hasKey(),
  runAnalysis: (req: AnalysisRequest) => runAnalysis(req),
};
vi.mock("@/lib/ai/providers", () => ({
  getProviderForModel: vi.fn(() => fakeProvider),
}));

import { getNewsByMatchViaWebSearch } from "../anthropic-web-search";
import { ALLOWED_DOMAINS } from "../allowed-domains";

const CTX: NewsMatchContext = {
  league: "brasileirao_a",
  homeTeam: "CR Flamengo",
  awayTeam: "Fluminense FC",
  kickoffAt: "2026-05-15T19:00:00.000Z",
};
const AUDIT = { userId: "u-1", matchId: "m-1" };

// Bloco web_search_tool_result de SUCESSO: content é uma LISTA de web_search_result.
function searchResultBlock(items: Array<{ title?: unknown; url?: unknown }>) {
  return {
    type: "web_search_tool_result",
    tool_use_id: "srvtoolu_1",
    content: items.map((i) => ({ type: "web_search_result", ...i })),
  };
}

function okResult(contentBlocks: unknown[]): AnalysisResult {
  return {
    ok: true,
    toolInput: undefined,
    usage: { inputTokens: 200, outputTokens: 80 },
    inputPayload: { foo: "bar" },
    outputPayload: { content: contentBlocks },
    stopReason: "end_turn",
    latencyMs: 33,
    contentBlocks,
  };
}

beforeEach(() => {
  insertValues.mockReset();
  persistAiCallError.mockReset();
  persistAiCallError.mockResolvedValue(undefined);
  runAnalysis.mockReset();
  hasKey.mockReset();
  hasKey.mockReturnValue(true);
});

describe("getNewsByMatchViaWebSearch — caminho feliz", () => {
  it("captura {title,url} reais dos web_search_tool_result + loga ai_call(ok)", async () => {
    runAnalysis.mockResolvedValue(
      okResult([
        { type: "text", text: "Resumo das notícias" },
        searchResultBlock([
          { title: "Flamengo confirma desfalque", url: "https://ge.globo.com/a" },
          { title: "Fluminense muda técnico", url: "https://lance.com.br/b" },
        ]),
      ]),
    );

    const out = await getNewsByMatchViaWebSearch(CTX, AUDIT);

    expect(out.unavailable).toBe(false);
    expect(out.results).toEqual([
      { title: "Flamengo confirma desfalque", url: "https://ge.globo.com/a" },
      { title: "Fluminense muda técnico", url: "https://lance.com.br/b" },
    ]);
    expect(out.aiCall).toEqual({ id: "news-call-1" });

    // Loga UM ai_call(ok) com promptVersion news_v1.
    const row = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.status).toBe("ok");
    expect(row.promptVersion).toBe("news_v1");
    expect(row.provider).toBe("anthropic");
    // Nenhum erro auditado no caminho feliz.
    expect(persistAiCallError).not.toHaveBeenCalled();
  });

  it("a request leva a server tool de web search com allowed_domains + maxUses", async () => {
    runAnalysis.mockResolvedValue(okResult([]));
    await getNewsByMatchViaWebSearch(CTX, AUDIT);
    const req = runAnalysis.mock.calls[0][0] as AnalysisRequest;
    expect(req.serverTool).toBeDefined();
    expect(req.serverTool?.kind).toBe("web_search");
    expect(req.serverTool?.maxUses).toBe(1);
    expect(req.serverTool?.allowedDomains).toEqual([...ALLOWED_DOMAINS]);
    // O userMessage carrega o contexto da partida.
    expect(req.userMessage).toContain("CR Flamengo");
    expect(req.userMessage).toContain("Fluminense FC");
  });
});

describe("getNewsByMatchViaWebSearch — 'nunca inventa fonte'", () => {
  it("dropa itens sem title NÃO-VAZIO ou sem url válido", async () => {
    runAnalysis.mockResolvedValue(
      okResult([
        searchResultBlock([
          { title: "Válida", url: "https://espn.com.br/ok" },
          { title: "", url: "https://espn.com.br/empty-title" }, // title vazio
          { title: "Sem url" }, // url ausente
          { title: "Url vazia", url: "   " }, // url só espaço
          { url: "https://espn.com.br/no-title" }, // title ausente
        ]),
      ]),
    );
    const out = await getNewsByMatchViaWebSearch(CTX, AUDIT);
    expect(out.results).toEqual([
      { title: "Válida", url: "https://espn.com.br/ok" },
    ]);
  });

  it("dedup por url", async () => {
    runAnalysis.mockResolvedValue(
      okResult([
        searchResultBlock([
          { title: "A", url: "https://ge.globo.com/x" },
          { title: "A de novo", url: "https://ge.globo.com/x" },
          { title: "B", url: "https://ge.globo.com/y" },
        ]),
      ]),
    );
    const out = await getNewsByMatchViaWebSearch(CTX, AUDIT);
    expect(out.results).toEqual([
      { title: "A", url: "https://ge.globo.com/x" },
      { title: "B", url: "https://ge.globo.com/y" },
    ]);
  });

  it("bloco de ERRO (content = objeto {error_code}) → [] (não trata como sucesso)", async () => {
    runAnalysis.mockResolvedValue(
      okResult([
        {
          type: "web_search_tool_result",
          tool_use_id: "srvtoolu_err",
          content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
        },
      ]),
    );
    const out = await getNewsByMatchViaWebSearch(CTX, AUDIT);
    expect(out.results).toEqual([]);
    // Erro de busca é HTTP 200 → ainda é result.ok=true → unavailable:false, loga ai_call(ok).
    expect(out.unavailable).toBe(false);
    const row = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.status).toBe("ok");
  });
});

describe("getNewsByMatchViaWebSearch — degrade gracioso", () => {
  it("hasKey()===false → unavailable:true, ZERO runAnalysis, provider_error auditado", async () => {
    hasKey.mockReturnValue(false);
    const out = await getNewsByMatchViaWebSearch(CTX, AUDIT);
    expect(out.unavailable).toBe(true);
    expect(out.results).toEqual([]);
    expect(out.aiCall).toBeNull();
    expect(runAnalysis).not.toHaveBeenCalled();
    const errArgs = persistAiCallError.mock.calls[0][0] as Record<string, unknown>;
    expect(errArgs.status).toBe("provider_error");
    expect(errArgs.promptVersion).toBe("news_v1");
    // Nenhum ai_call(ok) inserido.
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("provider !ok → results:[], unavailable:false, status do provider auditado (não throw)", async () => {
    runAnalysis.mockResolvedValue({
      ok: false,
      status: "timeout",
      message: "timed out",
      usage: { inputTokens: 0, outputTokens: 0 },
      inputPayload: {},
      outputPayload: {},
      stopReason: null,
      latencyMs: 10,
    } satisfies AnalysisResult);
    const out = await getNewsByMatchViaWebSearch(CTX, AUDIT);
    expect(out.results).toEqual([]);
    expect(out.unavailable).toBe(false);
    expect(out.aiCall).toBeNull();
    const errArgs = persistAiCallError.mock.calls[0][0] as Record<string, unknown>;
    expect(errArgs.status).toBe("timeout");
    expect(insertValues).not.toHaveBeenCalled();
  });
});
