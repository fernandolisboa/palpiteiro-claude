import { describe, expect, it, vi } from "vitest";

import { coalesceInFlight } from "@/lib/cache/in-flight";
import { InMemoryCacheStore } from "@/lib/cache/in-memory";

describe("coalesceInFlight", () => {
  it("chamadas concorrentes pra mesma chave dividem UM fetch", async () => {
    const cache = new InMemoryCacheStore();
    let resolve!: (v: string) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );
    const a = coalesceInFlight(cache, "k", fetcher);
    const b = coalesceInFlight(cache, "k", fetcher);
    resolve("v");
    await expect(Promise.all([a, b])).resolves.toEqual(["v", "v"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("chaves diferentes e caches diferentes não se misturam", async () => {
    const c1 = new InMemoryCacheStore();
    const c2 = new InMemoryCacheStore();
    const fetcher = vi.fn(async () => "v");
    await Promise.all([
      coalesceInFlight(c1, "a", fetcher),
      coalesceInFlight(c1, "b", fetcher),
      coalesceInFlight(c2, "a", fetcher),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("depois de resolvida ou rejeitada a chave sai do mapa (erro não fica memorizado)", async () => {
    const cache = new InMemoryCacheStore();
    const failing = vi.fn(async () => {
      throw new Error("boom");
    });
    const a = coalesceInFlight(cache, "k", failing);
    const b = coalesceInFlight(cache, "k", failing);
    await expect(a).rejects.toThrow("boom");
    await expect(b).rejects.toThrow("boom");
    expect(failing).toHaveBeenCalledTimes(1);

    const ok = vi.fn(async () => "v");
    await expect(coalesceInFlight(cache, "k", ok)).resolves.toBe("v");
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
