import { describe, expect, it } from "vitest";

import { MODEL_REGISTRY } from "@/lib/ai/models";
import type { ApiModelInfo } from "@/lib/ai/providers/anthropic/models-catalog";

import {
  checkCapabilities,
  isRegression,
  missingPinnedIds,
  pickCandidate,
} from "../candidates";

const OK_CAPS = {
  batch: { supported: true },
  citations: { supported: true },
  code_execution: { supported: true },
  context_management: {
    clear_thinking_20251015: null,
    clear_tool_uses_20250919: null,
    compact_20260112: null,
    supported: true,
  },
  effort: {
    supported: true,
    low: { supported: true },
    medium: { supported: true },
    high: { supported: true },
    max: { supported: true },
    xhigh: { supported: true },
  },
  image_input: { supported: true },
  pdf_input: { supported: true },
  structured_outputs: { supported: true },
  thinking: {
    supported: true,
    types: { adaptive: { supported: true }, enabled: { supported: false } },
  },
};

function api(
  id: string,
  createdAt = "2026-11-01T00:00:00Z",
  over: Partial<ApiModelInfo> = {},
): ApiModelInfo {
  return {
    id,
    displayName: id,
    createdAt,
    capabilities: structuredClone(OK_CAPS),
    maxTokens: 128_000,
    ...over,
  };
}

function pick(
  apiModels: ApiModelInfo[],
  opts: { family?: "opus" | "sonnet" | "haiku"; activeId?: string | null; knownIds?: string[] } = {},
): string | null {
  const family = opts.family ?? "sonnet";
  return (
    pickCandidate({
      family,
      apiModels,
      pinnedId: `claude-${family}-5-5`,
      activeId: opts.activeId ?? null,
      knownIds: opts.knownIds ?? [],
    })?.id ?? null
  );
}

describe("pickCandidate (ADR 0062, B1/S3)", () => {
  it("só versão MAIOR que a conferida, da mesma família", () => {
    expect(
      pick([
        api("claude-sonnet-5-5"),
        api("claude-sonnet-5"),
        api("claude-sonnet-4-5-20250929"),
        api("claude-opus-5-6"),
      ]),
    ).toBeNull();
    expect(pick([api("claude-sonnet-5-6"), api("claude-sonnet-5-5")])).toBe(
      "claude-sonnet-5-6",
    );
  });

  it("B1: major sem minor vale x.0 — claude-sonnet-6 entra, claude-sonnet-5-20260301 (5.0) não", () => {
    expect(pick([api("claude-sonnet-6")])).toBe("claude-sonnet-6");
    expect(pick([api("claude-sonnet-5-20260301")])).toBeNull();
  });

  it("B1: snapshot datado com minor (claude-haiku-5-6-20261101) é 5.6", () => {
    expect(pick([api("claude-haiku-5-6-20261101")], { family: "haiku" })).toBe(
      "claude-haiku-5-6-20261101",
    );
  });

  it("formato estrito: -preview, formato antigo e outras famílias ficam de fora", () => {
    expect(
      pick([
        api("claude-sonnet-6-preview"),
        api("claude-3-5-sonnet-20241022"),
        api("claude-fable-6"),
        api("text-embedding-x"),
      ]),
    ).toBeNull();
  });

  it("a maior versão vence; major novo entra", () => {
    expect(
      pick([api("claude-sonnet-5-6"), api("claude-sonnet-6"), api("claude-sonnet-5-7")]),
    ).toBe("claude-sonnet-6");
  });

  it("mesma versão: alias antes do snapshot; entre snapshots, o created_at mais novo", () => {
    expect(
      pick([
        api("claude-sonnet-5-6-20261101", "2026-11-01T00:00:00Z"),
        api("claude-sonnet-5-6", "2026-10-01T00:00:00Z"),
      ]),
    ).toBe("claude-sonnet-5-6");
    expect(
      pick([
        api("claude-sonnet-5-6-20261101", "2026-11-01T00:00:00Z"),
        api("claude-sonnet-5-6-20261201", "2026-12-01T00:00:00Z"),
      ]),
    ).toBe("claude-sonnet-5-6-20261201");
  });

  it("tem que ser maior que a ativa também", () => {
    const models = [api("claude-sonnet-5-6"), api("claude-sonnet-5-7")];
    expect(pick(models, { activeId: "claude-sonnet-5-7" })).toBeNull();
    expect(pick(models, { activeId: "claude-sonnet-5-6" })).toBe("claude-sonnet-5-7");
  });

  it("S3: descarta a versão que já tem row, em qualquer status, mesmo com outro id (alias × snapshot)", () => {
    expect(
      pick([api("claude-sonnet-5-6"), api("claude-sonnet-5-6-20261101")], {
        knownIds: ["claude-sonnet-5-6-20261101"],
      }),
    ).toBeNull();
    // Uma versão reprovada não bloqueia a próxima.
    expect(
      pick([api("claude-sonnet-5-6"), api("claude-sonnet-5-7")], {
        knownIds: ["claude-sonnet-5-6"],
      }),
    ).toBe("claude-sonnet-5-7");
    // Row de outra família com o mesmo número não conta.
    expect(pick([api("claude-sonnet-5-6")], { knownIds: ["claude-opus-5-6"] })).toBe(
      "claude-sonnet-5-6",
    );
  });
});

