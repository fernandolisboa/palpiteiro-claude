import { beforeEach, describe, expect, it, vi } from "vitest";

import { MODEL_REGISTRY, type AIModel } from "@/lib/ai/models";

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
    usage: {
      inputTokens: 200,
      outputTokens: 80,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
    inputPayload: { foo: "bar" },
    outputPayload: { content: contentBlocks },
    stopReason: "end_turn",
    latencyMs: 33,
    servedModel: MODEL_REGISTRY["claude-haiku-5-5"],
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

    expect(out.status).toBe("found");
    expect(out.via).toBe("web_search");
    expect(out.results).toEqual([
      { title: "Flamengo confirma desfalque", url: "https://ge.globo.com/a", source: "web_search" },
      { title: "Fluminense muda técnico", url: "https://lance.com.br/b", source: "web_search" },
    ]);
    expect(out.aiCall).toEqual({ id: "news-call-1" });

    // Loga UM ai_call(ok) com promptVersion news_v2.
    const row = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.status).toBe("ok");
    expect(row.promptVersion).toBe("news_v2");
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
    expect(req.serverTool?.maxUses).toBe(2);
    expect(req.serverTool?.allowedDomains).toEqual([...ALLOWED_DOMAINS]);
    // #670: sem user_location (o ServerToolDef não ganhou o campo).
    expect(Object.keys(req.serverTool ?? {}).sort()).toEqual([
      "allowedDomains",
      "kind",
      "maxUses",
    ]);
    // O userMessage carrega o contexto da partida, com nome curto, liga por extenso e
    // a data no fuso de Brasília (16h do dia 15 = 19h UTC).
    expect(req.userMessage).toContain("- Mandante: Flamengo");
    expect(req.userMessage).toContain("- Visitante: Fluminense");
    expect(req.userMessage).not.toContain("CR Flamengo");
    expect(req.userMessage).toContain("- Competição: Brasileirão");
    expect(req.userMessage).toMatch(/- Data: 15\/05\/2026,? 16:00 \(horário de Brasília\)/);
    expect(req.userMessage).toContain('Sugestão de consulta: "Flamengo x Fluminense"');
    // Sem prazo explícito, a request não leva prazo.
    expect(req.deadlineAt).toBeUndefined();
  });

  it("repassa o prazo pra request (a síntese guarda o tempo da manchete)", async () => {
    runAnalysis.mockResolvedValue(okResult([]));
    await getNewsByMatchViaWebSearch(CTX, AUDIT, { deadlineAt: 123_456 });
    const req = runAnalysis.mock.calls[0][0] as AnalysisRequest;
    expect(req.deadlineAt).toBe(123_456);
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
      { title: "Válida", url: "https://espn.com.br/ok", source: "web_search" },
    ]);
  });

  it("só https: dropa http puro e esquema perigoso (javascript:/data:/mailto:/relativa)", async () => {
    runAnalysis.mockResolvedValue(
      okResult([
        searchResultBlock([
          { title: "http puro", url: "http://ge.globo.com/a" },
          { title: "OK https", url: "https://espn.com.br/b" },
          { title: "XSS", url: "javascript:alert(1)" },
          { title: "Data", url: "data:text/html,<script>1</script>" },
          { title: "Mail", url: "mailto:x@y.com" },
          { title: "Protocol-relative", url: "//evil.com/x" },
          { title: "Sem esquema", url: "ge.globo.com/c" },
        ]),
      ]),
    );
    const out = await getNewsByMatchViaWebSearch(CTX, AUDIT);
    expect(out.results).toEqual([
      { title: "OK https", url: "https://espn.com.br/b", source: "web_search" },
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
      { title: "A", url: "https://ge.globo.com/x", source: "web_search" },
      { title: "B", url: "https://ge.globo.com/y", source: "web_search" },
    ]);
  });

  it("bloco de ERRO (content = objeto {error_code}) → [] e status failed (#670)", async () => {
    runAnalysis.mockResolvedValue(
      okResult([
        {
          type: "web_search_tool_result",
          tool_use_id: "srvtoolu_err",
          content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
        },
      ]),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await getNewsByMatchViaWebSearch(CTX, AUDIT);
    expect(out.results).toEqual([]);
    // Erro de busca é HTTP 200 → result.ok=true, loga ai_call(ok), mas o desfecho é
    // failed (antes virava "nenhuma notícia") e o error_code vai pro log.
    expect(out.status).toBe("failed");
    expect(out.via).toBeNull();
    const row = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.status).toBe("ok");
    expect(String(errSpy.mock.calls[0]?.[0])).toContain("max_uses_exceeded");
    errSpy.mockRestore();
  });

  it("um erro e uma busca vazia → none (a busca respondeu)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    runAnalysis.mockResolvedValue(
      okResult([
        {
          type: "web_search_tool_result",
          tool_use_id: "srvtoolu_err",
          content: { type: "web_search_tool_result_error", error_code: "unavailable" },
        },
        searchResultBlock([]),
      ]),
    );
    const out = await getNewsByMatchViaWebSearch(CTX, AUDIT);
    expect(out.status).toBe("none");
    expect(out.via).toBe("web_search");
    errSpy.mockRestore();
  });

  it("resposta sem nenhum bloco de busca → no_search", async () => {
    runAnalysis.mockResolvedValue(okResult([{ type: "text", text: "Sem buscar." }]));
    const out = await getNewsByMatchViaWebSearch(CTX, AUDIT);
    expect(out.status).toBe("no_search");
    expect(out.results).toEqual([]);
  });

  it("busca que voltou vazia → none", async () => {
    runAnalysis.mockResolvedValue(okResult([searchResultBlock([])]));
    const out = await getNewsByMatchViaWebSearch(CTX, AUDIT);
    expect(out.status).toBe("none");
    expect(out.via).toBe("web_search");
  });

  it("time fora da tabela e liga de fora: segue com o nome que veio", async () => {
    runAnalysis.mockResolvedValue(okResult([]));
    await getNewsByMatchViaWebSearch(
      {
        league: "premier_league",
        homeTeam: "Arsenal FC",
        awayTeam: "Chelsea FC",
        kickoffAt: "2026-05-15T19:00:00.000Z",
      },
      AUDIT,
    );
    const req = runAnalysis.mock.calls[0][0] as AnalysisRequest;
    expect(req.userMessage).toContain("- Competição: Premier League");
    expect(req.userMessage).toContain('Sugestão de consulta: "Arsenal FC x Chelsea FC"');
  });

  it("o system prompt é constante entre jogos (ADR 0071)", async () => {
    runAnalysis.mockResolvedValue(okResult([]));
    await getNewsByMatchViaWebSearch(CTX, AUDIT);
    await getNewsByMatchViaWebSearch(
      { ...CTX, homeTeam: "SE Palmeiras", kickoffAt: "2026-06-01T00:00:00.000Z" },
      AUDIT,
    );
    const [a, b] = runAnalysis.mock.calls.map((c) => (c[0] as AnalysisRequest).system);
    expect(a).toBe(b);
  });
});

