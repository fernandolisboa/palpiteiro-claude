import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TeamAvatar } from "@/components/team-avatar";

describe("TeamAvatar", () => {
  it("com flagCode: renderiza a bandeira vendorizada (decorativa), sem iniciais", () => {
    const markup = renderToStaticMarkup(
      <TeamAvatar initials="MEX" hue={180} flagCode="mx" />,
    );
    expect(markup).toContain('src="/flags/wc/mx.svg"');
    expect(markup).toContain('alt=""');
    expect(markup).toContain('aria-hidden="true"');
    // a bandeira substitui as iniciais.
    expect(markup).not.toContain("MEX");
  });

  it("suporta códigos de subdivisão (England/Scotland)", () => {
    const markup = renderToStaticMarkup(
      <TeamAvatar initials="ENG" hue={0} flagCode="gb-eng" />,
    );
    expect(markup).toContain('src="/flags/wc/gb-eng.svg"');
  });

  it("sem flagCode: mantém o círculo de iniciais (clubes inalterados)", () => {
    const markup = renderToStaticMarkup(<TeamAvatar initials="PAL" hue={145} />);
    expect(markup).not.toContain("<img");
    expect(markup).toMatch(/aria-hidden="true"[^>]*>\s*PAL/);
  });
});
