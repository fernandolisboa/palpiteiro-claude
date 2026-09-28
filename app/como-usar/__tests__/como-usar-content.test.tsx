import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { COMO_USAR_SECTIONS, ComoUsarContent } from "../como-usar-content";
import { TOUR_RESTART_HREF } from "@/lib/tour/steps";

const html = renderToStaticMarkup(<ComoUsarContent />);

// Código de UI fora deste guia: os rótulos que o guia cita têm que existir de verdade.
function uiSource(dir: string): string {
  return readdirSync(dir)
    .flatMap((name) => {
      const full = path.join(dir, name);
      if (name === "__tests__" || name === "como-usar") return [];
      if (statSync(full).isDirectory()) return [uiSource(full)];
      return full.endsWith(".tsx") ? [readFileSync(full, "utf8")] : [];
    })
    .join("\n");
}
const root = path.resolve(__dirname, "../../..");
const ui = uiSource(path.join(root, "app")) + uiSource(path.join(root, "components"));

describe("/como-usar", () => {
  it("renderiza cada seção do índice com o id do link", () => {
    for (const { id } of COMO_USAR_SECTIONS) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`href="#${id}"`);
    }
  });

  it("relança o tour e aponta os conceitos pro /como-funciona", () => {
    expect(html).toContain(`href="${TOUR_RESTART_HREF.replace("&", "&amp;")}"`);
    expect(html).toContain('href="/como-funciona"');
  });

  it("cita os botões pelo nome que eles têm na tela", () => {
    for (const label of [
      "Analisar com IA",
      "Refazer só o palpite",
      "ver análise por mercado",
      "Ler minha aposta",
      "Confirmar aposta",
      "Avaliar valor",
      "Pular tour",
    ]) {
      expect(html).toContain(label);
      expect(ui).toContain(label);
    }
  });
});
