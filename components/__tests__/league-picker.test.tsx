import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { LeaguePicker } from "@/components/league-picker";

describe("LeaguePicker rendering", () => {
  it("renderiza um select rotulado com as ligas ativas e 'Todas as ligas'", () => {
    const markup = renderToStaticMarkup(
      <LeaguePicker value="all" range={{ preset: "today5" }} />,
    );
    expect(markup).toContain('aria-label="Filtro de liga"');
    expect(markup).toContain('<option value="all" selected="">Todas as ligas</option>');
    expect(markup).toContain(">Brasileirão</option>");
    expect(markup).toContain(">Champions</option>");
    expect(markup).toContain('<optgroup label="Brasil">');
    // Copa encerrada não aparece (#491).
    expect(markup).not.toContain("Copa do Mundo");
  });

  it("marca a liga atual como selecionada", () => {
    const markup = renderToStaticMarkup(
      <LeaguePicker value="ucl" range={{ preset: "today14" }} />,
    );
    expect(markup).toContain('<option value="ucl" selected="">Champions</option>');
  });
});