describe("getNewsByMatchViaWebSearch — degrade gracioso", () => {
  it("hasKey()===false → failed, ZERO runAnalysis, provider_error auditado", async () => {
    hasKey.mockReturnValue(false);
    const out = await getNewsByMatchViaWebSearch(CTX, AUDIT);
    expect(out.status).toBe("failed");
    expect(out.results).toEqual([]);
    expect(out.aiCall).toBeNull();
    expect(runAnalysis).not.toHaveBeenCalled();
    const errArgs = persistAiCallError.mock.calls[0][0] as Record<string, unknown>;
    expect(errArgs.status).toBe("provider_error");
    expect(errArgs.promptVersion).toBe("news_v2");
    // Nenhum ai_call(ok) inserido.
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("provider !ok → results:[], status failed, status do provider auditado (não throw)", async () => {
    runAnalysis.mockResolvedValue({
      ok: false,
      status: "timeout",
      message: "timed out",
      usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
      inputPayload: {},
      outputPayload: {},
      stopReason: null,
      latencyMs: 10,
      servedModel: MODEL_REGISTRY["claude-haiku-5-5"],
    } satisfies AnalysisResult);
    const out = await getNewsByMatchViaWebSearch(CTX, AUDIT);
    expect(out.results).toEqual([]);
    expect(out.status).toBe("failed");
    expect(out.aiCall).toBeNull();
    const errArgs = persistAiCallError.mock.calls[0][0] as Record<string, unknown>;
    expect(errArgs.status).toBe("timeout");
    expect(insertValues).not.toHaveBeenCalled();
  });
});

describe("getNewsByMatchViaWebSearch — modelo que serviu (PLAN-608)", () => {
  const ADOPTED_HAIKU: AIModel = {
    ...MODEL_REGISTRY["claude-haiku-5-5"],
    id: "claude-haiku-5-6",
    inputPricePerMTok: 1,
    outputPricePerMTok: 2,
    longPromptPricing: undefined,
    adopted: { priceEstimated: true, pinnedId: "claude-haiku-5-5" },
  };

  it("ok: ai_calls.model e custo do servido", async () => {
    runAnalysis.mockResolvedValue({ ...okResult([]), servedModel: ADOPTED_HAIKU });
    await getNewsByMatchViaWebSearch(CTX, AUDIT);
    const row = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.model).toBe("claude-haiku-5-6");
    // 200 × $1 + 80 × $2 por 1M
    expect(row.costUsd).toBe(((200 * 1 + 80 * 2) / 1_000_000).toFixed(6));
  });

  it("erro do provider: a row de erro leva o servido", async () => {
    runAnalysis.mockResolvedValue({
      ok: false,
      status: "provider_error",
      message: "boom",
      usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
      inputPayload: {},
      outputPayload: {},
      stopReason: null,
      latencyMs: 1,
      servedModel: ADOPTED_HAIKU,
    } satisfies AnalysisResult);
    await getNewsByMatchViaWebSearch(CTX, AUDIT);
    const errArgs = persistAiCallError.mock.calls[0][0] as { model: AIModel };
    expect(errArgs.model).toBe(ADOPTED_HAIKU);
  });
});
