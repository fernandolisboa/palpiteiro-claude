import { afterEach, describe, expect, it, vi } from "vitest";

import { parseRunSnapshot, parseStreamLine, encodeStreamMessage } from "../protocol";
import { createRunMarkerWriter, readRunMarker } from "../run-marker";

// Sem KV no teste: o marcador cai no cache em memória do processo (como em dev).
const MATCH = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

function writer(userId: string) {
  return createRunMarkerWriter({
    userId,
    matchId: MATCH,
    runId: "run-1",
    intent: "analysis",
    live: false,
    intervalMs: 1_000,
  });
}

const step = (id: string, status: "active" | "done", label = id) =>
  ({ t: "step", id, status, label }) as const;

afterEach(() => {
  vi.useRealTimers();
});

describe("marcador do run (adendo da ADR 0064)", () => {
  it("sem nenhuma etapa (parou nos gates), não grava nada", async () => {
    const w = writer("u-gates");
    await w.finish({ ok: false, error: "limite" });
    expect(await readRunMarker("u-gates", MATCH)).toBeNull();
  });

  it("a 1ª etapa grava na hora; as seguintes, no máximo uma vez por intervalo", async () => {
    vi.useFakeTimers();
    const w = writer("u-throttle");
    w.step(step("sports_data", "active"));
    await vi.advanceTimersByTimeAsync(0);
    expect((await readRunMarker("u-throttle", MATCH))?.steps).toHaveLength(1);

    w.step(step("sports_data", "done"));
    w.step(step("jev", "active"));
    await vi.advanceTimersByTimeAsync(500);
    expect((await readRunMarker("u-throttle", MATCH))?.steps).toEqual([
      { id: "sports_data", status: "active", label: "sports_data" },
    ]);
    await vi.advanceTimersByTimeAsync(600);
    expect((await readRunMarker("u-throttle", MATCH))?.steps).toEqual([
      { id: "sports_data", status: "done", label: "sports_data" },
      { id: "jev", status: "active", label: "jev" },
    ]);
  });

  it("o desfecho nunca é sobrescrito por uma etapa atrasada", async () => {
    vi.useFakeTimers();
    const w = writer("u-finish");
    w.step(step("odds", "active"));
    w.step(step("odds", "done"));
    await w.finish({ ok: true, analysis: true });
    w.step(step("late", "active"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await readRunMarker("u-finish", MATCH)).toEqual({
      runId: "run-1",
      intent: "analysis",
      live: false,
      status: "done",
      steps: [{ id: "odds", status: "done", label: "odds" }],
      outcome: { ok: true, analysis: true },
    });
  });

  it("por pessoa: o run de uma não aparece pra outra", async () => {
    const w = writer("u-owner");
    w.step(step("odds", "active"));
    await w.finish({ ok: true, analysis: false });
    expect(await readRunMarker("u-owner", MATCH)).not.toBeNull();
    expect(await readRunMarker("u-other", MATCH)).toBeNull();
  });
});

describe("parseRunSnapshot", () => {
  it("descarta forma estranha e etapas inválidas", () => {
    expect(parseRunSnapshot(null)).toBeNull();
    expect(parseRunSnapshot({ runId: "r", intent: "x", status: "running", steps: [] })).toBeNull();
    expect(
      parseRunSnapshot({
        runId: "r",
        intent: "palpite",
        live: true,
        status: "running",
        steps: [{ id: "a", status: "active", label: "A" }, { id: 1 }, "x"],
        outcome: { ok: "talvez" },
      }),
    ).toEqual({
      runId: "r",
      intent: "palpite",
      live: true,
      status: "running",
      steps: [{ id: "a", status: "active", label: "A" }],
      outcome: null,
    });
  });

  it("a linha do id do run vai e volta no stream", () => {
    expect(parseStreamLine(encodeStreamMessage({ t: "run", id: "abc" }))).toEqual({
      t: "run",
      id: "abc",
    });
    expect(parseStreamLine(JSON.stringify({ t: "run", id: "" }))).toBeNull();
  });
});
