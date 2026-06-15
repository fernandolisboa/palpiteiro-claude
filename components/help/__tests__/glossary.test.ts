import { describe, expect, it } from "vitest";

import { GLOSSARY } from "@/components/help/glossary";
import { MIN_EDGE_PP } from "@/lib/odds/scenario";

describe("GLOSSARY (contrato de dados)", () => {
  it("tem pelo menos uma entrada", () => {
    expect(GLOSSARY.length).toBeGreaterThan(0);
  });

  it("usa anchors únicos", () => {
    const anchors = GLOSSARY.map((e) => e.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it("usa anchors em kebab-case (alvo estável de #hash)", () => {
    for (const { anchor } of GLOSSARY) {
      expect(anchor).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("tem term e meaning não-vazios em toda entrada", () => {
    for (const { term, meaning } of GLOSSARY) {
      expect(term.trim().length).toBeGreaterThan(0);
      expect(meaning.trim().length).toBeGreaterThan(0);
    }
  });

  it("cita MIN_EDGE_PP no significado de #edge (sem hardcode que pode driftar)", () => {
    const edge = GLOSSARY.find((e) => e.anchor === "edge");
    expect(edge).toBeDefined();
    expect(edge?.meaning).toContain(`${MIN_EDGE_PP}pp`);
  });

  it("cita MIN_EDGE_PP no significado de #odd-minima (interpola, não hardcode)", () => {
    const oddMinima = GLOSSARY.find((e) => e.anchor === "odd-minima");
    expect(oddMinima).toBeDefined();
    expect(oddMinima?.meaning).toContain(`${MIN_EDGE_PP}pp`);
  });

  it("preserva o conteúdo over/under em markets.over_under das entradas reescritas genéricas", () => {
    // As 5 entradas O/U viraram genéricas (meaning) mas o conteúdo over/under é
    // REAPROVEITADO em markets.over_under (não descartado). Anchors inalterados.
    for (const anchor of [
      "over-under-2-5",
      "recomendacao",
      "prob-implicita",
      "overround",
      "cenarios",
    ]) {
      const entry = GLOSSARY.find((e) => e.anchor === anchor);
      expect(entry, anchor).toBeDefined();
      expect(entry?.markets?.over_under?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  it("descreve os mercados novos (1X2, BTTS, dupla chance) em markets nas entradas market-aware", () => {
    // O glossário virou multi-mercado junto com /como-funciona (#182): as entradas
    // market-shaped ganham detalhe próprio por mercado, aditivo ao over_under.
    for (const anchor of [
      "selecao",
      "recomendacao",
      "prob-implicita",
      "overround",
      "cenarios",
    ]) {
      const entry = GLOSSARY.find((e) => e.anchor === anchor);
      expect(entry, anchor).toBeDefined();
      for (const marketKey of ["match_result", "btts", "double_chance"]) {
        expect(
          entry?.markets?.[marketKey]?.trim().length ?? 0,
          `${anchor}.${marketKey}`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
