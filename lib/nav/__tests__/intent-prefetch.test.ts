// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { claimIntentPrefetch, resetIntentPrefetch } from "@/lib/nav/intent-prefetch";

const HERE = { pathname: "/jogos", search: "" };
const T0 = 1_000_000;

describe("claimIntentPrefetch (#639)", () => {
  beforeEach(() => resetIntentPrefetch());

  it("1ª passada do mouse num jogo: busca", () => {
    expect(claimIntentPrefetch("/match/1?back=%2Fjogos", HERE, T0)).toBe(true);
  });

  it("a mesma URL dentro de 30s não busca de novo", () => {
    claimIntentPrefetch("/match/1", HERE, T0);
    expect(claimIntentPrefetch("/match/1", HERE, T0 + 29_999)).toBe(false);
    expect(claimIntentPrefetch("/match/1", HERE, T0 + 30_000)).toBe(true);
  });

  it("URLs diferentes são independentes", () => {
    claimIntentPrefetch("/match/1", HERE, T0);
    expect(claimIntentPrefetch("/match/2", HERE, T0 + 1)).toBe(true);
  });

  it("a página atual nunca é buscada (inclui a query)", () => {
    expect(claimIntentPrefetch("/jogos", HERE, T0)).toBe(false);
    expect(
      claimIntentPrefetch("/jogos?league=x", { pathname: "/jogos", search: "?league=x" }, T0),
    ).toBe(false);
    expect(claimIntentPrefetch("/jogos?league=x", HERE, T0)).toBe(true);
  });
});
