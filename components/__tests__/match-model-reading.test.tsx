import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MatchModelReading,
  MatchModelReadingCard,
} from "@/components/match-model-reading";
import type { MatchModelReadingView } from "@/lib/view/types";

const VIEW: MatchModelReadingView = {
  markets: [
    {
      key: "match_result",
      label: "Resultado (1X2)",
      selections: [
        { label: "Casa", pct: "52.3%", fairOdd: "1.91" },
        { label: "Empate", pct: "25.2%", fairOdd: "3.97" },
        { label: "Fora", pct: "22.5%", fairOdd: "4.44" },
      ],
    },
    {
      key: "over_under:2.5",
      label: "Over/Under gols · 2.5",
      selections: [
        { label: "Over 2.5", pct: "48.4%", fairOdd: "2.07" },
        { label: "Under 2.5", pct: "51.6%", fairOdd: "1.94" },
      ],
    },
  ],
  topScorelines: [
    { score: "1–1", pct: "12.4%" },
    { score: "1–0", pct: "11.9%" },
  ],
  source: "Dixon-Coles",
  jev: "+ JEV",
  computedAgo: "3h",
};

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("MatchModelReading (#555)", () => {
  it("probabilidades, odd justa, placares, rodapé e 'calculado há'", () => {
    const t = text(renderToStaticMarkup(<MatchModelReadingCard view={VIEW} />));
    expect(t).toContain("Leitura do modelo");
    expect(t).toContain("Probabilidade do modelo, sem odds: compare com a odd da sua casa.");
    expect(t).toContain("Resultado (1X2)");
    expect(t).toContain("52.3%");
    expect(t).toContain("odd justa 1.91");
    expect(t).toContain("Over/Under gols · 2.5");
    expect(t).toContain("1–1 · 12.4%");
    expect(t).toContain("modelo · Dixon-Coles + JEV");
    expect(t).toContain("calculado há 3h");
  });

  it("sem linguagem de valor", () => {
    const t = text(renderToStaticMarkup(<MatchModelReadingCard view={VIEW} />));
    expect(t).not.toMatch(/edge|valor|\bEV\b|stake/i);
  });

  it("estado vazio quando não há base", () => {
    const t = text(renderToStaticMarkup(<MatchModelReadingCard view={null} />));
    expect(t).toContain(
      "A leitura do modelo aparece aqui quando o cálculo do jogo rodar (a cada 6h, até 7 dias antes do jogo).",
    );
    expect(t).not.toContain("calculado há");
  });

  it("o wrapper async resolve a promise da página", async () => {
    const el = await MatchModelReading({ reading: Promise.resolve(VIEW) });
    expect(text(renderToStaticMarkup(el))).toContain("odd justa 4.44");
  });
});