describe("checkCapabilities (S4)", () => {
  it("completa e max_tokens ≥ 32000 → ok", () => {
    expect(checkCapabilities(api("claude-sonnet-5-6"))).toEqual({ ok: true });
    expect(checkCapabilities(api("x", undefined, { maxTokens: 32_000 }))).toEqual({
      ok: true,
    });
  });

  it("capabilities null → transitório (tenta amanhã), não reprovação", () => {
    expect(checkCapabilities(api("x", undefined, { capabilities: null }))).toMatchObject({
      ok: false,
      transient: true,
    });
  });

  it.each([
    ["sem adaptive", (c: typeof OK_CAPS) => (c.thinking.types.adaptive.supported = false), "adaptive"],
    ["sem effort", (c: typeof OK_CAPS) => (c.effort.supported = false), "sem effort"],
    ["sem effort low", (c: typeof OK_CAPS) => (c.effort.low.supported = false), "low"],
    ["sem effort max", (c: typeof OK_CAPS) => (c.effort.max.supported = false), "max"],
    [
      "xhigh null",
      (c: typeof OK_CAPS) => ((c.effort as { xhigh: unknown }).xhigh = null),
      "xhigh",
    ],
    ["xhigh false", (c: typeof OK_CAPS) => (c.effort.xhigh.supported = false), "xhigh"],
  ])("%s → reprova", (_name, mutate, reason) => {
    const m = api("x");
    mutate(m.capabilities as unknown as typeof OK_CAPS);
    const v = checkCapabilities(m);
    expect(v).toMatchObject({ ok: false, transient: false });
    expect(v.ok === false && v.reason).toContain(reason);
  });

  it("max_tokens null ou < 32000 → reprova", () => {
    for (const maxTokens of [null, 31_999]) {
      expect(checkCapabilities(api("x", undefined, { maxTokens }))).toMatchObject({
        ok: false,
        transient: false,
      });
    }
  });
});

describe("missingPinnedIds (S8)", () => {
  const PINNED = Object.keys(MODEL_REGISTRY);

  it("alias ou snapshot datado conta como presente", () => {
    expect(
      missingPinnedIds(PINNED, [
        api("claude-opus-5-5"),
        api("claude-sonnet-5-5-20260901"),
        api("claude-haiku-5-5"),
      ]),
    ).toEqual([]);
  });

  it("aponta a conferida que sumiu (um id com prefixo parecido não conta)", () => {
    expect(
      missingPinnedIds(PINNED, [api("claude-opus-5-5"), api("claude-sonnet-5-5-1"), api("claude-haiku-5-5")]),
    ).toEqual(["claude-sonnet-5-5"]);
  });
});

describe("isRegression (S2)", () => {
  it("menos de 10 chamadas da adotada → nunca", () => {
    expect(isRegression({ total: 9, bad: 9 }, { total: 100, bad: 0 })).toBe(false);
  });

  it("precisa de ≥ 2× E ≥ +15pp da conferida", () => {
    // 30% contra 10%: 3× e +20pp → regride.
    expect(isRegression({ total: 10, bad: 3 }, { total: 100, bad: 10 })).toBe(true);
    // 20% contra 10%: 2× mas só +10pp → não.
    expect(isRegression({ total: 10, bad: 2 }, { total: 100, bad: 10 })).toBe(false);
    // 50% contra 40%: +10pp e < 2× → não.
    expect(isRegression({ total: 10, bad: 5 }, { total: 100, bad: 40 })).toBe(false);
    // Base 0% (com chamadas): precisa de 15%.
    expect(isRegression({ total: 20, bad: 3 }, { total: 10, bad: 0 })).toBe(true);
    expect(isRegression({ total: 20, bad: 2 }, { total: 10, bad: 0 })).toBe(false);
  });

  it("base com menos de 10 chamadas → não julga", () => {
    expect(isRegression({ total: 20, bad: 20 }, { total: 0, bad: 0 })).toBe(false);
    expect(isRegression({ total: 20, bad: 20 }, { total: 9, bad: 0 })).toBe(false);
    expect(isRegression({ total: 20, bad: 20 }, { total: 10, bad: 0 })).toBe(true);
  });
});
