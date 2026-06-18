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

const ANTHROPIC_IDS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5",
];

// modelsForAudience é KEY-GATED (ADR 0027): um modelo cujo provider não tem chave
// some da seleção. Estado-base dos testes = espelho de PROD: ANTHROPIC_API_KEY
// presente, OPENAI_API_KEY ausente ⇒ gpt-5-mini inerte. Restaura o env no afterEach
// (mesmo padrão dos testes de absences togglando SPORTMONKS_API_TOKEN).
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
  it("admin (sem OPENAI key) → os 4 Anthropic, em capacidade decrescente (a UI depende da ordem)", () => {
    const ids = modelsForAudience(true).map((m) => m.id);
    // gpt-5-mini é inerte sem OPENAI_API_KEY → admin vê só os 4 Anthropic.
    expect(ids).toEqual(ANTHROPIC_IDS);
    expect(ids).toHaveLength(4);
  });

  it("usuário comum → os 4 userSelectable Anthropic (ambos Sonnets: #240 + #241)", () => {
    const ids = modelsForAudience(false).map((m) => m.id);
    expect(ids).toEqual(ANTHROPIC_IDS);
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

describe("provider de prova OpenAI — admin-only + key-gated inerte (ADR 0027 / #231)", () => {
  it("sem OPENAI_API_KEY: gpt-5-mini é INERTE — some de TODAS as audiências", () => {
    // beforeEach já garante OPENAI_API_KEY ausente.
    expect(modelsForAudience(true).map((m) => m.id)).not.toContain("gpt-5-mini");
    expect(modelsForAudience(false).map((m) => m.id)).not.toContain(
      "gpt-5-mini",
    );
  });

  it("COM OPENAI_API_KEY: gpt-5-mini aparece pro ADMIN (último, ordem estável), nunca pro comum", () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    const adminIds = modelsForAudience(true).map((m) => m.id);
    // Os 4 Anthropic mantêm as posições; gpt-5-mini entra POR ÚLTIMO.
    expect(adminIds).toEqual([...ANTHROPIC_IDS, "gpt-5-mini"]);
    // userSelectable:false ⇒ NUNCA pro usuário comum, mesmo com chave.
    expect(modelsForAudience(false).map((m) => m.id)).toEqual(ANTHROPIC_IDS);
  });

  it("gpt-5-mini é admin-only no registry (preserva a reprodutibilidade do ADR 0021)", () => {
    expect(MODEL_REGISTRY["gpt-5-mini"].userSelectable).toBe(false);
    // Com chave, o gate de audiência é o que barra o usuário comum.
    process.env.OPENAI_API_KEY = "test-openai-key";
    expect(isModelAllowedForAudience("gpt-5-mini", false)).toBe(false);
    expect(isModelAllowedForAudience("gpt-5-mini", true)).toBe(true);
  });

  it("providerHasKey reflete o env por provider", () => {
    expect(providerHasKey("anthropic")).toBe(true); // setado no beforeEach
    expect(providerHasKey("openai")).toBe(false); // ausente no beforeEach
    process.env.OPENAI_API_KEY = "test-openai-key";
    expect(providerHasKey("openai")).toBe(true);
  });

  it("isAIProvider valida strings contra o allowlist", () => {
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

  it("gpt-5-mini (admin-only): NUNCA permitido pro usuário comum", () => {
    expect(isModelAllowedForAudience("gpt-5-mini", false)).toBe(false);
    expect(isModelAllowedForAudience("gpt-5-mini", true)).toBe(true);
  });

  it("id inválido → false mesmo pra admin", () => {
    expect(isModelAllowedForAudience("gpt-4", true)).toBe(false);
  });

  it("id stale/removido (ex.: 'claude-fable-5') → false (cai graciosamente)", () => {
    expect(isModelAllowedForAudience("claude-fable-5", true)).toBe(false);
    expect(isModelAllowedForAudience("claude-fable-5", false)).toBe(false);
  });

  it("todo modelo ANTHROPIC do registry passa pro comum (regra de flag userSelectable)", () => {
    // gpt-5-mini é a EXCEÇÃO admin-only (coberta acima); os Anthropic seguem todos
    // userSelectable. Se um futuro modelo Anthropic voltar a ser admin-only, este
    // loop falha e força o autor a reintroduzir a asserção admin-only específica.
    for (const m of SELECTABLE_MODELS.filter((x) => x.provider === "anthropic")) {
      expect(m.userSelectable).toBe(true);
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

  it("todos os modelos Anthropic carregam provider:'anthropic'", () => {
    for (const id of ANTHROPIC_IDS) {
      expect(MODEL_REGISTRY[id as keyof typeof MODEL_REGISTRY].provider).toBe(
        "anthropic",
      );
    }
  });

  it("gpt-5-mini: provider 'openai', pricing finito>0, thinkingMode temperature, admin-only", () => {
    const m = MODEL_REGISTRY["gpt-5-mini"];
    expect(m.provider).toBe("openai");
    // Pricing VERIFY-BEFORE-MERGE (jun/2026: 0.25 in / 2.0 out) — sentinela de drift.
    expect(m.inputPricePerMTok).toBe(0.25);
    expect(m.outputPricePerMTok).toBe(2.0);
    expect(m.thinkingMode).toBe("temperature");
    expect(m.userSelectable).toBe(false);
  });

  it("o Fable foi removido do registry (#241)", () => {
    expect("claude-fable-5" in MODEL_REGISTRY).toBe(false);
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
