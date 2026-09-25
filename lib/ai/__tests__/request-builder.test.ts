import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

import type { Effort } from "@/lib/ai/generation-params";
import { MODEL_REGISTRY, type AIModel } from "@/lib/ai/models";
import { buildAnthropicRequest } from "@/lib/ai/request-builder";
import {
  overUnderCartridge,
  SUBMIT_PREDICTION_TOOL,
} from "@/lib/ai/markets/over_under";
import { MIN_EDGE_PP } from "@/lib/odds/scenario";

const MAX_TOKENS = 2048;

// Modelo ADAPTIVE real do registry (#524 trouxe Fable 5.1 / Opus 5.5 / Sonnet 5 de
// volta — o ramo adaptive do builder voltou a ser alcançável). Os testes de shape
// usam o Opus 5.5; os golden payloads abaixo cobrem os três.
const ADAPTIVE_MODEL: AIModel = MODEL_REGISTRY["claude-opus-5-5"];
const ADAPTIVE_IDS = [
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-sonnet-5",
] as const;

function build(model: Parameters<typeof buildAnthropicRequest>[0]["model"]) {
  return buildAnthropicRequest({
    model,
    system: "sys",
    userMessage: "msg",
    tools: [SUBMIT_PREDICTION_TOOL as unknown as Anthropic.Tool],
    toolName: SUBMIT_PREDICTION_TOOL.name,
    maxTokens: MAX_TOKENS,
  });
}

describe("buildAnthropicRequest — model-aware payload", () => {
  it("adaptive (Opus 5.5): adaptive thinking, NO temperature/top_p/top_k", () => {
    const payload = build(ADAPTIVE_MODEL);

    // CRÍTICO: modelos adaptive dão 400 em sampling params; o builder DEVE omiti-los.
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("top_p");
    expect(payload).not.toHaveProperty("top_k");
    expect(payload.thinking).toEqual({ type: "adaptive" });
  });

  it("adaptive (Opus 5.5): tool_choice is 'auto' and NEVER pairs thinking with forced tool_choice", () => {
    const payload = build(ADAPTIVE_MODEL);

    // CRÍTICO: forced tool_choice + thinking dá 400 no caminho adaptive. O builder
    // DEVE usar `auto` — predict.ts trata a ausência do tool_use (tool_missing).
    expect(payload.tool_choice).toEqual({ type: "auto" });
    // Garante a INVARIANTE que o 400 produz: thinking presente ⇒ tool_choice NÃO forçado.
    expect(payload.thinking).toEqual({ type: "adaptive" });
    expect(payload.tool_choice).not.toEqual({
      type: "tool",
      name: SUBMIT_PREDICTION_TOOL.name,
    });
    // adaptive nunca emite thinking disabled (também dá 400 no caminho adaptive).
    expect(payload.thinking).not.toEqual({ type: "disabled" });
  });

  it("Sonnet 4.5: temperature 0.3, NO thinking", () => {
    const payload = build(MODEL_REGISTRY["claude-sonnet-4-5-20250929"]);

    expect(payload.model).toBe("claude-sonnet-4-5-20250929");
    expect(payload.temperature).toBe(0.3);
    expect(payload).not.toHaveProperty("thinking");
  });

  it("Sonnet 4.5: tool_choice forces submit_prediction (válido sem thinking)", () => {
    const payload = build(MODEL_REGISTRY["claude-sonnet-4-5-20250929"]);

    // Sonnet não usa thinking, então forçar o tool é válido e desejável.
    expect(payload.tool_choice).toEqual({
      type: "tool",
      name: SUBMIT_PREDICTION_TOOL.name,
    });
    expect(payload).not.toHaveProperty("thinking");
  });

  it("Haiku 4.5: temperature 0.3, forced tool_choice, NO adaptive thinking", () => {
    const payload = build(MODEL_REGISTRY["claude-haiku-4-5"]);

    expect(payload.model).toBe("claude-haiku-4-5");
    expect(payload.temperature).toBe(0.3);
    expect(payload.tool_choice).toEqual({
      type: "tool",
      name: SUBMIT_PREDICTION_TOOL.name,
    });
    expect(payload).not.toHaveProperty("thinking");
  });

  it("both: max_tokens is wired", () => {
    for (const model of Object.values(MODEL_REGISTRY)) {
      const payload = build(model);
      expect(payload.max_tokens).toBe(MAX_TOKENS);
    }
  });
});

