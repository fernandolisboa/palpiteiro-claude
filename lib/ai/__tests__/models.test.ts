import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_MODEL_ID,
  FAMILY_LABEL,
  MODEL_REGISTRY,
  SELECTABLE_MODELS,
  UTILITY_MODEL_ID,
  claudeFamilyOf,
  isAIProvider,
  isModelAllowedForAudience,
  modelChoiceForAudience,
  modelsForAudience,
  parseClaudeVersion,
  pinnedModelFor,
  providerHasKey,
  resolveModelId,
} from "@/lib/ai/models";

// Ordem = capacidade decrescente (Opus > Sonnet > Haiku); a UI depende dela.
// ADR 0061 (#607): só os três 5.5, todos selecionáveis pelo usuário comum.
const ANTHROPIC_IDS = [
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
];

// Ids que já estiveram no registry e saíram: Opus 4.8 / Sonnet 4.6 / gpt-5-mini
// (#374), Fable 5 (#241) e, no ADR 0061, Fable 5.1, Sonnet 5, Sonnet 4.5 e Haiku 4.5.
// Permanecem como strings stale: NÃO estão no registry e NÃO passam o gate de
// audiência — predições históricas com esses ids renderizam graciosamente via
// formatModelName. (A leitura de preferência/default os RESOLVE pra família atual
// via resolveModelId; o gate cru continua recusando.)
const REMOVED_IDS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "gpt-5-mini",
  "claude-fable-5",
  "claude-fable-5-1",
  "claude-sonnet-5",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5",
];

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
  it("admin → os 3 Anthropic, em capacidade decrescente (a UI depende da ordem)", () => {
    const ids = modelsForAudience(true).map((m) => m.id);
    expect(ids).toEqual(ANTHROPIC_IDS);
  });

  it("usuário comum → os mesmos 3, mesma ordem (hoje não há admin-only)", () => {
    const ids = modelsForAudience(false).map((m) => m.id);
    expect(ids).toEqual(ANTHROPIC_IDS);
  });

  it("ids removidos não aparecem pra nenhuma audiência", () => {
    for (const id of REMOVED_IDS) {
      expect(modelsForAudience(true).map((m) => m.id)).not.toContain(id);
      expect(modelsForAudience(false).map((m) => m.id)).not.toContain(id);
    }
  });

  it("sem ANTHROPIC_API_KEY nenhum modelo aparece (provider inerte)", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(modelsForAudience(true)).toEqual([]);
    expect(modelsForAudience(false)).toEqual([]);
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
  it("os 3 modelos 5.5 são permitidos pra ambas as audiências", () => {
    for (const id of ANTHROPIC_IDS) {
      expect(isModelAllowedForAudience(id, true)).toBe(true);
      expect(isModelAllowedForAudience(id, false)).toBe(true);
    }
  });

  it("id inválido → false mesmo pra admin", () => {
    expect(isModelAllowedForAudience("gpt-4", true)).toBe(false);
  });

  it("ids removidos → false no gate cru (não resolve família aqui)", () => {
    for (const id of REMOVED_IDS) {
      expect(isModelAllowedForAudience(id, true)).toBe(false);
      expect(isModelAllowedForAudience(id, false)).toBe(false);
    }
  });

  it("nenhum admin-only no registry hoje; o gate segue userSelectable", () => {
    // Se um modelo virar admin-only, este teste força o autor a revisar o gating de
    // audiência de propósito.
    expect(
      SELECTABLE_MODELS.filter((m) => !m.userSelectable).map((m) => m.id),
    ).toEqual([]);
    for (const m of SELECTABLE_MODELS) {
      expect(isModelAllowedForAudience(m.id, false)).toBe(m.userSelectable);
    }
  });
});

