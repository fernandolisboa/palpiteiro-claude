import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

import { addUsage, NO_USAGE, usageFromMessage } from "../usage";

// ADR 0071: na API, `input_tokens` é só a parte NÃO cacheada do prompt. O uso neutro
// guarda o TOTAL em `inputTokens` (a métrica de tamanho de prompt de sempre) e a escrita
// e a leitura de cache em separado, pra `calculateCost` precificar cada parte.
function apiUsage(u: Partial<Anthropic.Usage>): Anthropic.Usage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    ...u,
  } as Anthropic.Usage;
}

describe("usageFromMessage", () => {
  it("sem cache (campos null): total = input_tokens, cache 0", () => {
    expect(
      usageFromMessage(apiUsage({ input_tokens: 1200, output_tokens: 300 }))
    ).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  });

  it("escrita no cache: total soma a parte escrita", () => {
    expect(
      usageFromMessage(
        apiUsage({
          input_tokens: 800,
          cache_creation_input_tokens: 2000,
          output_tokens: 300,
        })
      )
    ).toEqual({
      inputTokens: 2800,
      outputTokens: 300,
      cacheCreationInputTokens: 2000,
      cacheReadInputTokens: 0,
    });
  });

  it("leitura do cache: total soma a parte lida", () => {
    expect(
      usageFromMessage(
        apiUsage({
          input_tokens: 800,
          cache_read_input_tokens: 2000,
          output_tokens: 300,
        })
      )
    ).toEqual({
      inputTokens: 2800,
      outputTokens: 300,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 2000,
    });
  });

  it("valores inválidos viram 0 (anti-NaN no custo)", () => {
    expect(
      usageFromMessage(
        apiUsage({
          input_tokens: Number.NaN,
          output_tokens: -1,
          cache_read_input_tokens: undefined as unknown as null,
        })
      )
    ).toEqual(NO_USAGE);
  });
});

describe("addUsage", () => {
  it("soma campo a campo (retomadas de pause_turn)", () => {
    expect(
      addUsage(
        {
          inputTokens: 10,
          outputTokens: 1,
          cacheCreationInputTokens: 5,
          cacheReadInputTokens: 0,
        },
        {
          inputTokens: 20,
          outputTokens: 2,
          cacheCreationInputTokens: 3,
          cacheReadInputTokens: 7,
        }
      )
    ).toEqual({
      inputTokens: 30,
      outputTokens: 3,
      cacheCreationInputTokens: 8,
      cacheReadInputTokens: 7,
    });
  });
});
