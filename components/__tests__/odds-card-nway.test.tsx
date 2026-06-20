import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { OddsCard } from "@/components/odds-card";
import type { OddsView } from "@/lib/view/types";

const NWAY: OddsView = {
  marketLabel: "Resultado (1X2)",
  outcomes: [
    { label: "Casa", odd: "2.10", pct: "44.0%" },
    { label: "Empate", odd: "3.40", pct: "27.2%" },
    { label: "Fora", odd: "3.20", pct: "28.9%" },
  ],
  bookmaker: "Pinnacle",
  overround: "8.3%",
  updatedAgo: "2 min",
};

describe("OddsCard N-vias (1X2, N=3) — #173 PR-2", () => {
  it("renderiza grid-cols-3 com as 3 seleções e a badge do mercado", () => {
    const html = renderToStaticMarkup(<OddsCard view={NWAY} />);
    expect(html).toContain("grid-cols-3");
    expect(html).toContain("Resultado (1X2)");
    expect(html).toContain("Casa");
    expect(html).toContain("Empate");
    expect(html).toContain("Fora");
    // 3 células de pct ("X% normalizada") — "% normalizada" evita casar o
    // aria-label do HelpHint ("prob. do mercado (normalizada)").
    expect(html.split("% normalizada").length - 1).toBe(3);
  });

  it("HelpHint da implícita só na 1ª célula; HelpHint do overround no footer", () => {
    const html = renderToStaticMarkup(<OddsCard view={NWAY} />);
    expect(
      html.split('aria-label="Ajuda: prob. do mercado (normalizada)"').length - 1,
    ).toBe(1);
    expect(html).toContain('aria-label="Ajuda: overround"');
  });
});

describe("OddsCard empty-state (view=null) — copy por status", () => {
  it("sem status (pré-jogo default) → 'até que o mercado abra'", () => {
    const html = renderToStaticMarkup(<OddsCard view={null} />);
    expect(html).toContain("Odds indisponíveis");
    expect(html).toContain("até que o mercado abra");
  });

  it("scheduled → mesma copy pré-jogo", () => {
    const html = renderToStaticMarkup(
      <OddsCard view={null} matchStatus="scheduled" />,
    );
    expect(html).toContain("até que o mercado abra");
  });

  it("live → copy 'em andamento' SEM 'até que o mercado abra' (enganoso ao vivo)", () => {
    const html = renderToStaticMarkup(
      <OddsCard view={null} matchStatus="live" />,
    );
    expect(html).toContain("Jogo em andamento");
    expect(html).not.toContain("até que o mercado abra");
  });

  it("finished → copy neutra de referência, sem 'até que o mercado abra'", () => {
    const html = renderToStaticMarkup(
      <OddsCard view={null} matchStatus="finished" />,
    );
    expect(html).toContain("Sem cotação de referência");
    expect(html).not.toContain("até que o mercado abra");
  });
});
