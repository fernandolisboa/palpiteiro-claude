import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { DateRangeTabs } from "@/components/date-range-tabs";
import { buildRangeHref } from "@/lib/view/range-href";

const amp = (href: string) => href.replace(/&/g, "&amp;");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("período da lista de jogos", () => {
  it("na lista padrão só há o chip Escolher datas, sem os chips antigos", () => {
    for (const surface of ["sheet", "popover"] as const) {
      const html = renderToStaticMarkup(
        <DateRangeTabs league="bsa" preset="upcoming" surface={surface} />,
      );
      expect(html).toContain('aria-label="Filtro de período"');
      expect(text(html)).toContain("Escolher datas");
      for (const old of ["5 dias", "14 dias", "Competição", "Todos os próximos"]) {
        expect(text(html)).not.toContain(old);
      }
      expect(html).not.toContain("aria-current");
      expect(html).not.toContain("Limpar datas");
    }
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
    expect(text(html)).not.toContain("Escolher datas");
  });

  it("com preset=custom o × volta pra lista padrão, preservando a liga", () => {
    const html = renderToStaticMarkup(
      <DateRangeTabs
        league="bsa"
        preset="custom"
        from="2026-10-18"
        to="2026-10-25"
        customLabel="18/10 – 25/10"
        surface="sheet"
      />,
    );
    expect(html).toContain('aria-label="Limpar datas"');
    expect(html).toContain(`href="${amp(buildRangeHref({ league: "bsa" }, { preset: "upcoming" }))}"`);
  });

  it("chips com a aparência do FilterChipLink (h-8, redondo)", () => {
    const html = renderToStaticMarkup(
      <DateRangeTabs
        league="all"
        preset="custom"
        from="2026-10-18"
        to="2026-10-25"
        customLabel="18/10 – 25/10"
        surface="sheet"
      />,
    );
    expect(html.match(/h-8 shrink-0 items-center whitespace-nowrap rounded-full/g)).toHaveLength(2);
  });
});
