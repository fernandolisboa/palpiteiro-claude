import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_MODEL_ID,
  MODEL_REGISTRY,
  SELECTABLE_MODELS,
  isAIProvider,
  isModelAllowedForAudience,
  modelsForAudience,
  providerHasKey,
} from "@/lib/ai/models";

const ANTHROPIC_IDS = ["claude-sonnet-4-5-20250929", "claude-haiku-4-5"];

// Ids removidos do registry em #374 (eram Opus 4.8 + Sonnet 4.6 adaptive + o
// gpt-5-mini de prova OpenAI). Permanecem como strings stale: NÃO estão no
// registry e NÃO passam o gate de audiência — predições históricas com esses ids
// renderizam graciosamente via formatModelName (padrão #241).
const REMOVED_IDS = ["claude-opus-4-8", "claude-sonnet-4-6", "gpt-5-mini"];

// modelsForAudience é KEY-GATED (ADR 0027): um modelo cujo provider não tem chave
// some da seleção. O seam OpenAI segue RETIDO no código (#374) mas SEM modelo de
// registry. Estado-base dos testes = espelho de PROD: ANTHROPIC_API_KEY presente,
// OPENAI_API_KEY ausente. Restaura o env no afterEach (mesmo padrão dos testes de
// absences togglando SPORTMONKS_API_TOKEN).
let prevAnthropic: string | undefined;
let prevOpenai: string | undefined;
beforeEach(() => {
  prevAnthropic = process.env.ANTHROPIC_API_KEY;
  prevOpenai = process.env.OPENAI_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  delete process.env.OPENAI_API_KEY;
});
afterEach(() => {
  if (prevAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = prevAnthropic;
  if (prevOpenai === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevOpenai;
});

describe("modelsForAudience — gating por audiência (ADR 0013) + key-gate (ADR 0027)", () => {
  it("admin → os 2 Anthropic (Sonnet 4.5, Haiku), em capacidade decrescente (a UI depende da ordem)", () => {
    const ids = modelsForAudience(true).map((m) => m.id);
    expect(ids).toEqual(ANTHROPIC_IDS);
    expect(ids).toHaveLength(2);
  });

  it("usuário comum → os 2 userSelectable Anthropic", () => {
    const ids = modelsForAudience(false).map((m) => m.id);
    expect(ids).toEqual(ANTHROPIC_IDS);
    expect(ids).toHaveLength(2);
  });

  it("Sonnet 4.5 (default) e Haiku aparecem pro usuário comum", () => {
    const ids = modelsForAudience(false).map((m) => m.id);
    expect(ids).toContain("claude-sonnet-4-5-20250929");
    expect(ids).toContain("claude-haiku-4-5");
  });

  it("ids removidos (#374 + Fable #241) não aparecem pra nenhuma audiência", () => {
    for (const id of [...REMOVED_IDS, "claude-fable-5"]) {
      expect(modelsForAudience(true).map((m) => m.id)).not.toContain(id);
      expect(modelsForAudience(false).map((m) => m.id)).not.toContain(id);
    }
  });
});

describe("seam AIProvider preservado (ADR 0027) — sem modelo OpenAI no registry (#374)", () => {
  it("o gpt-5-mini de prova foi removido do registry, mas o seam OpenAI continua válido", () => {
    // O MODELO saiu (não há entrada de registry openai); o SEAM (AIProviderKey,
    // isAIProvider, providerHasKey) permanece intacto para um provider futuro.
    expect("gpt-5-mini" in MODEL_REGISTRY).toBe(false);
    // Mesmo com a chave OpenAI presente, nenhum modelo OpenAI entra na seleção.
    process.env.OPENAI_API_KEY = "test-openai-key";
    expect(modelsForAudience(true).map((m) => m.id)).toEqual(ANTHROPIC_IDS);
  });

  it("providerHasKey reflete o env por provider (seam intacto)", () => {
    expect(providerHasKey("anthropic")).toBe(true); // setado no beforeEach
    expect(providerHasKey("openai")).toBe(false); // ausente no beforeEach
    process.env.OPENAI_API_KEY = "test-openai-key";
    expect(providerHasKey("openai")).toBe(true);
  });

  it("isAIProvider valida strings contra o allowlist (anthropic + openai)", () => {
    expect(isAIProvider("anthropic")).toBe(true);
    expect(isAIProvider("openai")).toBe(true);
    expect(isAIProvider("gemini")).toBe(false);
    expect(isAIProvider("")).toBe(false);
  });
});

describe("isModelAllowedForAudience — invariante de gating (ADR 0013)", () => {
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

  it("ids removidos (#374 + Fable #241) → false (caem graciosamente)", () => {
    for (const id of [...REMOVED_IDS, "claude-fable-5"]) {
      expect(isModelAllowedForAudience(id, true)).toBe(false);
      expect(isModelAllowedForAudience(id, false)).toBe(false);
    }
  });

  it("todo modelo do registry passa pro comum (todos userSelectable pós-#374)", () => {
    // Pós-#374 não há mais modelo admin-only no registry. Se um futuro modelo
    // voltar a ser admin-only (userSelectable:false), este loop falha e força o
    // autor a reintroduzir a asserção admin-only específica.
    expect(SELECTABLE_MODELS.every((m) => m.userSelectable)).toBe(true);
    for (const m of SELECTABLE_MODELS) {
      expect(isModelAllowedForAudience(m.id, false)).toBe(true);
    }
  });
});

describe("registry — sanidade dos modelos", () => {
  it("Sonnet 4.5: pricing 3/15, temperature 0.3, AGORA userSelectable (#240)", () => {
    const m = MODEL_REGISTRY["claude-sonnet-4-5-20250929"];
    expect(m.provider).toBe("anthropic");
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

  it("todos os modelos do registry carregam provider:'anthropic' (pós-#374)", () => {
    for (const id of ANTHROPIC_IDS) {
      expect(MODEL_REGISTRY[id as keyof typeof MODEL_REGISTRY].provider).toBe(
        "anthropic",
      );
    }
  });

  it("o registry tem exatamente 2 modelos (Sonnet 4.5 + Haiku, #374)", () => {
    expect(Object.keys(MODEL_REGISTRY)).toEqual(ANTHROPIC_IDS);
  });

  it("ids removidos (#374 + Fable #241) não estão mais no registry", () => {
    for (const id of [...REMOVED_IDS, "claude-fable-5"]) {
      expect(id in MODEL_REGISTRY).toBe(false);
    }
  });
});

describe("DEFAULT_MODEL_ID — default global (ADR 0021, #203)", () => {
  // SENTINEL: o default da análise está TRAVADO no Sonnet 4.5 (caminho temperature,
  // reproduzível — ADR 0021). Mudar exige atualizar este teste + a row de ai_config.
  // O provider de prova OpenAI (#231) NÃO move o default.
  it("é o Sonnet 4.5 (não mais o Opus 4.8 do ADR 0008, nem o OpenAI de prova)", () => {
    expect(DEFAULT_MODEL_ID).toBe("claude-sonnet-4-5-20250929");
    expect(DEFAULT_MODEL_ID).not.toBe("claude-opus-4-8");
    expect(DEFAULT_MODEL_ID).not.toBe("gpt-5-mini");
    expect(MODEL_REGISTRY[DEFAULT_MODEL_ID].provider).toBe("anthropic");
  });

  it("é userSelectable (invariante do ADR 0013: o default vale pra TODOS)", () => {
    expect(MODEL_REGISTRY[DEFAULT_MODEL_ID].userSelectable).toBe(true);
    expect(isModelAllowedForAudience(DEFAULT_MODEL_ID, false)).toBe(true);
  });

  it("é caminho temperature (reproduzível — a razão de ser do ADR 0021)", () => {
    expect(MODEL_REGISTRY[DEFAULT_MODEL_ID].thinkingMode).toBe("temperature");
  });
});
