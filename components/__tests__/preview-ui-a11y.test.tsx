import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamAvatar } from "@/components/team-avatar";
import { H2HSection } from "@/components/h2h-section";
import type { H2HView } from "@/lib/view/types";

describe("preview UI accessibility and color semantics (#34)", () => {
  it("marks the decorative TeamAvatar monogram aria-hidden", () => {
    const markup = renderToStaticMarkup(<TeamAvatar initials="PA" hue={180} />);
    // aria-hidden must sit on the very element that renders the initials, so a
    // regression moving the attribute to a sibling node would fail here.
    expect(markup).toMatch(/aria-hidden="true"[^>]*>\s*PA/);
  });

  it("renders the H2H over badge without the reserved edge-* tokens", () => {
    const mockView: H2HView = {
      rows: [
        { date: "15/01", h: "Team A", a: "Team B", s: "2-1", tag: "over" },
        { date: "02/12", h: "Team A", a: "Team B", s: "1-0", tag: "under" },
      ],
      summary: "1W 1L",
    };
    const markup = renderToStaticMarkup(<H2HSection view={mockView} />);
    // the green "edge" token family is reserved for the recommendation edge
    expect(markup).not.toContain("edge-fg");
    expect(markup).not.toContain("edge-soft");
    expect(markup).not.toContain("edge-border");
    // the over badge must stay VISUALLY DISTINCT from "< 3" (neutral filled, not
    // edge green): a regression collapsing it into the under styling would drop
    // these classes, so absence-of-edge alone is not enough.
    expect(markup).toContain("bg-secondary");
    expect(markup).toContain("text-secondary-foreground");
    // both branches still render their labels; "<" is HTML-escaped in static markup
    expect(markup).toContain("3+ gols");
    expect(markup).toContain("&lt; 3");
  });
});
