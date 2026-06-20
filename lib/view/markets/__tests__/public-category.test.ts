import { describe, expect, it } from "vitest";

import { MARKET_CATEGORY_LABELS } from "@/lib/view/markets/presentation";
import { toPublicMarketCategories } from "@/lib/view/markets/public-category";

// Normalizador DENY-BY-DEFAULT de citedMarkets pro /p (ADR 0035 §5 / #384). citedMarkets é
// texto LIVRE do LLM: uma LINHA crua ("Mais de 2.5 gols", "3.5", "12") pode entrar. A saída
// é CATEGORIA canônica (do REGISTRY) ou nada — NUNCA um dígito (tripwire).

describe("toPublicMarketCategories — famílias mapeiam pra categoria canônica", () => {
  it.each([
    ["Mais de 2.5 gols"],
    ["Menos de 1.5"],
    ["Mais de 3.5 gols"],
    ["Menos de 2.5 gols"],
    ["Over"],
    ["Under"],
    ["Over/Under gols"],
  ])("over_under family '%s' → 'Over/Under gols'", (label) => {
    expect(toPublicMarketCategories([label])).toEqual(["Over/Under gols"]);
  });

  it.each([
    ["Resultado"],
    ["Resultado (1X2)"],
    ["Casa"],
    ["Empate"],
    ["Fora"],
  ])("1X2 family '%s' → 'Resultado (1X2)'", (label) => {
    expect(toPublicMarketCategories([label])).toEqual(["Resultado (1X2)"]);
  });

  it.each([
    ["Sim"],
    ["Não"],
    ["Ambos os times marcam"],
    ["Ambas marcam"],
    ["Pelo menos um time não marca"],
  ])("btts family '%s' → 'Ambas marcam'", (label) => {
    expect(toPublicMarketCategories([label])).toEqual(["Ambas marcam"]);
  });

  it.each([
    ["Casa ou empate"],
    ["Empate ou fora"],
    ["Casa ou fora"],
    ["Dupla chance"],
  ])("double_chance family '%s' → 'Dupla chance'", (label) => {
    expect(toPublicMarketCategories([label])).toEqual(["Dupla chance"]);
  });

  it.each([["0-0"], ["2-1"], ["3-3"], ["Placar exato"]])(
    "exact_score selection '%s' → 'Placar exato'",
    (label) => {
      expect(toPublicMarketCategories([label])).toEqual(["Placar exato"]);
    },
  );

  it("scorer/assist → 'Artilheiro'/'Assistência'", () => {
    expect(toPublicMarketCategories(["Artilheiro"])).toEqual(["Artilheiro"]);
    expect(toPublicMarketCategories(["Assistência"])).toEqual(["Assistência"]);
  });
});

describe("toPublicMarketCategories — DENY-DEFAULT + tripwire de dígito", () => {
  it.each([
    ["Acima de 2.5"],
    ["Over 2.5 goals"],
    ["2.5"],
    ["3.5"],
    ["12"],
    ["Escanteios"],
    ["Cartões"],
    ["mercado aleatório do LLM"],
    [""],
    ["   "],
  ])("rótulo não-mapeável '%s' → DROPPADO", (label) => {
    expect(toPublicMarketCategories([label])).toEqual([]);
  });

  it("toda string emitida é membro da allowlist canônica (tripwire), mesmo com linhas cruas no input", () => {
    // O tripwire real é membership-na-allowlist, NÃO um regex de dígito: a categoria
    // "Resultado (1X2)" legitimamente carrega dígitos no idioma do nome ("1X2"). Uma LINHA
    // crua ("3.5", "12", "2.5") nunca está na allowlist → nunca sai.
    const input = [
      "Mais de 2.5 gols",
      "3.5",
      "12",
      "Acima de 2.5",
      "2-1",
      "Resultado",
    ];
    const out = toPublicMarketCategories(input);
    for (const cat of out) {
      expect(MARKET_CATEGORY_LABELS).toContain(cat);
    }
    // As linhas cruas isoladas ("3.5", "12", "Acima de 2.5") foram droppadas — só sobraram
    // as categorias mapeadas (over_under + exact_score + 1X2).
    expect(out).toEqual([
      "Over/Under gols",
      "Placar exato",
      "Resultado (1X2)",
    ]);
  });

  it("toda categoria emitida é uma das 7 canônicas do REGISTRY", () => {
    const input = [
      "Mais de 3.5 gols",
      "Casa",
      "Sim",
      "Casa ou fora",
      "2-1",
      "Artilheiro",
      "Assistência",
    ];
    for (const out of toPublicMarketCategories(input)) {
      expect(MARKET_CATEGORY_LABELS).toContain(out);
    }
  });
});

describe("toPublicMarketCategories — canônico verbatim + dedupe", () => {
  it("label já-canônico passa verbatim", () => {
    expect(toPublicMarketCategories(["Resultado (1X2)"])).toEqual([
      "Resultado (1X2)",
    ]);
  });

  it("dedupe: várias linhas da MESMA família colapsam numa categoria", () => {
    expect(
      toPublicMarketCategories(["Mais de 2.5 gols", "Menos de 1.5", "Over"]),
    ).toEqual(["Over/Under gols"]);
  });

  it("preserva a ordem de 1ª aparição entre categorias distintas", () => {
    expect(
      toPublicMarketCategories(["Resultado", "Mais de 2.5 gols", "Sim"]),
    ).toEqual(["Resultado (1X2)", "Over/Under gols", "Ambas marcam"]);
  });

  it("o conjunto canônico vem do REGISTRY (7 categorias)", () => {
    expect(MARKET_CATEGORY_LABELS).toHaveLength(7);
    expect(MARKET_CATEGORY_LABELS).toContain("Over/Under gols");
    expect(MARKET_CATEGORY_LABELS).toContain("Resultado (1X2)");
  });
});
