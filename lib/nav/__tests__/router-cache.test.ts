// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import {
  LIVE_REVISIT_MAX_AGE_MS,
  markRouterCacheStale,
  resetRouterCacheState,
  REVISIT_MAX_AGE_MS,
  shouldRevalidate,
} from "@/lib/nav/router-cache";

const T0 = 1_000_000;

describe("shouldRevalidate (#639)", () => {
  beforeEach(() => resetRouterCacheState());

  it("render novo (1ª montagem) não relê: acabou de vir do servidor", () => {
    expect(shouldRevalidate("a", REVISIT_MAX_AGE_MS, T0)).toBe(false);
  });

  it("reaberta do cache antes de 30s: fica como está", () => {
    shouldRevalidate("a", REVISIT_MAX_AGE_MS, T0);
    expect(shouldRevalidate("a", REVISIT_MAX_AGE_MS, T0 + 29_999)).toBe(false);
  });

  it("reaberta do cache com 30s ou mais: relê em segundo plano", () => {
    shouldRevalidate("a", REVISIT_MAX_AGE_MS, T0);
    expect(shouldRevalidate("a", REVISIT_MAX_AGE_MS, T0 + 30_000)).toBe(true);
  });

  it("a idade conta da 1ª vez que o id foi visto, não da última", () => {
    shouldRevalidate("a", REVISIT_MAX_AGE_MS, T0);
    shouldRevalidate("a", REVISIT_MAX_AGE_MS, T0 + 20_000);
    expect(shouldRevalidate("a", REVISIT_MAX_AGE_MS, T0 + 31_000)).toBe(true);
  });

  it("jogo ao vivo: qualquer reabertura depois de 1s relê", () => {
    shouldRevalidate("live", LIVE_REVISIT_MAX_AGE_MS, T0);
    expect(shouldRevalidate("live", LIVE_REVISIT_MAX_AGE_MS, T0 + 999)).toBe(false);
    expect(shouldRevalidate("live", LIVE_REVISIT_MAX_AGE_MS, T0 + 1_000)).toBe(true);
  });

  it("ids diferentes são independentes (cada render do servidor é um)", () => {
    shouldRevalidate("a", REVISIT_MAX_AGE_MS, T0);
    expect(shouldRevalidate("b", REVISIT_MAX_AGE_MS, T0 + 60_000)).toBe(false);
  });

  it("gravação fora do servidor: o que já estava guardado relê mesmo novo", () => {
    shouldRevalidate("antes", REVISIT_MAX_AGE_MS, T0);
    markRouterCacheStale(T0 + 5_000);
    expect(shouldRevalidate("antes", REVISIT_MAX_AGE_MS, T0 + 6_000)).toBe(true);
  });

  it("gravação fora do servidor: render visto depois da marca não relê", () => {
    markRouterCacheStale(T0);
    shouldRevalidate("depois", REVISIT_MAX_AGE_MS, T0 + 10);
    expect(shouldRevalidate("depois", REVISIT_MAX_AGE_MS, T0 + 1_000)).toBe(false);
  });

  it("id visto há mais de 1h é esquecido (volta a contar como novo)", () => {
    shouldRevalidate("velho", REVISIT_MAX_AGE_MS, T0);
    // Um id novo dispara a limpeza.
    shouldRevalidate("outro", REVISIT_MAX_AGE_MS, T0 + 60 * 60 * 1000 + 1);
    expect(
      shouldRevalidate("velho", REVISIT_MAX_AGE_MS, T0 + 60 * 60 * 1000 + 2),
    ).toBe(false);
  });
});
