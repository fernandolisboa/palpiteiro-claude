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
});
