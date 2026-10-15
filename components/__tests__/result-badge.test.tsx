import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ResultBadge } from "@/components/result-badge";
import type { ResultState } from "@/lib/view/result-state";

const CASES: [ResultState, string, string | null][] = [
  ["won", "Acertou", "bg-form-win-bg"],
  ["lost", "Errou", "bg-form-loss-bg"],
  ["push", "Devolvida", "bg-form-draw-bg"],
  ["void", "Anulada", "bg-form-draw-bg"],
  ["pending", "Em aberto", null],
];

describe("ResultBadge (ADR 0056)", () => {
  it.each(CASES)("%s → palavra %s e a cor certa", (result, word, bg) => {
    const html = renderToStaticMarkup(<ResultBadge result={result} />);
    expect(html).toContain(`>${word}</span>`);
    expect(html).toContain(`data-result="${result}"`);
    if (bg) {
      expect(html).toContain(bg);
    } else {
      expect(html).not.toMatch(/form-(win|loss|draw)/);
      expect(html).toContain("text-muted-foreground");
    }
  });

  it("usa o piso de 11px do Badge (size xs por padrão)", () => {
    const html = renderToStaticMarkup(<ResultBadge result="won" />);
    expect(html).toContain("text-meta");
    expect(html).toContain("h-[18px]");
  });
});
