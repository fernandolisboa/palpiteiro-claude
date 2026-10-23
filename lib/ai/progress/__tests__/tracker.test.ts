import { describe, expect, it } from "vitest";

import { MAX_DETAIL_LINES, type ProgressEvent } from "../protocol";
import { createProgressTracker } from "../tracker";

function setup() {
  const events: ProgressEvent[] = [];
  const tracker = createProgressTracker((e) => events.push(e));
  const seen = () => events.map((e) => `${e.id}:${e.status}:${e.label}`);
  return { tracker, seen };
}

describe("createProgressTracker", () => {
  it("uma instância: active e depois o fim", () => {
    const { tracker, seen } = setup();
    tracker.start("odds", "lendo");
    tracker.end("odds", "done", "lido");
    expect(seen()).toEqual(["odds:active:lendo", "odds:done:lido"]);
  });

  it("instâncias sobrepostas (fan-out paralelo) viram uma linha só, que fecha com a última", () => {
    const { tracker, seen } = setup();
    tracker.start("sports_data", "lendo");
    tracker.start("sports_data", "lendo");
    tracker.end("sports_data", "done", "lido");
    expect(seen()).toEqual(["sports_data:active:lendo"]);
    tracker.end("sports_data", "done", "lido");
    expect(seen()).toEqual(["sports_data:active:lendo", "sports_data:done:lido"]);
  });

  it("o melhor desfecho da janela vence: uma falha não pinta a etapa se outra leu", () => {
    const { tracker, seen } = setup();
    tracker.start("odds", "lendo");
    tracker.start("odds", "lendo");
    tracker.end("odds", "failed", "faltou");
    tracker.end("odds", "done", "lido");
    expect(seen().at(-1)).toBe("odds:done:lido");
  });

  it("todas falham → falha", () => {
    const { tracker, seen } = setup();
    tracker.start("odds", "lendo");
    tracker.end("odds", "failed", "faltou");
    expect(seen().at(-1)).toBe("odds:failed:faltou");
  });

  it("depois de done, uma releitura (cache do mercado seguinte) não reabre a linha", () => {
    const { tracker, seen } = setup();
    tracker.start("sports_data", "lendo");
    tracker.end("sports_data", "done", "lido");
    tracker.start("sports_data", "lendo");
    tracker.end("sports_data", "failed", "faltou");
    expect(seen()).toEqual(["sports_data:active:lendo", "sports_data:done:lido"]);
  });

  it("depois de falha, uma nova tentativa reabre e pode terminar bem", () => {
    const { tracker, seen } = setup();
    tracker.start("odds", "lendo");
    tracker.end("odds", "failed", "faltou");
    tracker.start("odds", "lendo");
    tracker.end("odds", "done", "lido");
    expect(seen()).toEqual([
      "odds:active:lendo",
      "odds:failed:faltou",
      "odds:active:lendo",
      "odds:done:lido",
    ]);
  });

  it("note: etapa instantânea vira linha terminal; não sobrescreve done nem uma em voo", () => {
    const { tracker, seen } = setup();
    tracker.note("check", "done", "conferido");
    tracker.note("check", "failed", "não");
    tracker.start("jev", "consultando");
    tracker.note("jev", "done", "x");
    expect(seen()).toEqual(["check:done:conferido", "jev:active:consultando"]);
  });

  it("end sem start é ignorado", () => {
    const { tracker, seen } = setup();
    tracker.end("odds", "done", "lido");
    expect(seen()).toEqual([]);
  });

  it("detail: junta as linhas das instâncias, sem repetir, e sai com o fim", () => {
    const events: ProgressEvent[] = [];
    const tracker = createProgressTracker((e) => events.push(e));
    tracker.start("odds", "lendo");
    tracker.start("odds", "lendo");
    tracker.detail("odds", ["Ambas marcam"]);
    tracker.end("odds", "done", "lido");
    tracker.detail("odds", ["Ambas marcam", "Resultado"]);
    tracker.end("odds", "done", "lido");
    expect(events.at(-1)).toEqual({
      t: "step",
      id: "odds",
      status: "done",
      label: "lido",
      detail: ["Ambas marcam", "Resultado"],
    });
  });

  it("detail depois de done reenvia a linha (o mercado seguinte acrescenta o nome)", () => {
    const events: ProgressEvent[] = [];
    const tracker = createProgressTracker((e) => events.push(e));
    tracker.start("odds", "lendo");
    tracker.detail("odds", ["Ambas marcam"]);
    tracker.end("odds", "done", "lido");
    tracker.start("odds", "lendo");
    tracker.detail("odds", ["Resultado"]);
    tracker.end("odds", "failed", "faltou");
    expect(events.map((e) => `${e.status}:${(e.detail ?? []).join("|")}`)).toEqual([
      "active:",
      "done:Ambas marcam",
      "done:Ambas marcam|Resultado",
    ]);
    // Linha repetida não reenvia nada.
    tracker.detail("odds", ["Resultado"]);
    expect(events).toHaveLength(3);
  });

  it("detail tem teto de linhas", () => {
    const events: ProgressEvent[] = [];
    const tracker = createProgressTracker((e) => events.push(e));
    tracker.note("news", "done", "lidas");
    tracker.detail(
      "news",
      Array.from({ length: 30 }, (_, i) => `linha ${i}`),
    );
    expect(events.at(-1)?.detail).toHaveLength(MAX_DETAIL_LINES);
  });

  it("snapshot: só etapas terminadas, na ordem em que começaram, com o que encontraram", () => {
    const tracker = createProgressTracker(() => {});
    tracker.start("sports_data", "lendo");
    tracker.note("news", "skipped", "sem tempo");
    tracker.detail("sports_data", ["Forma"]);
    tracker.end("sports_data", "done", "lido");
    tracker.start("synthesis", "montando");
    expect(tracker.snapshot()).toEqual([
      { id: "sports_data", status: "done", label: "lido", detail: ["Forma"] },
      { id: "news", status: "skipped", label: "sem tempo" },
    ]);
    // A etapa que fecha com a gravação entra por último, depois do que a alimentou.
    tracker.note("check", "done", "conferido");
    expect(tracker.snapshot({ id: "synthesis", label: "pronto" }).map((s) => s.id)).toEqual([
      "sports_data",
      "news",
      "check",
      "synthesis",
    ]);
    expect(tracker.snapshot({ id: "synthesis", label: "pronto" }).at(-1)).toEqual({
      id: "synthesis",
      status: "done",
      label: "pronto",
    });
  });
});
