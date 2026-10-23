import { describe, expect, it } from "vitest";

import type { ProgressEvent } from "../protocol";
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
});