describe("registry — sanidade dos modelos (ADR 0061)", () => {
  it("o registry tem exatamente os 3 modelos, na ordem Opus > Sonnet > Haiku", () => {
    expect(Object.keys(MODEL_REGISTRY)).toEqual(ANTHROPIC_IDS);
    expect(SELECTABLE_MODELS.map((m) => m.family)).toEqual([
      "opus",
      "sonnet",
      "haiku",
    ]);
  });

  it("Opus 5.5: pricing 4/20, família opus, deliberate, userSelectable, sem tarifa longa", () => {
    const m = MODEL_REGISTRY["claude-opus-5-5"];
    expect(m.provider).toBe("anthropic");
    expect(m.family).toBe("opus");
    expect(m.label).toBe("Opus");
    expect(m.inputPricePerMTok).toBe(4);
    expect(m.outputPricePerMTok).toBe(20);
    expect(m.speed).toBe("deliberate");
    expect(m.longPromptPricing).toBeUndefined();
    expect(m.userSelectable).toBe(true);
  });

  it("Sonnet 5.5: pricing 2/10, família sonnet, deliberate, userSelectable, sem tarifa longa", () => {
    const m = MODEL_REGISTRY["claude-sonnet-5-5"];
    expect(m.provider).toBe("anthropic");
    expect(m.family).toBe("sonnet");
    expect(m.label).toBe("Sonnet");
    expect(m.inputPricePerMTok).toBe(2);
    expect(m.outputPricePerMTok).toBe(10);
    expect(m.speed).toBe("deliberate");
    expect(m.longPromptPricing).toBeUndefined();
    expect(m.userSelectable).toBe(true);
  });

  it("Haiku 5.5: pricing 0.10/0.50, tarifa longa >100K = 0.50/2.50, fast, userSelectable", () => {
    const m = MODEL_REGISTRY["claude-haiku-5-5"];
    expect(m.provider).toBe("anthropic");
    expect(m.family).toBe("haiku");
    expect(m.label).toBe("Haiku (econômico)");
    expect(m.inputPricePerMTok).toBe(0.1);
    expect(m.outputPricePerMTok).toBe(0.5);
    expect(m.longPromptPricing).toEqual({
      aboveInputTokens: 100_000,
      inputPricePerMTok: 0.5,
      outputPricePerMTok: 2.5,
    });
    expect(m.speed).toBe("fast");
    expect(m.userSelectable).toBe(true);
  });

  it("speed: só o Haiku é fast; Opus e Sonnet são deliberate", () => {
    for (const m of SELECTABLE_MODELS) {
      expect(m.speed).toBe(m.family === "haiku" ? "fast" : "deliberate");
    }
  });

  it("nenhum modelo carrega mais thinkingMode/temperature (caminho único adaptive)", () => {
    for (const m of SELECTABLE_MODELS) {
      expect("thinkingMode" in m).toBe(false);
      expect("temperature" in m).toBe(false);
    }
  });

  it("todos os modelos do registry carregam provider:'anthropic'", () => {
    for (const m of SELECTABLE_MODELS) {
      expect(m.provider).toBe("anthropic");
    }
  });

  it("ids removidos não estão mais no registry", () => {
    for (const id of REMOVED_IDS) {
      expect(id in MODEL_REGISTRY).toBe(false);
    }
  });
});

describe("claudeFamilyOf — família de qualquer id claude-*", () => {
  it("ids atuais do registry", () => {
    expect(claudeFamilyOf("claude-opus-5-5")).toBe("opus");
    expect(claudeFamilyOf("claude-sonnet-5-5")).toBe("sonnet");
    expect(claudeFamilyOf("claude-haiku-5-5")).toBe("haiku");
  });

  it("ids antigos, com e sem data", () => {
    expect(claudeFamilyOf("claude-sonnet-4-5-20250929")).toBe("sonnet");
    expect(claudeFamilyOf("claude-sonnet-5")).toBe("sonnet");
    expect(claudeFamilyOf("claude-sonnet-4-6")).toBe("sonnet");
    expect(claudeFamilyOf("claude-haiku-4-5")).toBe("haiku");
    expect(claudeFamilyOf("claude-haiku-4-5-20251001")).toBe("haiku");
    expect(claudeFamilyOf("claude-opus-4-8")).toBe("opus");
    expect(claudeFamilyOf("claude-opus-4-5-20251101")).toBe("opus");
  });

  it("formato legado com a versão antes da família (claude-3-5-haiku-...)", () => {
    expect(claudeFamilyOf("claude-3-5-haiku-20241022")).toBe("haiku");
    expect(claudeFamilyOf("claude-3-5-sonnet-20241022")).toBe("sonnet");
    expect(claudeFamilyOf("claude-3-opus-20240229")).toBe("opus");
  });

  it("fable e mythos são reconhecidos como famílias próprias", () => {
    expect(claudeFamilyOf("claude-fable-5-1")).toBe("fable");
    expect(claudeFamilyOf("claude-fable-5")).toBe("fable");
    expect(claudeFamilyOf("claude-mythos-1")).toBe("mythos");
  });

  it("id que não é Claude (ou família desconhecida) → null", () => {
    expect(claudeFamilyOf("gpt-5-mini")).toBeNull();
    expect(claudeFamilyOf("jev-1.13.0")).toBeNull();
    expect(claudeFamilyOf("")).toBeNull();
    expect(claudeFamilyOf("claude-")).toBeNull();
    expect(claudeFamilyOf("claude-instant-1")).toBeNull();
    // A família tem que ser um segmento inteiro, não prefixo de outra palavra.
    expect(claudeFamilyOf("claude-sonnetx-5")).toBeNull();
  });
});