describe("buildAnthropicRequest — golden payloads dos adaptive (#524)", () => {
  // Payload EXATO por modelo: pega qualquer chave a mais (temperature, top_p, top_k,
  // budget_tokens, thinking disabled, tool_choice forçado, prefill) que daria 400
  // no Fable 5.1 / Opus 5.5 (e no Sonnet 5 com thinking ligado).
  function golden(id: (typeof ADAPTIVE_IDS)[number]) {
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

  for (const id of ADAPTIVE_IDS) {
    it(`${id}: payload exato (adaptive, auto, effort em output_config, sem sampling)`, () => {
      const payload = buildAnthropicRequest({
        model: MODEL_REGISTRY[id],
        system: "sys",
        userMessage: "msg",
        tools: [SUBMIT_PREDICTION_TOOL as unknown as Anthropic.Tool],
        toolName: SUBMIT_PREDICTION_TOOL.name,
        maxTokens: 16000,
        effort: "xhigh",
        // temperature calibrada no ai_config NÃO pode vazar pro adaptive (400).
        temperature: 0.7,
      });
      expect(payload).toEqual(golden(id));
      // Só a mensagem do usuário: nada de prefill do assistant (400 nos adaptive).
      expect(payload.messages.map((m) => m.role)).toEqual(["user"]);
      expect(JSON.stringify(payload)).not.toContain("budget_tokens");
      expect(JSON.stringify(payload)).not.toContain('"disabled"');
    });
  }
});

describe("buildAnthropicRequest — calibração model-aware (effort/temperature)", () => {
  function buildWith(
    model: Parameters<typeof buildAnthropicRequest>[0]["model"],
    extra: { effort?: Effort; temperature?: number },
  ) {
    return buildAnthropicRequest({
      model,
      system: "sys",
      userMessage: "msg",
      tools: [SUBMIT_PREDICTION_TOOL as unknown as Anthropic.Tool],
      toolName: SUBMIT_PREDICTION_TOOL.name,
      maxTokens: 16000,
      ...extra,
    });
  }

  it("adaptive (Opus 5.5): effort vai em output_config; segue sem sampling", () => {
    const payload = buildWith(ADAPTIVE_MODEL, {
      effort: "medium",
    });
    expect(payload.output_config).toEqual({
      effort: "medium",
    });
    expect(payload).not.toHaveProperty("temperature");
  });

  it("adaptive sem effort: NÃO emite output_config (default do servidor)", () => {
    const payload = buildWith(ADAPTIVE_MODEL, {});
    expect(payload.output_config).toBeUndefined();
  });

  it("temperature-mode (Haiku): usa a temperature calibrada e IGNORA effort", () => {
    const payload = buildWith(MODEL_REGISTRY["claude-haiku-4-5"], {
      effort: "max", // não deve vazar pro caminho temperature (Haiku dá erro)
      temperature: 0.7,
    });
    expect(payload.temperature).toBe(0.7);
    expect(payload.output_config).toBeUndefined();
    expect(payload).not.toHaveProperty("thinking");
  });

  it("temperature-mode sem override: cai no default do registry (0.3)", () => {
    const payload = buildWith(MODEL_REGISTRY["claude-sonnet-4-5-20250929"], {});
    expect(payload.temperature).toBe(0.3);
  });
});

describe("buildAnthropicRequest — ramo server-tool (web search, ADR 0032 / #377)", () => {
  function buildWithServerTool(
    model: Parameters<typeof buildAnthropicRequest>[0]["model"],
  ) {
    return buildAnthropicRequest({
      model,
      system: "sys",
      userMessage: "msg",
      // No modo server-tool o tool forçado é ignorado; passamos vazio.
      tools: [],
      toolName: "submit_palpite",
      maxTokens: 4096,
      serverTool: {
        kind: "web_search",
        allowedDomains: ["ge.globo.com", "bbc.com"],
        maxUses: 1,
      },
    });
  }

  it("emite a web_search_20250305 (básica) com allowed_domains + max_uses; tool_choice auto; SEM submit forçado", () => {
    const payload = buildWithServerTool(MODEL_REGISTRY["claude-haiku-4-5"]) as unknown as {
      tools: Array<Record<string, unknown>>;
      tool_choice: unknown;
    };
    const tool = payload.tools[0];
    // Travado em web_search_20250305: os callers do ramo (notícias, cartões) fixam
    // Haiku 4.5; a _20260209 exige 4.6+ e puxa code_execution por baixo.
    expect(tool.type).toBe("web_search_20250305");
    expect(tool.name).toBe("web_search");
    expect(tool.allowed_domains).toEqual(["ge.globo.com", "bbc.com"]);
    expect(tool.max_uses).toBe(1);
    // tool_choice é auto (web search não pode ser forçado como o submit).
    expect(payload.tool_choice).toEqual({ type: "auto" });
    // NÃO força nem declara o submit_palpite.
    expect(payload.tools).toHaveLength(1);
    expect(JSON.stringify(payload.tools)).not.toContain("submit_palpite");
  });

  it("temperature-mode (Haiku): carrega temperature, SEM thinking", () => {
    const payload = buildWithServerTool(MODEL_REGISTRY["claude-haiku-4-5"]);
    expect(payload.temperature).toBe(0.3);
    expect(payload).not.toHaveProperty("thinking");
  });

  it("adaptive (se um cair aqui): SEM temperature e SEM thinking explícito (roda adaptive ao omitir)", () => {
    for (const id of ADAPTIVE_IDS) {
      const payload = buildWithServerTool(MODEL_REGISTRY[id]);
      expect(payload).not.toHaveProperty("temperature");
      expect(payload).not.toHaveProperty("thinking");
      expect(payload.tool_choice).toEqual({ type: "auto" });
    }
  });

  it("NÃO declara code_execution junto (a básica não usa dynamic filtering)", () => {
    const payload = buildWithServerTool(MODEL_REGISTRY["claude-haiku-4-5"]);
    expect(JSON.stringify(payload)).not.toContain("code_execution");
  });

  it("sem serverTool: caminho forçado byte-idêntico (submit_prediction forçado, golden intacto)", () => {
    // Guarda anti-regressão: provar que a ausência de serverTool deixa o caminho
    // forçado EXATAMENTE como antes (o ramo aditivo não vazou pro forçado).
    const payload = build(MODEL_REGISTRY["claude-haiku-4-5"]);
    expect(payload.tool_choice).toEqual({
      type: "tool",
      name: SUBMIT_PREDICTION_TOOL.name,
    });
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
