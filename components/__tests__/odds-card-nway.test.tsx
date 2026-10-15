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

describe("OddsCard — título (#574 linha 7)", () => {
  it("null → 'Odds atuais'; live/finished → 'Odds antes do jogo'", () => {
    expect(renderToStaticMarkup(<OddsCard view={NWAY} unavailable={null} />)).toContain(
      "Odds atuais",
    );
    for (const reason of ["live", "finished"] as const) {
      const html = renderToStaticMarkup(<OddsCard view={NWAY} unavailable={reason} />);
      expect(html).toContain("Odds antes do jogo");
      expect(html).not.toContain("Odds atuais");
    }
  });

  it("3 colunas: rótulo trunca com o nome inteiro no title (#574 linha 4)", () => {
    const html = renderToStaticMarkup(
      <OddsCard
        view={{
          ...NWAY,
          outcomes: [{ ...NWAY.outcomes[0], label: "Club Atlético Mineiro" }, ...NWAY.outcomes.slice(1)],
        }}
      />,
    );
    expect(html).toContain('title="Club Atlético Mineiro"');
    expect(html).toContain('<span class="min-w-0 truncate">Club Atlético Mineiro</span>');
  });
});

describe("OddsCard N-vias (1X2, N=3) — #173 PR-2", () => {
  it("renderiza grid-cols-3 com as 3 seleções e a badge do mercado", () => {
    const html = renderToStaticMarkup(<OddsCard view={NWAY} />);
    expect(html).toContain("grid-cols-3");
    expect(html).toContain("Resultado (1X2)");
    expect(html).toContain("Casa");
    expect(html).toContain("Empate");
    expect(html).toContain("Fora");
    // 3 células de pct ("X%" em mono + " normalizada" em sans) — o fecho do span
    // evita casar o aria-label do HelpHint ("prob. do mercado (normalizada)").
    expect(html.split("%</span> normalizada").length - 1).toBe(3);
  });

  it("HelpHint da implícita só na 1ª célula; HelpHint do overround no footer", () => {
    const html = renderToStaticMarkup(<OddsCard view={NWAY} />);
    expect(
      html.split('aria-label="Ajuda: prob. do mercado (normalizada)"').length - 1,
    ).toBe(1);
    expect(html).toContain('aria-label="Ajuda: overround"');
  });

  it("não mostra o nome da casa (fica só no banco, para rastreio)", () => {
    const html = renderToStaticMarkup(<OddsCard view={NWAY} />);
    expect(html).not.toContain("Pinnacle");
    expect(html).toContain("odd de mercado");
  });
});

describe("OddsCard empty-state (view=null) — copy por status", () => {
  it("sem status (pré-jogo default) → 'até que o mercado abra'", () => {
    const html = renderToStaticMarkup(<OddsCard view={null} />);
    expect(html).toContain("Odds indisponíveis");
    expect(html).toContain("até que o mercado abra");
  });

  it("analisável (null) → mesma copy pré-jogo", () => {
    const html = renderToStaticMarkup(
      <OddsCard view={null} unavailable={null} />,
    );
    expect(html).toContain("até que o mercado abra");
  });

  it("live → copy 'em andamento' SEM 'até que o mercado abra' (enganoso ao vivo)", () => {
    const html = renderToStaticMarkup(
      <OddsCard view={null} unavailable="live" />,
    );
    expect(html).toContain("Jogo em andamento");
    expect(html).not.toContain("até que o mercado abra");
  });

  it.each(["started", "postponed", "cancelled", "finished"] as const)(
    "%s → copy neutra de referência, sem 'até que o mercado abra'",
    (reason) => {
      const html = renderToStaticMarkup(
        <OddsCard view={null} unavailable={reason} />,
      );
      expect(html).toContain("Sem cotação de referência");
      expect(html).not.toContain("até que o mercado abra");
    },
  );
});
