import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NotFoundContent } from "@/app/not-found-content";

describe("404 próprio (#574 linha 12)", () => {
  it("título em português e link pros jogos", () => {
    const html = renderToStaticMarkup(<NotFoundContent />);
    expect(html).toContain("Página não encontrada");
    expect(html).toContain("O endereço pode estar errado ou a página saiu do ar.");
    expect(html).toContain('href="/jogos"');
    expect(html).toContain("Ir para os jogos");
  });
});
