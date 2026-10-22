import { afterEach, describe, expect, it, vi } from "vitest";

import { withBudget } from "@/lib/ai/predict";

// Prazo das buscas extras do state JEV na análise interativa (#617).
describe("withBudget", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sem prazo devolve a própria promise", async () => {
    await expect(withBudget(Promise.resolve(1), undefined)).resolves.toBe(1);
  });

  it("resolve antes do prazo → valor, sem timer pendente", async () => {
    vi.useFakeTimers();
    const p = withBudget(Promise.resolve("ok"), 8_000);
    await expect(p).resolves.toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passa do prazo → rejeita; a busca que perdeu não vira rejeição solta", async () => {
    vi.useFakeTimers();
    let rejectSlow!: (e: Error) => void;
    const slow = new Promise<string>((_, reject) => {
      rejectSlow = reject;
    });
    const p = withBudget(slow, 8_000);
    const assertion = expect(p).rejects.toThrow("exceeded 8000ms");
    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
    rejectSlow(new Error("tarde"));
    await Promise.resolve();
  });
});
