import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AnalyzeCTA } from "@/components/analyze-cta";

describe("AnalyzeCTA loading-step color semantics (#71)", () => {
  it("does not reuse the reserved edge-fg token for the completed-step checkmark", () => {
    const markup = renderToStaticMarkup(<AnalyzeCTA pending={true} />);
    // edge-* is reserved for the recommendation-edge concept (#34/#71)
    expect(markup).not.toContain("edge-fg");
    // the done checkmark renders (so the assertion below is non-trivial)
    expect(markup).toContain("✓");
    // and the done row recedes via the muted token shared with the done label
    expect(markup).toContain("text-muted-foreground");
  });
});
