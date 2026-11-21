import { describe, expect, it } from "vitest";

import {
  UnderdogCaseSchema,
  UnderdogReviewSchema,
} from "@/lib/ai/underdog/schema";

import { goodDraft, goodReview } from "./fixtures";

describe("UnderdogCaseSchema", () => {
  it("aceita o rascunho bom", () => {
    expect(UnderdogCaseSchema.safeParse(goodDraft()).success).toBe(true);
  });
  it.each([
    ["campo a mais", { ...goodDraft(), extra: 1 }],
    [
      "id inválido",
      { frases: goodDraft().frases.map((f) => ({ ...f, fatos: ["X1"] })) },
    ],
    [
      "notícia (fora da v1)",
      { frases: goodDraft().frases.map((f) => ({ ...f, fatos: ["N1"] })) },
    ],
    ["menos de 3 frases", { frases: goodDraft().frases.slice(0, 2) }],
    [
      "mais de 6 frases",
      { frases: [...goodDraft().frases, ...goodDraft().frases] },
    ],
    [
      "sem fatos",
      { frases: goodDraft().frases.map((f) => ({ ...f, fatos: [] })) },
    ],
    [
      "4 fatos",
      {
        frases: goodDraft().frases.map((f) => ({
          ...f,
          fatos: ["P1", "P2", "P3", "S1"],
        })),
      },
    ],
    [
      "frase longa",
      {
        frases: goodDraft().frases.map((f) => ({
          ...f,
          texto: "a".repeat(221),
        })),
      },
    ],
  ])("%s → reprova", (_l, v) => {
    expect(UnderdogCaseSchema.safeParse(v).success).toBe(false);
  });
});

describe("UnderdogReviewSchema", () => {
  it("aceita a revisão boa", () => {
    expect(UnderdogReviewSchema.safeParse(goodReview()).success).toBe(true);
  });
  it.each([
    [
      "veredito fora do enum",
      {
        ...goodReview(),
        avaliacoes: [{ indice: 0, veredito: "talvez", motivo: "x" }],
      },
    ],
    [
      "índice 6",
      {
        ...goodReview(),
        avaliacoes: [{ indice: 6, veredito: "apoiada", motivo: "x" }],
      },
    ],
    ["contraponto longo", { ...goodReview(), contraponto: "a".repeat(321) }],
    ["campo a mais", { ...goodReview(), extra: true }],
  ])("%s → reprova", (_l, v) => {
    expect(UnderdogReviewSchema.safeParse(v).success).toBe(false);
  });
});
