import { describe, expect, it } from "vitest";

import { apportionTable, largestRemainder } from "@/lib/quant/apportion";

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

const colSums = (t: readonly (readonly number[])[], cols: number) =>
  Array.from({ length: cols }, (_, k) => sum(t.map((r) => r[k])));

// Nenhum inteiro contradiz o cru: 0 ou o sinal dele.
const signOk = (v: number, raw: number) =>
  v === 0 || Math.sign(v) === Math.sign(raw);

describe("apportionTable", () => {
  it("alvos iguais às somas dos arredondados: fica o arredondado", () => {
    expect(
      apportionTable(
        [
          [-1.9, 0.8, 1.1],
          [-0.4, 0.1, 0.3],
        ],
        [-2, 1, 1]
      )
    ).toEqual([
      [-2, 1, 1],
      [0, 0, 0],
    ]);
  });

  it("linha que não fecha em 0 no arredondamento: ±1 onde o erro cresce menos", () => {
    // −1,4 → −1; 0,7 → 1; 0,7 → 1 soma +1. Tirar 1 do mandante custa 0,2; do empate ou
    // do visitante, 0,4.
    expect(apportionTable([[-1.4, 0.7, 0.7]], [-2, 1, 1])).toEqual([
      [-2, 1, 1],
    ]);
  });

  it("o caso do VIRA (#683): o empate não sai com −1 de quem deu chance a ele", () => {
    // O rodízio tira 0,66 do Galo, dá 0,16 ao empate e 0,50 ao Boca.
    const raws = [
      [-1.68, 0.45, 1.22],
      [-0.88, -0.32, 1.19],
      [-0.66, 0.16, 0.5],
    ];
    expect(apportionTable(raws, [-3, 0, 3])).toEqual([
      [-1, 0, 1],
      [-1, 0, 1],
      [-1, 0, 1],
    ]);
  });

  it("move o ponto entre colunas dentro de uma linha, sem trocar sinal", () => {
    // O primeiro fator tirou do empate: não pode receber o +1 dele. O segundo pode.
    expect(
      apportionTable(
        [
          [0.05, -0.1, 0.05],
          [-0.3, 0.4, -0.1],
        ],
        [0, 1, -1]
      )
    ).toEqual([
      [0, 0, 0],
      [0, 1, -1],
    ]);
  });

  it("sem movimento que respeite o sinal → null", () => {
    // Um fator só, que tirou 0,1 do empate, com a barra pedindo +1 no empate.
    expect(apportionTable([[0.05, -0.1, 0.05]], [0, 1, -1])).toBeNull();
    // Cru ≈ 0 só aceita 0.
    expect(apportionTable([[-0.4, 0, 0.4]], [0, -1, 1])).toBeNull();
  });

  it("é determinístico nos empates (fator, depois coluna)", () => {
    const raws = [
      [-0.5, 0, 0.5],
      [-0.5, 0, 0.5],
    ];
    const a = apportionTable(raws, [-1, 0, 1]);
    for (let i = 0; i < 10; i++)
      expect(apportionTable(raws, [-1, 0, 1])).toEqual(a);
    // ∓0,5 arredondam pra ∓1 nos dois; o ponto de volta sai do primeiro fator.
    expect(a).toEqual([
      [0, 0, 0],
      [-1, 0, 1],
    ]);
  });

  it("propriedade: linhas somam 0, colunas o alvo, sinal certo, |int − cru| < 2", () => {
    const r = rng(11);
    let nulls = 0;
    const N = 2000;
    for (let n = 0; n < N; n++) {
      const rows = 1 + Math.floor(r() * 6);
      const raws = Array.from({ length: rows }, () => {
        const h = (r() - 0.5) * 5;
        const d = (r() - 0.5) * Math.abs(h);
        return [h, d, -(h + d)];
      });
      // Alvos de verdade: maior resto de uma base e de um final que somam 100.
      const b = [30 + r() * 20, 20 + r() * 10];
      const base = [b[0], b[1], 100 - b[0] - b[1]];
      const fin = base.map((x, k) => x + sum(raws.map((row) => row[k])));
      const lb = largestRemainder(base, 100);
      const lf = largestRemainder(fin, 100);
      const targets = lf.map((x, k) => x - lb[k]);
      const out = apportionTable(raws, targets);
      if (!out) {
        nulls++;
        continue;
      }
      expect(colSums(out, 3)).toEqual(targets);
      out.forEach((row, i) => {
        expect(sum(row)).toBe(0);
        row.forEach((v, k) => {
          expect(signOk(v, raws[i][k])).toBe(true);
          expect(Math.abs(v - raws[i][k])).toBeLessThan(2);
        });
      });
    }
    expect(nulls / N).toBeLessThanOrEqual(0.02);
  });
});