describe("resolveModelId — id gravado/não-confiável → modelo atual da família", () => {
  it("id atual passa como está", () => {
    for (const id of ANTHROPIC_IDS) {
      expect(resolveModelId(id)).toBe(id);
    }
  });

  it("Haiku antigo → Haiku 5.5", () => {
    expect(resolveModelId("claude-haiku-4-5")).toBe("claude-haiku-5-5");
    expect(resolveModelId("claude-3-5-haiku-20241022")).toBe("claude-haiku-5-5");
  });

  it("Sonnet 4.5 (datado) e Sonnet 5 → Sonnet 5.5", () => {
    expect(resolveModelId("claude-sonnet-4-5-20250929")).toBe(
      "claude-sonnet-5-5",
    );
    expect(resolveModelId("claude-sonnet-5")).toBe("claude-sonnet-5-5");
  });

  it("Opus 4.x (inclusive datado) e Fable/Mythos → Opus 5.5", () => {
    expect(resolveModelId("claude-opus-4-8")).toBe("claude-opus-5-5");
    expect(resolveModelId("claude-opus-4-5-20251101")).toBe("claude-opus-5-5");
    expect(resolveModelId("claude-fable-5-1")).toBe("claude-opus-5-5");
    expect(resolveModelId("claude-mythos-1")).toBe("claude-opus-5-5");
  });

  it("desconhecido, vazio, null ou undefined → null (o caller cai no default)", () => {
    expect(resolveModelId("gpt-5-mini")).toBeNull();
    expect(resolveModelId("modelo-inexistente")).toBeNull();
    expect(resolveModelId("")).toBeNull();
    expect(resolveModelId(null)).toBeNull();
    expect(resolveModelId(undefined)).toBeNull();
  });
});

describe("modelChoiceForAudience — resolveModelId + gate de audiência", () => {
  it("id atual → ele mesmo, pra ambas as audiências", () => {
    expect(modelChoiceForAudience("claude-haiku-5-5", false)).toBe(
      "claude-haiku-5-5",
    );
    expect(modelChoiceForAudience("claude-opus-5-5", true)).toBe(
      "claude-opus-5-5",
    );
  });

  it("id antigo (aba aberta antes do deploy) → 5.5 da família, e passa o gate", () => {
    expect(modelChoiceForAudience("claude-sonnet-4-5-20250929", false)).toBe(
      "claude-sonnet-5-5",
    );
    expect(modelChoiceForAudience("claude-haiku-4-5", false)).toBe(
      "claude-haiku-5-5",
    );
    expect(modelChoiceForAudience("claude-fable-5-1", false)).toBe(
      "claude-opus-5-5",
    );
    expect(modelChoiceForAudience("claude-fable-5-1", true)).toBe(
      "claude-opus-5-5",
    );
  });

  it("o resolvido segue o gate: o resultado bate com isModelAllowedForAudience", () => {
    for (const raw of [...ANTHROPIC_IDS, ...REMOVED_IDS]) {
      for (const isAdmin of [true, false]) {
        const choice = modelChoiceForAudience(raw, isAdmin);
        const resolved = resolveModelId(raw);
        expect(choice).toBe(
          resolved && isModelAllowedForAudience(resolved, isAdmin)
            ? resolved
            : null,
        );
      }
    }
  });

  it("id desconhecido ou vazio → null mesmo pra admin", () => {
    expect(modelChoiceForAudience("gpt-5-mini", true)).toBeNull();
    expect(modelChoiceForAudience("", true)).toBeNull();
    expect(modelChoiceForAudience("lixo", false)).toBeNull();
  });
});

