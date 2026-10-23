import { describe, expect, it } from "vitest";

import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";

import {
  MAX_DETAIL_LINES,
  encodeStreamMessage,
  parseReasoning,
  parseStreamLine,
  toHeroRunOutcome,
  type StreamMessage,
} from "../protocol";
import {
  STEP_NOTES,
  STEPS,
  decideStep,
  marketStep,
  narrationStep,
  synthesisStep,
  type StepSpec,
} from "../steps";

describe("protocolo NDJSON", () => {
  it("ida e volta de cada mensagem", () => {
    const step = { t: "step", id: "odds", status: "done", label: "x" } as const;
    expect(parseStreamLine(encodeStreamMessage(step))).toEqual(step);
    expect(parseStreamLine(encodeStreamMessage({ t: "ping" }))).toEqual({ t: "ping" });
    const result = {
      t: "result",
      outcome: { ok: true, analysis: true, contextNotice: "aviso" },
    } as const;
    expect(parseStreamLine(encodeStreamMessage(result))).toEqual(result);
    const failure = { t: "result", outcome: { ok: false, error: "Falhou." } } as const;
    expect(parseStreamLine(encodeStreamMessage(failure))).toEqual(failure);
  });

  it("linha fora do protocolo vira null", () => {
    expect(parseStreamLine("")).toBeNull();
    expect(parseStreamLine("{")).toBeNull();
    expect(parseStreamLine("42")).toBeNull();
    expect(parseStreamLine('{"t":"step","id":"x","status":"weird","label":"y"}')).toBeNull();
    expect(parseStreamLine('{"t":"result","outcome":{"ok":true}}')).toBeNull();
    expect(parseStreamLine('{"t":"other"}')).toBeNull();
  });

  it("detail da etapa: ida e volta; lixo cai fora; teto de linhas", () => {
    const step: StreamMessage = {
      t: "step",
      id: "model",
      status: "done",
      label: "x",
      detail: ["Gols esperados: A 1,4, B 1,1"],
    };
    expect(parseStreamLine(encodeStreamMessage(step))).toEqual(step);
    expect(
      parseStreamLine('{"t":"step","id":"x","status":"done","label":"y","detail":[1,"",null]}'),
    ).toEqual({ t: "step", id: "x", status: "done", label: "y" });
    const many = JSON.stringify({
      t: "step",
      id: "x",
      status: "done",
      label: "y",
      detail: Array.from({ length: 40 }, (_, i) => `l${i}`),
    });
    const parsed = parseStreamLine(many);
    expect(parsed?.t === "step" && parsed.detail).toHaveLength(MAX_DETAIL_LINES);
  });

  it("parseReasoning: lê o jsonb gravado e descarta o que não tem a forma", () => {
    expect(parseReasoning(undefined)).toBeNull();
    expect(parseReasoning("x")).toBeNull();
    expect(parseReasoning([])).toBeNull();
    expect(
      parseReasoning([
        { id: "odds", status: "done", label: "Preços lidos", detail: ["Ambas marcam"] },
        { id: "jev", status: "active", label: "consultando" },
        { id: "news", status: "skipped", label: "" },
        { id: 3, status: "done", label: "x" },
        { id: "check", status: "failed", label: "Não bateu", detail: "x" },
      ]),
    ).toEqual([
      { id: "odds", status: "done", label: "Preços lidos", detail: ["Ambas marcam"] },
      { id: "check", status: "failed", label: "Não bateu" },
    ]);
  });

  it("toHeroRunOutcome: run completo, só o palpite e falha", () => {
    expect(
      toHeroRunOutcome({
        ok: true,
        view: { entries: [], errors: [] } as never,
        palpite: null,
        palpiteError: "sem manchete",
        contextNotice: "aviso",
      }),
    ).toEqual({ ok: true, analysis: true, palpiteError: "sem manchete", contextNotice: "aviso" });
    expect(toHeroRunOutcome({ ok: true, palpite: null })).toEqual({
      ok: true,
      analysis: false,
    });
    expect(toHeroRunOutcome({ ok: false, error: "Falhou." })).toEqual({
      ok: false,
      error: "Falhou.",
    });
  });
});

describe("copy das etapas (firewall ADR 0030 §3, sem casa de aposta)", () => {
  const specs: StepSpec[] = [
    ...Object.values(STEPS),
    decideStep("Dupla chance"),
    decideStep(null),
    narrationStep({ family: "sonnet", marketLabel: "Ambas marcam", live: false }),
    narrationStep({ family: "haiku", marketLabel: null, live: true }),
    marketStep("correct_score", "Placar exato", "opus"),
    marketStep("assist", null, "sonnet"),
    synthesisStep(false),
    synthesisStep(true),
  ];
  const phrases = [
    ...specs.flatMap((s) => [s.active, s.done, s.failed, s.skipped ?? ""]),
    ...Object.values(STEP_NOTES),
  ].filter(Boolean);

  it("nenhuma frase tem número de valor, % ou dígito de tempo", () => {
    for (const phrase of phrases) {
      expect(containsValueLanguage(phrase), phrase).toBe(false);
      expect(phrase, phrase).not.toMatch(/%|\d/);
    }
  });

  it("nenhuma frase cita casa de aposta", () => {
    for (const phrase of phrases) {
      expect(phrase.toLowerCase(), phrase).not.toMatch(
        /bet365|betano|pinnacle|betfair|sportingbet|casa de aposta|bookmaker/,
      );
    }
  });

  it("ids únicos e estáveis por etapa", () => {
    const ids = Object.values(STEPS).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(marketStep("btts", "Ambas marcam", "sonnet").id).toBe("market:btts");
  });
});
