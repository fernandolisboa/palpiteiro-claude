import { describe, expect, it } from "vitest";

// Núcleo PURO do gate de replay eval (ADR 0021, #203) — sem API/db. Importar daqui
// NÃO dispara o gate pago: replay-eval-core.ts não tem main()/SDK (ao contrário de
// replay-prompt-eval.ts, coberto pelo guard sem-paga). Testa a bifurcação
// model-aware do flip (a única regra que o #203 mexe) e mantém os abortos globais
// (mediana de |Δconf|, errors) intocados.
import {
  ADAPTIVE_FLIP_REPRO_RUNS,
  classifyThinkingMode,
  computeVerdict,
  isAdaptiveFlipConfirmed,
  MAX_DELTA_CONF_MEDIAN_PP,
  median,
  pOver,
  replayModelFor,
  type VerdictRow,
} from "@/scripts/replay-eval-core";
import { MODEL_REGISTRY } from "@/lib/ai/models";

// Linha "limpa": sem flip, delta zero — não contribui pra reprovação por si só.
const clean = (over: Partial<VerdictRow> = {}): VerdictRow => ({
  thinkingMode: "temperature",
  flip: false,
  flipConfirmed: false,
  deltaConf: 0,
  ...over,
});

describe("classifyThinkingMode — bifurcação por caminho de amostragem", () => {
  it("os 3 modelos do registry (Opus/Sonnet/Haiku 5.5, ADR 0061) → adaptive (flip só conta se reproduzir)", () => {
    expect(classifyThinkingMode("claude-opus-5-5")).toBe("adaptive");
    expect(classifyThinkingMode("claude-sonnet-5-5")).toBe("adaptive");
    expect(classifyThinkingMode("claude-haiku-5-5")).toBe("adaptive");
  });

  it("id fora do registry (legado/removido) → temperature = ESTRITO (conservador)", () => {
    // Um payload de modelo aposentado é avaliado estrito: qualquer flip conta.
    // Nunca tolera flip de um modelo que não conseguimos classificar. Pós-#374 os
    // ids removidos (Opus 4.8, Sonnet 4.6 adaptive e o gpt-5-mini de prova) caem
    // AQUI — saíram do registry, então classificam pelo fallback estrito, não mais
    // pelo lookup. O gate de replay segue Anthropic-only e cerca rows não-anthropic.
    expect(classifyThinkingMode("claude-opus-4-8")).toBe("temperature");
    expect(classifyThinkingMode("claude-sonnet-4-6")).toBe("temperature");
    expect(classifyThinkingMode("gpt-5-mini")).toBe("temperature");
    expect(classifyThinkingMode("claude-fable-5")).toBe("temperature");
    // ADR 0061: os que saíram do registry também caem no estrito (payload antigo de
    // Sonnet 4.5/Haiku 4.5 era temperature de fato; Fable 5.1/Sonnet 5 não são
    // classificáveis sem o registry, então o conservador vale).
    expect(classifyThinkingMode("claude-sonnet-4-5-20250929")).toBe("temperature");
    expect(classifyThinkingMode("claude-haiku-4-5")).toBe("temperature");
    expect(classifyThinkingMode("claude-fable-5-1")).toBe("temperature");
    expect(classifyThinkingMode("claude-sonnet-5")).toBe("temperature");
    expect(classifyThinkingMode("lixo-qualquer")).toBe("temperature");
  });

  it("versão da família igual ou mais nova que a conferida (adotada, PLAN-608) → adaptive", () => {
    expect(classifyThinkingMode("claude-sonnet-5-6")).toBe("adaptive");
    expect(classifyThinkingMode("claude-haiku-5-6-20261101")).toBe("adaptive");
    expect(classifyThinkingMode("claude-opus-6")).toBe("adaptive");
    expect(classifyThinkingMode("claude-sonnet-5-5-20260301")).toBe("adaptive");
    // Mais antiga que a conferida ou fora do formato estrito → estrito.
    expect(classifyThinkingMode("claude-sonnet-5-4")).toBe("temperature");
    expect(classifyThinkingMode("claude-opus-5-5-preview")).toBe("temperature");
  });
});

describe("isAdaptiveFlipConfirmed — maioria de N runs", () => {
  it("N=3 (default): confirma com >= 2 flips, tolera com <= 1", () => {
    expect(ADAPTIVE_FLIP_REPRO_RUNS).toBe(3);
    expect(isAdaptiveFlipConfirmed(0, 3)).toBe(false);
    expect(isAdaptiveFlipConfirmed(1, 3)).toBe(false); // single-shot = ruído
    expect(isAdaptiveFlipConfirmed(2, 3)).toBe(true);
    expect(isAdaptiveFlipConfirmed(3, 3)).toBe(true);
  });

  it("ADAPTIVE_FLIP_REPRO_RUNS >= 3 (maioria significativa)", () => {
    // Com N=2 a maioria ceil(2/2)=1 anularia a tolerância (flip único confirmaria).
    expect(ADAPTIVE_FLIP_REPRO_RUNS).toBeGreaterThanOrEqual(3);
  });
});

