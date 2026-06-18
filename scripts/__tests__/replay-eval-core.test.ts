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
  type VerdictRow,
} from "@/scripts/replay-eval-core";

// Linha "limpa": sem flip, delta zero — não contribui pra reprovação por si só.
const clean = (over: Partial<VerdictRow> = {}): VerdictRow => ({
  thinkingMode: "temperature",
  flip: false,
  flipConfirmed: false,
  deltaConf: 0,
  ...over,
});

describe("classifyThinkingMode — bifurcação por caminho de amostragem", () => {
  it("Sonnet 4.5 / Haiku → temperature (estrito)", () => {
    expect(classifyThinkingMode("claude-sonnet-4-5-20250929")).toBe("temperature");
    expect(classifyThinkingMode("claude-haiku-4-5")).toBe("temperature");
  });

  it("Opus 4.8 / Sonnet 4.6 → adaptive (sujeito a reprodução)", () => {
    expect(classifyThinkingMode("claude-opus-4-8")).toBe("adaptive");
    expect(classifyThinkingMode("claude-sonnet-4-6")).toBe("adaptive");
  });

  it("id fora do registry (legado/removido) → temperature = ESTRITO (conservador)", () => {
    // Um payload de modelo aposentado (ex.: Fable) é avaliado estrito: qualquer flip
    // conta. Nunca tolera flip de um modelo que não conseguimos classificar.
    expect(classifyThinkingMode("claude-fable-5")).toBe("temperature");
    expect(classifyThinkingMode("lixo-qualquer")).toBe("temperature");
  });

  it("gpt-5-mini (OpenAI, #231) → temperature por LOOKUP no registry (não pelo fallback)", () => {
    // O provider de prova OpenAI está NO registry com thinkingMode "temperature"
    // (ADR 0027): classifyThinkingMode devolve o modo DECLARADO, não o fallback de
    // id-desconhecido. (O gate de replay segue Anthropic-only e cerca rows OpenAI;
    // este assert só garante que, se classificado, é o caminho ESTRITO.)
    expect(classifyThinkingMode("gpt-5-mini")).toBe("temperature");
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
