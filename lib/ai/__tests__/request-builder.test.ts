import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

import { MODEL_REGISTRY, type AIModel } from "@/lib/ai/models";
import { buildAnthropicRequest } from "@/lib/ai/request-builder";
import {
  overUnderCartridge,
  SUBMIT_PREDICTION_TOOL,
} from "@/lib/ai/markets/over_under";
import { MIN_EDGE_PP } from "@/lib/odds/scenario";

const MAX_TOKENS = 2048;

// Fixture INLINE de um modelo ADAPTIVE. Pós-#374 o registry só tem modelos
// `temperature` (Sonnet 4.5 + Haiku), mas o ramo `adaptive` do request-builder
// segue VIVO (dead-but-live — predict.ts/request-builder estão congelados).
// Este fixture exercita esse ramo direto, preservando a invariante de PRODUÇÃO
// (thinking + tool_choice forçado = 400 na API Anthropic) sem depender de uma
// entrada de registry adaptive. O `id` precisa ser um AIModelId válido; o que
// importa aqui é `thinkingMode: "adaptive"`.
const ADAPTIVE_MODEL: AIModel = {
  id: "claude-sonnet-4-5-20250929",
  provider: "anthropic",
  label: "Adaptive fixture (#374)",
  inputPricePerMTok: 3,
  outputPricePerMTok: 15,
  thinkingMode: "adaptive",
  userSelectable: true,
};

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
  it("adaptive (fixture #374): adaptive thinking, NO temperature/top_p/top_k", () => {
    const payload = build(ADAPTIVE_MODEL);

    // CRÍTICO: modelos adaptive dão 400 em sampling params; o builder DEVE omiti-los.
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("top_p");
    expect(payload).not.toHaveProperty("top_k");
    expect(payload.thinking).toEqual({ type: "adaptive" });
  });

  it("adaptive (fixture #374): tool_choice is 'auto' and NEVER pairs thinking with forced tool_choice", () => {
    const payload = build(ADAPTIVE_MODEL);

    // CRÍTICO: forced tool_choice + thinking dá 400 no caminho adaptive. O builder
    // DEVE usar `auto` — predict.ts trata a ausência do tool_use. Guarda de PRODUÇÃO
    // que sobrevive mesmo sem modelo adaptive no registry (#374).
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

describe("buildAnthropicRequest — calibração model-aware (effort/temperature)", () => {
  function buildWith(
    model: Parameters<typeof buildAnthropicRequest>[0]["model"],
    extra: { effort?: "low" | "medium" | "high" | "max"; temperature?: number },
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

  it("adaptive (fixture #374): effort vai em output_config; segue sem sampling", () => {
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

describe("MIN_EDGE_PP ↔ SYSTEM_PROMPT sync", () => {
  it("the UI threshold constant matches the prompt's edge rule", () => {
    // Se um prompt futuro mudar o threshold de 5pp, este teste quebra em vez
    // de a UI mentir. A constante mora em lib/odds/scenario.ts (não no cartucho)
    // pra não vazar o systemPrompt pro client bundle.
    expect(overUnderCartridge.systemPrompt).toContain(
      `${MIN_EDGE_PP} pontos percentuais`,
    );
  });
});
