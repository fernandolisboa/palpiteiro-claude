import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { monogramFontPx, TeamAvatar } from "@/components/team-avatar";

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
    const markup = renderToStaticMarkup(<TeamAvatar initials="PAL" hue={145} size={56} />);
    expect(markup).not.toContain("<img");
    expect(markup).toMatch(/aria-hidden="true"[^>]*>\s*PAL/);
  });

  it("sem flagCode e sigla que cabe: 56px com 'ATM' renderiza as 3 letras a 20px", () => {
    const markup = renderToStaticMarkup(<TeamAvatar initials="ATM" hue={0} size={56} />);
    expect(markup).toMatch(/>\s*ATM\s*</);
    expect(markup).toContain("font-size:20px");
  });

  it("22px com 'PAL' não cabe a 11px: círculo só com a cor, sem texto (#578)", () => {
    const markup = renderToStaticMarkup(<TeamAvatar initials="PAL" hue={145} size={22} />);
    expect(markup).not.toContain("PAL");
    expect(markup).not.toContain("font-size");
    expect(markup).toContain("background:oklch(");
  });

  it("26px com 2 letras (avatar de conta) renderiza a 11px", () => {
    const markup = renderToStaticMarkup(<TeamAvatar initials="FL" hue={0} size={26} />);
    expect(markup).toMatch(/>\s*FL\s*</);
    expect(markup).toContain("font-size:11px");
  });
});

describe("monogramFontPx", () => {
  it("nunca devolve fonte abaixo de 11px (16 a 64px, 1 a 3 letras)", () => {
    for (let size = 16; size <= 64; size++) {
      for (let chars = 1; chars <= 3; chars++) {
        const font = monogramFontPx(size, chars);
        if (font !== null) {
          expect(font).toBeGreaterThanOrEqual(11);
          // e cabe no círculo
          expect(chars * font * 0.75).toBeLessThanOrEqual(size - 6);
        }
      }
    }
  });

  it("os tamanhos em uso", () => {
    expect(monogramFontPx(22, 3)).toBeNull();
    expect(monogramFontPx(26, 2)).toBe(11);
    expect(monogramFontPx(56, 3)).toBe(20);
  });
});
