import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

import type { Effort } from "@/lib/ai/generation-params";
import { MODEL_REGISTRY, type AIModelId } from "@/lib/ai/models";
import { buildAnthropicRequest } from "@/lib/ai/request-builder";
import {
  overUnderCartridge,
  SUBMIT_PREDICTION_TOOL,
} from "@/lib/ai/markets/over_under";
import { MIN_EDGE_PP } from "@/lib/odds/scenario";

const MAX_TOKENS = 2048;

// ADR 0061: o registry tem só Opus, Sonnet e Haiku 5.5, todos adaptive. O builder
// monta UM corpo pra todos (tool_choice auto, thinking adaptive, effort opcional,
// NUNCA sampling). O antigo caminho temperature/tool forçado acabou.
const MODEL_IDS = Object.keys(MODEL_REGISTRY) as AIModelId[];

function build(
  id: AIModelId,
  extra: { effort?: Effort; maxTokens?: number } = {},
) {
  return buildAnthropicRequest({
    model: MODEL_REGISTRY[id],
    system: "sys",
    userMessage: "msg",
    tools: [SUBMIT_PREDICTION_TOOL as unknown as Anthropic.Tool],
    toolName: SUBMIT_PREDICTION_TOOL.name,
    maxTokens: extra.maxTokens ?? MAX_TOKENS,
    ...(extra.effort ? { effort: extra.effort } : {}),
  });
}

describe("buildAnthropicRequest — um corpo pra todo modelo (ADR 0061)", () => {
  it("o registry é exatamente Opus, Sonnet e Haiku 5.5", () => {
    expect(MODEL_IDS).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
    ]);
  });

  for (const id of MODEL_IDS) {
    it(`${id}: tool_choice auto, thinking adaptive, SEM temperature/top_p/top_k`, () => {
      const payload = build(id);
      expect(payload.model).toBe(id);
      // CRÍTICO: os três dão 400 em sampling fora do default; o builder nunca os emite.
      expect(payload).not.toHaveProperty("temperature");
      expect(payload).not.toHaveProperty("top_p");
      expect(payload).not.toHaveProperty("top_k");
      expect(payload.thinking).toEqual({ type: "adaptive" });
      // tool forçado dá 400 no Opus/Sonnet 5.5 (e pula o thinking no Haiku 5.5).
      expect(payload.tool_choice).toEqual({ type: "auto" });
      expect(payload.tool_choice).not.toEqual({
        type: "tool",
        name: SUBMIT_PREDICTION_TOOL.name,
      });
      expect(payload.thinking).not.toEqual({ type: "disabled" });
      expect(payload.max_tokens).toBe(MAX_TOKENS);
      expect(payload.tools).toEqual([SUBMIT_PREDICTION_TOOL]);
    });
  }

  it("os três modelos produzem o MESMO corpo, salvo o campo `model`", () => {
    const strip = (id: AIModelId) => {
      const { model, ...rest } = build(id, { effort: "high" });
      expect(model).toBe(id);
      return rest;
    };
    const [first, ...others] = MODEL_IDS.map(strip);
    for (const other of others) expect(other).toEqual(first);
  });
});

describe("buildAnthropicRequest — golden payloads (#524, ADR 0061)", () => {
  // Payload EXATO por modelo: pega qualquer chave a mais (temperature, top_p, top_k,
  // budget_tokens, thinking disabled, tool_choice forçado, prefill) que daria 400.
  function golden(id: AIModelId) {
    return {
      model: id,
      system: "sys",
      messages: [{ role: "user", content: "msg" }],
      tools: [SUBMIT_PREDICTION_TOOL],
      max_tokens: 16000,
      tool_choice: { type: "auto" },
      thinking: { type: "adaptive" },
      output_config: { effort: "xhigh" },
    };
  }

  for (const id of MODEL_IDS) {
    it(`${id}: payload exato (adaptive, auto, effort em output_config, sem sampling)`, () => {
      const payload = build(id, { maxTokens: 16000, effort: "xhigh" });
      expect(payload).toEqual(golden(id));
      // Só a mensagem do usuário: nada de prefill do assistant (400).
      expect(payload.messages.map((m) => m.role)).toEqual(["user"]);
      expect(JSON.stringify(payload)).not.toContain("budget_tokens");
      expect(JSON.stringify(payload)).not.toContain('"disabled"');
    });
  }
});

describe("buildAnthropicRequest — effort em output_config", () => {
  for (const id of MODEL_IDS) {
    it(`${id}: effort passado vai em output_config`, () => {
      for (const effort of ["low", "medium", "high", "xhigh", "max"] as const) {
        expect(build(id, { effort }).output_config).toEqual({ effort });
      }
    });

    it(`${id}: sem effort NÃO emite output_config (default do servidor)`, () => {
      const payload = build(id);
      expect(payload).not.toHaveProperty("output_config");
      // O resto do corpo não muda sem effort.
      expect(payload.thinking).toEqual({ type: "adaptive" });
      expect(payload.tool_choice).toEqual({ type: "auto" });
    });
  }
});

