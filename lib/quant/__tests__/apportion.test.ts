import { describe, expect, it } from "vitest";

import { apportion, largestRemainder } from "@/lib/quant/apportion";

// PRNG determinístico (mulberry32): o teste de propriedade não pode variar entre runs.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe("largestRemainder", () => {
  it("soma o total e fica a menos de 1 de cada valor", () => {
    const r = largestRemainder([37.45, 30.3, 32.25], 100);
    expect(r).toEqual([38, 30, 32]);
    expect(sum(r)).toBe(100);
  });

  it("ignora ruído de ponto flutuante", () => {
    expect(
      largestRemainder([33.000000000004, 33.999999999996, 33], 100)
    ).toEqual([33, 34, 33]);
  });

  it("desempata pelo índice", () => {
    expect(largestRemainder([33.5, 33.5, 33], 100)).toEqual([34, 33, 33]);
  });

  it("nunca inverte a ordem de dois valores (propriedade)", () => {
    const r = rng(7);
    for (let n = 0; n < 500; n++) {
      const a = r();
      const b = r() * (1 - a);
      const v = [a * 100, b * 100, (1 - a - b) * 100];
      const out = largestRemainder(v, 100);
      expect(sum(out)).toBe(100);
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(out[i] - v[i])).toBeLessThan(1);
        for (let j = 0; j < 3; j++)
          if (v[i] > v[j]) expect(out[i]).toBeGreaterThanOrEqual(out[j]);
      }
    }
  });
});

describe("apportion", () => {
  it("alvo igual à soma dos arredondados: fica o arredondado", () => {
    expect(apportion([-1.9, -0.8, -0.4], -3)).toEqual([-2, -1, 0]);
  });

  it("alvo positivo acima do arredondado: +1 no de maior erro", () => {
    expect(apportion([1.4, 0.45, 0.3], 3)).toEqual([2, 1, 0]);
  });

  it("alvo negativo abaixo do arredondado", () => {
    expect(apportion([-1.4, -0.45, -0.3], -3)).toEqual([-2, -1, 0]);
  });

  it("alvo zero com crus que se anulam", () => {
    expect(apportion([-1.2, 1.1, 0.2], 0)).toEqual([-1, 1, 0]);
  });

  it("alvo ±2 longe do arredondado", () => {
    const out = apportion([0.4, 0.4, 0.4], 3)!;
    expect(out).toEqual([1, 1, 1]);
    expect(apportion([-0.2, -0.2], -2)).toEqual([-1, -1]);
  });

  it("com sinal: nunca dá ponto a quem o cru tirou", () => {
    // Um fator só, que tirou 0,1 do resultado, com a barra mostrando +1: não fecha.
    expect(apportion([-0.1], 1)).toBeNull();
    // Sem a regra de sinal, fecharia mentindo.
    expect(apportion([-0.1], 1, { signSafe: false })).toEqual([1]);
    // Com outro item positivo, o +1 vai pra ele.
    expect(apportion([-0.4, 0.3], 1)).toEqual([0, 1]);
  });

  it("com sinal: pode encolher um negativo até zero", () => {
    expect(apportion([-0.6, -0.1], 0)).toEqual([0, 0]);
  });

  it("é determinístico nos empates", () => {
    const a = apportion([0.5, 0.5, 0.5], 1);
    for (let i = 0; i < 10; i++)
      expect(apportion([0.5, 0.5, 0.5], 1)).toEqual(a);
    // 0,5 arredonda pra 1 nos três; os dois −1 saem dos primeiros índices.
    expect(a).toEqual([0, 0, 1]);
  });
});
