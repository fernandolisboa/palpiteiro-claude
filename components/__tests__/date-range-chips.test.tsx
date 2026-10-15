import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { DateRangeTabs } from "@/components/date-range-tabs";
import { buildRangeHref } from "@/lib/view/range-href";

const amp = (href: string) => href.replace(/&/g, "&amp;");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("chips de período da lista de jogos (#577)", () => {
  it("os três chips têm os href de sempre, preservando a liga", () => {
    for (const surface of ["sheet", "popover"] as const) {
      const html = renderToStaticMarkup(
        <DateRangeTabs league="bsa" preset="today5" surface={surface} />,
      );
      for (const preset of ["today5", "today14", "season"] as const) {
        expect(html).toContain(`href="${amp(buildRangeHref({ league: "bsa" }, { preset }))}"`);
      }
      expect(html).toContain('aria-label="Filtro de período"');
    }
  });

  it("o preset ativo leva aria-current e só ele", () => {
    const html = renderToStaticMarkup(
      <DateRangeTabs league="all" preset="today14" surface="sheet" />,
    );
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>14 dias</);
    expect(text(html)).toContain("Escolher datas");
  });

  it("com preset=custom o chip de datas mostra o intervalo, selecionado, uma vez", () => {
    const html = renderToStaticMarkup(
      <DateRangeTabs
        league="all"
        preset="custom"
        from="2026-10-18"
        to="2026-10-25"
        customLabel="18/10 – 25/10"
        surface="popover"
      />,
    );
    expect(html).toMatch(/aria-current="true"[^>]*>.*18\/10 – 25\/10<\/button>/);
    expect(html.split("18/10 – 25/10")).toHaveLength(2);
    expect(html).not.toContain('aria-current="page"');
    expect(text(html)).not.toContain("Escolher datas");
  });

  it("chips com a aparência do FilterChipLink (h-8, redondo)", () => {
    const html = renderToStaticMarkup(
      <DateRangeTabs league="all" preset="today5" surface="sheet" />,
    );
    expect(html.match(/h-8 shrink-0 items-center whitespace-nowrap rounded-full/g)).toHaveLength(4);
  });
});
