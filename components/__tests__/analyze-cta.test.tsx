import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AnalyzeCTA } from "@/components/analyze-cta";

describe("AnalyzeCTA model-aware progress label", () => {
  it("renders the selected model in the 'gerando análise' step", () => {
    const markup = renderToStaticMarkup(
      <AnalyzeCTA pending modelLabel="Opus 4.8" />,
    );
    expect(markup).toContain("gerando análise (Opus 4.8)");
    // não deve vazar o literal stale antigo
    expect(markup).not.toContain("claude-sonnet-4.5");
  });

  it("reflects a different selected model verbatim", () => {
    const markup = renderToStaticMarkup(
      <AnalyzeCTA pending modelLabel="Sonnet 4.6" />,
    );
    expect(markup).toContain("gerando análise (Sonnet 4.6)");
  });

  it("omits the parenthetical when no model label is provided", () => {
    const markup = renderToStaticMarkup(<AnalyzeCTA pending />);
    expect(markup).toContain("gerando análise");
    expect(markup).not.toContain("gerando análise (");
  });
});

describe("AnalyzeCTA loading-step color semantics (#71)", () => {
  it("does not reuse the reserved edge-fg token for the completed-step checkmark", () => {
    const markup = renderToStaticMarkup(<AnalyzeCTA pending={true} />);
    // edge-* is reserved for the recommendation-edge concept (#34/#71)
    expect(markup).not.toContain("edge-fg");
    // Bind the muted token to the CHECKMARK specifically. text-muted-foreground
    // also appears on the subtitle and the done LABEL, so a plain toContain
    // passes even against unfixed main — it wouldn't catch the checkmark being
    // pointed at some other token. The ✓-anchored regex fails if the checkmark
    // moves off muted-foreground (and still requires the glyph to render).
    expect(markup).toMatch(/text-muted-foreground[^>]*>\s*✓/);
  });
});