describe("buildAnthropicRequest — ramo server-tool (web search, ADR 0032 / #377)", () => {
  function buildWithServerTool(id: AIModelId, effort?: Effort) {
    return buildAnthropicRequest({
      model: MODEL_REGISTRY[id],
      system: "sys",
      userMessage: "msg",
      // No modo server-tool o tool de submit é ignorado; passamos vazio.
      tools: [],
      toolName: "submit_palpite",
      maxTokens: 4096,
      ...(effort ? { effort } : {}),
      serverTool: {
        kind: "web_search",
        allowedDomains: ["ge.globo.com", "bbc.com"],
        maxUses: 1,
      },
    });
  }

  it("emite a web_search_20250305 (básica) com allowed_domains + max_uses; tool_choice auto; SEM submit", () => {
    const payload = buildWithServerTool("claude-haiku-5-5") as unknown as {
      tools: Array<Record<string, unknown>>;
      tool_choice: unknown;
    };
    const tool = payload.tools[0];
    // Travado em web_search_20250305: os callers do ramo (notícias, cartões) usam o
    // Haiku 5.5, que não roda a _20260209 (e ela puxa code_execution por baixo).
    expect(tool.type).toBe("web_search_20250305");
    expect(tool.name).toBe("web_search");
    expect(tool.allowed_domains).toEqual(["ge.globo.com", "bbc.com"]);
    expect(tool.max_uses).toBe(1);
    expect(payload.tool_choice).toEqual({ type: "auto" });
    expect(payload.tools).toHaveLength(1);
    expect(JSON.stringify(payload.tools)).not.toContain("submit_palpite");
  });

  for (const id of MODEL_IDS) {
    it(`${id}: thinking adaptive + effort quando passado, sem sampling`, () => {
      const payload = buildWithServerTool(id, "medium");
      expect(payload.thinking).toEqual({ type: "adaptive" });
      expect(payload.output_config).toEqual({ effort: "medium" });
      expect(payload.tool_choice).toEqual({ type: "auto" });
      expect(payload).not.toHaveProperty("temperature");
      expect(payload).not.toHaveProperty("top_p");
      expect(payload).not.toHaveProperty("top_k");
      expect(payload.max_tokens).toBe(4096);
    });

    it(`${id}: sem effort, thinking adaptive e SEM output_config`, () => {
      const payload = buildWithServerTool(id);
      expect(payload.thinking).toEqual({ type: "adaptive" });
      expect(payload).not.toHaveProperty("output_config");
      expect(payload).not.toHaveProperty("temperature");
    });
  }

  it("payload server-tool exato (Haiku 5.5, effort medium)", () => {
    expect(buildWithServerTool("claude-haiku-5-5", "medium")).toEqual({
      model: "claude-haiku-5-5",
      system: "sys",
      messages: [{ role: "user", content: "msg" }],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 1,
          allowed_domains: ["ge.globo.com", "bbc.com"],
        },
      ],
      tool_choice: { type: "auto" },
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
    });
  });

  it("NÃO declara code_execution junto (a básica não usa dynamic filtering)", () => {
    const payload = buildWithServerTool("claude-haiku-5-5", "medium");
    expect(JSON.stringify(payload)).not.toContain("code_execution");
  });

  it("sem serverTool: o submit tool segue declarado (auto) e nada de web_search vaza", () => {
    const payload = build("claude-haiku-5-5");
    expect(payload.tools).toEqual([SUBMIT_PREDICTION_TOOL]);
    expect(payload.tool_choice).toEqual({ type: "auto" });
    expect(JSON.stringify(payload.tools)).not.toContain("web_search");
  });
});

describe("MIN_EDGE_PP ↔ SYSTEM_PROMPT sync", () => {
  it("the UI threshold constant matches the prompt's edge rule", () => {
    // Se um prompt futuro mudar o threshold de 5pp, este teste quebra em vez
    // de a UI mentir. A constante mora em lib/odds/scenario.ts (não no cartucho)
    // pra não vazar o systemPrompt pro client bundle.
    expect(overUnderCartridge.systemPrompt).toContain(
      `${MIN_EDGE_PP} pontos percentuais`,
    );
    // Regra 4 (minimum_odd) também deriva de MIN_EDGE_PP, não de um literal.
    expect(overUnderCartridge.systemPrompt).toContain(
      `mantém edge >= ${MIN_EDGE_PP}%. Obrigatório quando recommendation ∈ {"over","under"}`,
    );
  });
});