describe("computeVerdict — flip model-aware; mediana/errors globais", () => {
  it("flip adaptive NÃO reproduzido → ruído tolerado, NÃO reprova", () => {
    const v = computeVerdict({
      results: [
        clean({ thinkingMode: "adaptive", flip: true, flipConfirmed: false }),
        clean(),
      ],
      errorCount: 0,
    });
    expect(v.failed).toBe(false);
    expect(v.confirmedFlips).toBe(0);
    expect(v.toleratedNoiseFlips).toBe(1);
  });

  it("flip adaptive REPRODUZIDO (maioria) → reprova", () => {
    const v = computeVerdict({
      results: [
        clean({ thinkingMode: "adaptive", flip: true, flipConfirmed: true }),
      ],
      errorCount: 0,
    });
    expect(v.failed).toBe(true);
    expect(v.confirmedFlips).toBe(1);
    expect(v.toleratedNoiseFlips).toBe(0);
  });

  it("flip no caminho temperature (single-shot) → reprova (estrito)", () => {
    // No caminho temperature o caller seta flipConfirmed === flip (sem rerun).
    const v = computeVerdict({
      results: [
        clean({ thinkingMode: "temperature", flip: true, flipConfirmed: true }),
      ],
      errorCount: 0,
    });
    expect(v.failed).toBe(true);
    expect(v.confirmedFlips).toBe(1);
    expect(v.toleratedNoiseFlips).toBe(0); // tolerância é SÓ do caminho adaptive
  });

  it("mediana |Δconf| > 5pp reprova sozinha (sem flip; aborto GLOBAL intocado)", () => {
    const v = computeVerdict({
      results: [
        clean({ deltaConf: 6 }),
        clean({ deltaConf: 7 }),
        clean({ deltaConf: 8 }),
      ],
      errorCount: 0,
    });
    expect(v.confirmedFlips).toBe(0);
    expect(v.medianDelta).toBe(7);
    expect(v.failed).toBe(true);
  });

  it("mediana exatamente no limite (5pp) NÃO reprova (> estrito)", () => {
    const v = computeVerdict({
      results: [clean({ deltaConf: 5 }), clean({ deltaConf: 5 })],
      errorCount: 0,
    });
    expect(v.medianDelta).toBe(MAX_DELTA_CONF_MEDIAN_PP);
    expect(v.failed).toBe(false);
  });

  it("errorCount > 0 reprova sozinho (aborto GLOBAL intocado)", () => {
    const v = computeVerdict({ results: [clean(), clean()], errorCount: 1 });
    expect(v.confirmedFlips).toBe(0);
    expect(v.failed).toBe(true);
  });

  it("amostra limpa (zero flip confirmado, mediana ok, zero erro) → APROVA", () => {
    const v = computeVerdict({
      results: [
        clean({ deltaConf: 1 }),
        clean({ thinkingMode: "adaptive", flip: true, flipConfirmed: false, deltaConf: 2 }),
      ],
      errorCount: 0,
    });
    expect(v.failed).toBe(false);
    expect(v.toleratedNoiseFlips).toBe(1);
  });
});

describe("helpers puros (median, pOver)", () => {
  it("median: ímpar = do meio, par = média dos centrais, vazio = 0", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it("pOver: identidade p/ over/pass, complemento p/ under", () => {
    expect(pOver("over", 70)).toBe(70);
    expect(pOver("pass", 55)).toBe(55);
    expect(pOver("under", 70)).toBe(30);
  });
});

describe("replayModelFor — em que modelo replayar a baseline (PLAN-608 S9)", () => {
  it("versão adotada (mais nova que a conferida) replaya nela mesma, custo pelo preço da conferida", () => {
    expect(replayModelFor("claude-sonnet-5-6")).toEqual({
      id: "claude-sonnet-5-6",
      costModel: { ...MODEL_REGISTRY["claude-sonnet-5-5"], id: "claude-sonnet-5-6" },
      adopted: true,
    });
    expect(replayModelFor("claude-opus-6-20270101")).toMatchObject({
      id: "claude-opus-6-20270101",
      adopted: true,
    });
  });

  it("conferida, versão antiga e Fable → a conferida da família (resolveModelId)", () => {
    expect(replayModelFor("claude-sonnet-5-5")).toEqual({
      id: "claude-sonnet-5-5",
      costModel: MODEL_REGISTRY["claude-sonnet-5-5"],
      adopted: false,
    });
    expect(replayModelFor("claude-haiku-4-5")?.id).toBe("claude-haiku-5-5");
    expect(replayModelFor("claude-sonnet-5-20260301")?.id).toBe("claude-sonnet-5-5");
    expect(replayModelFor("claude-fable-5-1")?.id).toBe("claude-opus-5-5");
    // `-preview` fica fora do formato estrito: não é adotada, cai na família.
    expect(replayModelFor("claude-sonnet-6-preview")).toMatchObject({
      id: "claude-sonnet-5-5",
      adopted: false,
    });
  });

  it("id que não é Claude → null", () => {
    expect(replayModelFor("gpt-5-mini")).toBeNull();
  });
});
