import { describe, expect, it } from "vitest";

import {
  computeKellyStakeUnits,
  computeStakeUnits,
  isBelowEdgeFloor,
} from "@/lib/ai/staking";

describe("computeStakeUnits — mapeamento determinístico (ADR 0019)", () => {
  // ── Tabela de exemplos do ADR 0019 (1:1, é o oráculo) ───────────────────────
  describe("tabela de exemplos do ADR (oráculo)", () => {
    it("edge +5.5, conf 53 → 1u (edge < 8 → banda default)", () => {
      expect(computeStakeUnits(5.5, 53)).toBe(1);
    });
    it("edge +9.0, conf 58 → 2u (edge ≥ 8 e conf ≥ 50)", () => {
      expect(computeStakeUnits(9, 58)).toBe(2);
    });
    it("edge +9.0, conf 44 → 1u (edge ≥ 8 mas conf < 50 → guarda derruba)", () => {
      expect(computeStakeUnits(9, 44)).toBe(1);
    });
    it("edge +14, conf 62 → 3u (edge ≥ 12 e conf ≥ 55)", () => {
      expect(computeStakeUnits(14, 62)).toBe(3);
    });
    it("edge +14, conf 52 → 2u (edge ≥ 12 mas conf < 55 → cai pra 2u)", () => {
      expect(computeStakeUnits(14, 52)).toBe(2);
    });
    it("edge +14, conf 44 → 1u (reprova 3u e 2u → cascateia pra 1u)", () => {
      expect(computeStakeUnits(14, 44)).toBe(1);
    });
  });

  // ── Fronteiras exatas: os operadores são `>=` (o piso QUALIFICA) ────────────
  describe("fronteiras exatas (operadores >=)", () => {
    it("edge 8, conf 50 → 2u (ambos os pisos do 2u qualificam no limite)", () => {
      expect(computeStakeUnits(8, 50)).toBe(2);
    });
    it("edge 7.99, conf 99 → 1u (edge logo abaixo do piso do 2u, conf altíssima)", () => {
      expect(computeStakeUnits(7.99, 99)).toBe(1);
    });
    it("edge 8, conf 49.99 → 1u (conf logo abaixo do piso do 2u)", () => {
      expect(computeStakeUnits(8, 49.99)).toBe(1);
    });
    it("edge 12, conf 55 → 3u (ambos os pisos do 3u qualificam no limite)", () => {
      expect(computeStakeUnits(12, 55)).toBe(3);
    });
    it("edge 12, conf 54.99 → 2u (conf logo abaixo do 3u; ainda passa o 2u)", () => {
      expect(computeStakeUnits(12, 54.99)).toBe(2);
    });
    it("edge 11.99, conf 99 → 2u (edge logo abaixo do piso do 3u → cai no 2u)", () => {
      expect(computeStakeUnits(11.99, 99)).toBe(2);
    });
  });

  // ── Cantos da cascata: a guarda de confiança seleciona a banda por PISO ─────
  describe("cantos da cascata (guarda de confiança)", () => {
    it("edge 12, conf 50 → 2u (edge passa o piso do 3u, mas conf só qualifica o 2u)", () => {
      expect(computeStakeUnits(12, 50)).toBe(2);
    });
    it("edge 12, conf 49.99 → 1u (edge alto, mas conf reprova 3u E 2u → 1u)", () => {
      expect(computeStakeUnits(12, 49.99)).toBe(1);
    });
    it("edge 8, conf 55 → 2u (conf alta NÃO levanta sem o piso de edge do 3u)", () => {
      expect(computeStakeUnits(8, 55)).toBe(2);
    });
    it("edge 9, conf 58 → 2u (conf qualificaria o 3u, mas edge < 12 → fica no 2u)", () => {
      expect(computeStakeUnits(9, 58)).toBe(2);
    });
  });

  // ── edgePct null: pass / sem implícita → 1u sempre, independente da confiança
  describe("edgePct null → 1u (não dimensiona sem edge)", () => {
    it("null, conf 0 → 1u", () => {
      expect(computeStakeUnits(null, 0)).toBe(1);
    });
    it("null, conf 99 → 1u (confiança altíssima não levanta sem edge)", () => {
      expect(computeStakeUnits(null, 99)).toBe(1);
    });
  });
});

describe("isBelowEdgeFloor — gate de edge (ADR 0038)", () => {
  it("edge abaixo do piso → rebaixa (true)", () => {
    expect(isBelowEdgeFloor("over", 3.2, 5)).toBe(true);
    expect(isBelowEdgeFloor("home", 4.99, 5)).toBe(true);
  });
  it("edge NO piso passa (fronteira estrita, casa o '≥' do prompt)", () => {
    expect(isBelowEdgeFloor("over", 5, 5)).toBe(false);
    expect(isBelowEdgeFloor("over", 5.01, 5)).toBe(false);
  });
  it("edge acima do piso → mantém (false)", () => {
    expect(isBelowEdgeFloor("scorer_pedro", 9, 8)).toBe(false);
  });
  it("scorer abaixo do piso de 8 → rebaixa", () => {
    expect(isBelowEdgeFloor("scorer_pedro", 6, 8)).toBe(true);
  });
  it("edge nulo (board degradado) NUNCA rebaixa — incerteza ≠ abaixo do piso", () => {
    expect(isBelowEdgeFloor("over", null, 5)).toBe(false);
  });
  it("já é pass → nunca rebaixa de novo", () => {
    expect(isBelowEdgeFloor("pass", null, 5)).toBe(false);
    expect(isBelowEdgeFloor("pass", 2, 5)).toBe(false);
  });
});

describe("computeKellyStakeUnits — quarter-Kelly (ADR 0039 D3)", () => {
  it("p 0.55 @ 2.00 → f* 0.10 → ¼·10 = 2.5u", () => {
    expect(computeKellyStakeUnits(0.55, 2)).toBe(2.5);
  });
  it("arredonda a 0.5u: p 0.30 @ 4.00 → f* 0.0667 → 1.67 → 1.5u", () => {
    expect(computeKellyStakeUnits(0.3, 4)).toBe(1.5);
  });
  it("teto 3u: p 0.70 @ 2.00 → f* 0.40 → 10 → 3u", () => {
    expect(computeKellyStakeUnits(0.7, 2)).toBe(3);
  });
  it("piso 0.5u mesmo com f* ≤ 0 (a margem come o edge)", () => {
    expect(computeKellyStakeUnits(0.5, 1.9)).toBe(0.5);
  });
  it("entrada inválida → null (caller cai nas bandas)", () => {
    expect(computeKellyStakeUnits(NaN, 2)).toBeNull();
    expect(computeKellyStakeUnits(0, 2)).toBeNull();
    expect(computeKellyStakeUnits(1, 2)).toBeNull();
    expect(computeKellyStakeUnits(0.5, 1)).toBeNull();
  });
});
