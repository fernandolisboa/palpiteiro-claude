import { describe, expect, it } from "vitest";

import type { ProgressEvent } from "../protocol";
import {
  beginStep,
  isTrackingProgress,
  noteStep,
  progressMarketLabel,
  progressScope,
  setProgressMarketLabels,
  trackStep,
  withRunProgress,
} from "../run-progress";
import { STEPS } from "../steps";

function collect() {
  const events: ProgressEvent[] = [];
  return {
    events,
    send: (e: ProgressEvent) => events.push(e),
    seen: () => events.map((e) => `${e.id}:${e.status}`),
  };
}

describe("run-progress", () => {
  it("fora de um run tudo é no-op e o valor passa intacto", async () => {
    expect(isTrackingProgress()).toBe(false);
    await expect(trackStep(STEPS.odds, async () => 42)).resolves.toBe(42);
    beginStep(STEPS.odds).done();
    noteStep(STEPS.check);
    setProgressMarketLabels([{ key: "btts", label: "Ambas marcam" }]);
    expect(progressMarketLabel("btts")).toBeNull();
  });

  it("trackStep emite active → done com as frases do spec", async () => {
    const c = collect();
    await withRunProgress(c.send, () => trackStep(STEPS.odds, async () => "ok"));
    expect(c.events).toEqual([
      { t: "step", id: "odds", status: "active", label: STEPS.odds.active },
      { t: "step", id: "odds", status: "done", label: STEPS.odds.done },
    ]);
  });

  it("trackStep: o veredito escolhe o desfecho e a frase", async () => {
    const c = collect();
    await withRunProgress(c.send, () =>
      trackStep(STEPS.jev, async () => ({ reused: true }), (v) =>
        v.reused ? { status: "done", label: "reaproveitado" } : undefined,
      ),
    );
    expect(c.events.at(-1)).toMatchObject({ status: "done", label: "reaproveitado" });
  });

  it("trackStep: erro marca falha e repassa o erro", async () => {
    const c = collect();
    const boom = new Error("boom");
    await expect(
      withRunProgress(c.send, () =>
        trackStep(STEPS.sportsData, async () => {
          throw boom;
        }),
      ),
    ).rejects.toBe(boom);
    expect(c.seen()).toEqual(["sports_data:active", "sports_data:failed"]);
  });

  it("um veredito que lança não derruba o run", async () => {
    const c = collect();
    const v = await withRunProgress(c.send, () =>
      trackStep(STEPS.odds, async () => 1, () => {
        throw new Error("veredito");
      }),
    );
    expect(v).toBe(1);
    expect(c.seen()).toEqual(["odds:active", "odds:done"]);
  });

  it("progressScope fecha como falha a etapa aberta de um mercado que lançou", async () => {
    const c = collect();
    await withRunProgress(c.send, async () => {
      await progressScope(async () => {
        beginStep(STEPS.odds);
        throw new Error("sem odds");
      }).catch(() => undefined);
    });
    expect(c.seen()).toEqual(["odds:active", "odds:failed"]);
  });

  it("um handle fecha uma vez só", async () => {
    const c = collect();
    await withRunProgress(c.send, async () => {
      await progressScope(async () => {
        const step = beginStep(STEPS.odds);
        step.done();
        step.fail();
      });
    });
    expect(c.seen()).toEqual(["odds:active", "odds:done"]);
  });

  it("rótulos de mercado do run e etapas instantâneas", async () => {
    const c = collect();
    await withRunProgress(c.send, async () => {
      setProgressMarketLabels([{ key: "btts", label: "Ambas marcam" }]);
      expect(progressMarketLabel("btts")).toBe("Ambas marcam");
      expect(progressMarketLabel("assist")).toBeNull();
      noteStep(STEPS.news, "skipped");
    });
    expect(c.events).toEqual([
      { t: "step", id: "news", status: "skipped", label: STEPS.news.skipped },
    ]);
  });

  it("um send que lança (cliente saiu) não derruba o run", async () => {
    const v = await withRunProgress(
      () => {
        throw new Error("closed");
      },
      () => trackStep(STEPS.odds, async () => "ok"),
    );
    expect(v).toBe("ok");
  });

  it("runs concorrentes não se misturam", async () => {
    const a = collect();
    const b = collect();
    await Promise.all([
      withRunProgress(a.send, () => trackStep(STEPS.odds, async () => 1)),
      withRunProgress(b.send, () => trackStep(STEPS.jev, async () => 2)),
    ]);
    expect(a.seen()).toEqual(["odds:active", "odds:done"]);
    expect(b.seen()).toEqual(["jev:active", "jev:done"]);
  });
});