describe("DEFAULT_MODEL_ID — default global (ADR 0061)", () => {
  // SENTINEL: o default da análise é o Sonnet 5.5 (meio-termo de custo). Mudar exige
  // atualizar este teste + a row de ai_config. O default NÃO é o primeiro do registry.
  it("é o Sonnet 5.5, Anthropic, e não o primeiro do registry", () => {
    expect(DEFAULT_MODEL_ID).toBe("claude-sonnet-5-5");
    expect(DEFAULT_MODEL_ID).not.toBe(SELECTABLE_MODELS[0].id);
    expect(MODEL_REGISTRY[DEFAULT_MODEL_ID].provider).toBe("anthropic");
  });

  it("é userSelectable (invariante do ADR 0013: o default vale pra TODOS)", () => {
    expect(MODEL_REGISTRY[DEFAULT_MODEL_ID].userSelectable).toBe(true);
    expect(isModelAllowedForAudience(DEFAULT_MODEL_ID, false)).toBe(true);
  });
});

describe("UTILITY_MODEL_ID — modelo das tarefas internas baratas", () => {
  it("é o Haiku 5.5, no registry (pricing/custo resolvem daqui)", () => {
    expect(UTILITY_MODEL_ID).toBe("claude-haiku-5-5");
    expect(MODEL_REGISTRY[UTILITY_MODEL_ID].family).toBe("haiku");
    expect(MODEL_REGISTRY[UTILITY_MODEL_ID].speed).toBe("fast");
  });
});

describe("parseClaudeVersion — versão de um id das três famílias (PLAN-608)", () => {
  it("major sem minor vale .0", () => {
    expect(parseClaudeVersion("claude-sonnet-6")).toEqual({
      family: "sonnet",
      major: 6,
      minor: 0,
      snapshot: null,
    });
  });

  it("major + snapshot (sem minor) vale .0 com snapshot", () => {
    expect(parseClaudeVersion("claude-sonnet-5-20260301")).toEqual({
      family: "sonnet",
      major: 5,
      minor: 0,
      snapshot: "20260301",
    });
  });

  it("major.minor com e sem snapshot", () => {
    expect(parseClaudeVersion("claude-haiku-5-6-20261101")).toEqual({
      family: "haiku",
      major: 5,
      minor: 6,
      snapshot: "20261101",
    });
    expect(parseClaudeVersion("claude-opus-5-5")).toEqual({
      family: "opus",
      major: 5,
      minor: 5,
      snapshot: null,
    });
  });

  it("os três conferidos do registry são reconhecidos", () => {
    for (const id of ANTHROPIC_IDS) {
      expect(parseClaudeVersion(id)).not.toBeNull();
    }
  });

  it("formato antigo, outra família, sufixo e lixo → null", () => {
    expect(parseClaudeVersion("claude-3-5-haiku-20241022")).toBeNull();
    expect(parseClaudeVersion("claude-fable-5-1")).toBeNull();
    expect(parseClaudeVersion("claude-mythos-1")).toBeNull();
    expect(parseClaudeVersion("claude-opus-5-5-preview")).toBeNull();
    expect(parseClaudeVersion("claude-opus-5-5[1m]")).toBeNull();
    expect(parseClaudeVersion("claude-sonnet-123")).toBeNull();
    expect(parseClaudeVersion("claude-sonnet")).toBeNull();
    expect(parseClaudeVersion("gpt-5-mini")).toBeNull();
    expect(parseClaudeVersion("")).toBeNull();
  });
});

describe("pinnedModelFor / FAMILY_LABEL", () => {
  it("a conferida de cada família é a entrada do registry", () => {
    expect(pinnedModelFor("opus")).toBe(MODEL_REGISTRY["claude-opus-5-5"]);
    expect(pinnedModelFor("sonnet")).toBe(MODEL_REGISTRY["claude-sonnet-5-5"]);
    expect(pinnedModelFor("haiku")).toBe(MODEL_REGISTRY["claude-haiku-5-5"]);
  });

  it("família ↔ conferida casam e os conferidos não têm `adopted`", () => {
    for (const m of Object.values(MODEL_REGISTRY)) {
      expect(pinnedModelFor(m.family).id).toBe(m.id);
      expect(m.adopted).toBeUndefined();
    }
  });

  it("rótulo da família", () => {
    expect(FAMILY_LABEL).toEqual({ opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" });
  });
});
