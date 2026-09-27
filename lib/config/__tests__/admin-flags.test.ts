import { describe, expect, expectTypeOf, it } from "vitest";

import { MAX_ADDITIONAL_FETCHES, MAX_FANOUT_MARKETS } from "@/lib/ai/best-bet";
import {
  ADMIN_FLAGS,
  adminFlagDefaults,
  coerceStoredFlagValue,
  flagValueSchema,
  getAdminFlagDef,
  validateAdminFlagInput,
  type AdminFlagDef,
  type AdminFlagValues,
  type EnumFlagDef,
  type FlagValueOf,
} from "@/lib/config/admin-flags";

// Entrada enum FICTÍCIA (não está no registry real): exercita o caminho enum
// genérico numa coluna text que não é flag (`effort`), independente do
// analysisEngine real.
const FAKE_ENUM = {
  key: "effort",
  kind: "enum",
  label: "Motor de análise",
  description: "Qual motor gera a análise.",
  values: ["llm", "code_jev"],
  valueLabels: { llm: "LLM", code_jev: "Código (JEV)" },
  default: "llm",
} as const satisfies EnumFlagDef;
const FAKE_FLAGS = [...ADMIN_FLAGS, FAKE_ENUM] as const satisfies readonly AdminFlagDef[];

describe("ADMIN_FLAGS (registry, #514)", () => {
  it("tem as 5 flags boolean + o motor de análise (enum), sem key repetida", () => {
    const keys = ADMIN_FLAGS.map((f) => f.key);
    expect(keys).toEqual([
      "enableOverUnderExtraLines",
      "enableBestBetFanOut",
      "enableClvCapture",
      "enableFidelityValidation",
      "enableKellyStaking",
      "enableDixonColes",
      "analysisEngine",
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("toda entrada tem label e descrição não vazias", () => {
    for (const f of ADMIN_FLAGS) {
      expect(f.label.trim()).not.toBe("");
      expect(f.description.trim()).not.toBe("");
    }
  });

  it("defaults: as 3 flags de custo OFF, fidelidade e Kelly ON, motor 'llm' (espelham o schema)", () => {
    expect(adminFlagDefaults()).toEqual({
      enableOverUnderExtraLines: false,
      enableBestBetFanOut: false,
      enableClvCapture: false,
      enableFidelityValidation: true,
      enableKellyStaking: true,
      enableDixonColes: true,
      analysisEngine: "llm",
    });
  });

  it("nota de custo do fan-out casa com os tetos pinados em best-bet", () => {
    const note = getAdminFlagDef("enableBestBetFanOut").costNote ?? "";
    expect(note).toContain(`até ${MAX_FANOUT_MARKETS} chamadas pagas`);
    expect(note).toContain(`até ${MAX_ADDITIONAL_FETCHES} buscas`);
  });

  it("tipos: boolean nas flags boolean, união dos valores no motor", () => {
    expectTypeOf<AdminFlagValues>().toEqualTypeOf<{
      enableOverUnderExtraLines: boolean;
      enableBestBetFanOut: boolean;
      enableClvCapture: boolean;
      enableFidelityValidation: boolean;
      enableKellyStaking: boolean;
      enableDixonColes: boolean;
      analysisEngine: "llm" | "code_jev";
    }>();
  });

  it("tipos: entrada enum typecheca e o valor é a união dos valores", () => {
    expectTypeOf<FlagValueOf<typeof FAKE_ENUM>>().toEqualTypeOf<
      "llm" | "code_jev"
    >();
    const typo = {
      // @ts-expect-error — key tem que ser coluna de ai_config
      key: "enableKellyStakng",
      kind: "boolean",
      label: "x",
      description: "x",
      default: true,
    } satisfies AdminFlagDef;
    const enumOnBoolean = {
      key: "enableKellyStaking",
      kind: "enum",
      label: "x",
      description: "x",
      values: ["a"],
      default: "a",
      // @ts-expect-error — enum só em coluna text (erro reportado no satisfies)
    } satisfies AdminFlagDef;
    expect([typo, enumOnBoolean]).toHaveLength(2);
  });
});

describe("validateAdminFlagInput", () => {
  it("analysisEngine: aceita os motores do ADR 0041, recusa o resto", () => {
    expect(
      validateAdminFlagInput({ key: "analysisEngine", value: "code_jev" }),
    ).toEqual({ ok: true, key: "analysisEngine", value: "code_jev" });
    expect(
      validateAdminFlagInput({ key: "analysisEngine", value: "jev_direto" }),
    ).toEqual({ ok: false, error: "Valor inválido pra flag." });
  });

  it("aceita boolean vindo do form como 'true'/'false'", () => {
    expect(
      validateAdminFlagInput({ key: "enableClvCapture", value: "true" }),
    ).toEqual({ ok: true, key: "enableClvCapture", value: true });
    expect(
      validateAdminFlagInput({ key: "enableKellyStaking", value: "false" }),
    ).toEqual({ ok: true, key: "enableKellyStaking", value: false });
  });

  it.each([
    ["key fora do registry", "enableSomething", "true"],
    ["coluna de ai_config que não é flag", "defaultModelId", "true"],
    ["coluna text que não está no registry", "effort", "high"],
    ["prototype", "__proto__", "true"],
    ["key não-string", null, "true"],
  ])("recusa %s", (_desc, key, value) => {
    expect(validateAdminFlagInput({ key, value })).toEqual({
      ok: false,
      error: "Flag desconhecida.",
    });
  });

  it.each([["1"], ["yes"], ["TRUE"], [""], [null], [true]])(
    "recusa valor boolean malformado %j",
    (value) => {
      expect(
        validateAdminFlagInput({ key: "enableClvCapture", value }),
      ).toEqual({ ok: false, error: "Valor inválido pra flag." });
    },
  );

  it("enum fictício: aceita valor permitido, recusa o resto", () => {
    expect(
      validateAdminFlagInput({ key: "effort", value: "code_jev" }, FAKE_FLAGS),
    ).toEqual({ ok: true, key: "effort", value: "code_jev" });
    expect(
      validateAdminFlagInput({ key: "effort", value: "gpt" }, FAKE_FLAGS),
    ).toEqual({ ok: false, error: "Valor inválido pra flag." });
    expect(
      validateAdminFlagInput({ key: "effort", value: "true" }, FAKE_FLAGS).ok,
    ).toBe(false);
  });

  it("flagValueSchema do enum fictício só passa os valores declarados", () => {
    const schema = flagValueSchema(FAKE_ENUM);
    expect(schema.safeParse("llm").success).toBe(true);
    expect(schema.safeParse("LLM").success).toBe(false);
  });
});

describe("coerceStoredFlagValue", () => {
  const bool = getAdminFlagDef("enableFidelityValidation");

  it("boolean: usa o valor persistido; não-boolean cai no default", () => {
    expect(coerceStoredFlagValue(bool, false)).toBe(false);
    expect(coerceStoredFlagValue(bool, null)).toBe(true);
    expect(coerceStoredFlagValue(bool, "false")).toBe(true);
  });

  it("enum: valor fora da lista (enum encolheu / DB editado) cai no default", () => {
    expect(coerceStoredFlagValue(FAKE_ENUM, "code_jev")).toBe("code_jev");
    expect(coerceStoredFlagValue(FAKE_ENUM, "legacy")).toBe("llm");
    expect(coerceStoredFlagValue(FAKE_ENUM, undefined)).toBe("llm");
  });
});
