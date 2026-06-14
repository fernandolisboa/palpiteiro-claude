import { describe, expect, it } from "vitest";

import {
  MODEL_REGISTRY,
  SELECTABLE_MODELS,
  isModelAllowedForAudience,
  modelsForAudience,
} from "@/lib/ai/models";

describe("modelsForAudience — gating por audiência (ADR 0013)", () => {
  it("admin → todos os 4 modelos, em capacidade decrescente (a UI depende da ordem)", () => {
    const ids = modelsForAudience(true).map((m) => m.id);
    expect(ids).toEqual(SELECTABLE_MODELS.map((m) => m.id));
    expect(ids).toEqual([
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-sonnet-4-5-20250929",
      "claude-haiku-4-5",
    ]);
    expect(ids).toHaveLength(4);
  });

  it("usuário comum → os 4 userSelectable (ambos Sonnets agora selecionáveis: #240 + #241)", () => {
    // Após promover Sonnet 4.5 (#240) e remover o Fable (#241), NENHUM modelo do
    // registry é admin-only → admin e usuário comum enxergam exatamente a mesma
    // lista. O filtro de audiência continua aplicado (defesa), só que não há mais
    // o que filtrar.
    const ids = modelsForAudience(false).map((m) => m.id);
    expect(ids).toEqual([
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-sonnet-4-5-20250929",
      "claude-haiku-4-5",
    ]);
  });

  it("ambos os Sonnets aparecem pro usuário comum (4.5 promovido em #240)", () => {
    const ids = modelsForAudience(false).map((m) => m.id);
    expect(ids).toContain("claude-sonnet-4-6");
    expect(ids).toContain("claude-sonnet-4-5-20250929");
  });

  it("o Fable foi removido do registry (#241) — não aparece pra nenhuma audiência", () => {
    expect(modelsForAudience(true).map((m) => m.id)).not.toContain(
      "claude-fable-5",
    );
    expect(modelsForAudience(false).map((m) => m.id)).not.toContain(
      "claude-fable-5",
    );
  });
});

describe("isModelAllowedForAudience — invariante de gating (ADR 0013)", () => {
  // Após #240 + #241 não sobra NENHUM modelo admin-only real no registry. O
  // gating genérico (id no registry + flag de audiência) continua coberto via os
  // ids reais abaixo; a invariante específica "admin-only nunca passa pro comum"
  // é exercitada com um id fora do registry (o caminho `!isAIModelId` já barra),
  // mais um teste de unidade direto da regra de flag mais abaixo.
  it("Sonnet 4.5 (promovido): permitido pra ambas as audiências", () => {
    expect(isModelAllowedForAudience("claude-sonnet-4-5-20250929", true)).toBe(
      true,
    );
    expect(isModelAllowedForAudience("claude-sonnet-4-5-20250929", false)).toBe(
      true,
    );
  });

  it("Haiku 4.5: permitido pro usuário comum", () => {
    expect(isModelAllowedForAudience("claude-haiku-4-5", false)).toBe(true);
  });

  it("id inválido → false mesmo pra admin", () => {
    expect(isModelAllowedForAudience("gpt-4", true)).toBe(false);
  });

  it("id stale/removido (ex.: 'claude-fable-5') → false (cai graciosamente)", () => {
    // Garante que um preferredModelId/override antigo do Fable salvo no DB não
    // é mais aceito após a remoção — o gate o trata como id desconhecido e a
    // cascata de predict recai no default global.
    expect(isModelAllowedForAudience("claude-fable-5", true)).toBe(false);
    expect(isModelAllowedForAudience("claude-fable-5", false)).toBe(false);
  });

  it("a regra de flag userSelectable continua coberta (todo modelo do registry passa pro comum hoje)", () => {
    // Defesa-em-profundidade documentada: a regra é `isAdmin || userSelectable`.
    // Como todo modelo do registry é userSelectable, todos passam pro comum.
    // Se um futuro modelo voltar a ser admin-only, este loop falha e força o
    // autor a reintroduzir uma asserção admin-only específica.
    for (const m of SELECTABLE_MODELS) {
      expect(m.userSelectable).toBe(true);
      expect(isModelAllowedForAudience(m.id, false)).toBe(true);
    }
  });
});

describe("registry — sanidade dos modelos", () => {
  it("Sonnet 4.5: pricing 3/15, temperature 0.3, AGORA userSelectable (#240)", () => {
    const m = MODEL_REGISTRY["claude-sonnet-4-5-20250929"];
    expect(m.inputPricePerMTok).toBe(3);
    expect(m.outputPricePerMTok).toBe(15);
    expect(m.thinkingMode).toBe("temperature");
    expect(m.temperature).toBe(0.3);
    expect(m.userSelectable).toBe(true);
  });

  it("Haiku 4.5: pricing 1/5, temperature 0.3, userSelectable", () => {
    const m = MODEL_REGISTRY["claude-haiku-4-5"];
    expect(m.inputPricePerMTok).toBe(1);
    expect(m.outputPricePerMTok).toBe(5);
    expect(m.thinkingMode).toBe("temperature");
    expect(m.temperature).toBe(0.3);
    expect(m.userSelectable).toBe(true);
  });

  it("ambos os Sonnets selecionáveis (#240); Opus 4.8 também", () => {
    expect(MODEL_REGISTRY["claude-opus-4-8"].userSelectable).toBe(true);
    expect(MODEL_REGISTRY["claude-sonnet-4-6"].userSelectable).toBe(true);
    expect(MODEL_REGISTRY["claude-sonnet-4-5-20250929"].userSelectable).toBe(
      true,
    );
  });

  it("o Fable foi removido do registry (#241)", () => {
    expect("claude-fable-5" in MODEL_REGISTRY).toBe(false);
  });
});
