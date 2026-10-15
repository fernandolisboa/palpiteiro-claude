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
const root = process.cwd();
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
      "Ler análise completa",
      "Palpite da IA",
      "Registrar apostas",
      "Suas apostas",
      "Simples",
      "Combinada",
      "Adicionar placar",
      "Preencher com o texto",
      "Pular tour",
      "seu palpite",
      "Placar",
      "Resultado",
      "Usar placar",
      "Analisar meu palpite",
      "confirmada",
      "contradita",
      "não verificável",
      "sem o seu contexto",
      "com o seu contexto",
      "Adicionar às suas apostas",
      "Contexto extra (opcional)",
      "o que você acrescentou",
    ]) {
      expect(html).toContain(label);
      expect(ui).toContain(label);
    }
  });

  // "mercados" aparece em dezenas de arquivos; o guia cita o título da grade de apostas
  // da página do jogo (SectionHeading em components/bet-slip.tsx), então a checagem é
  // nesse título e no destaque <Ui> do guia, não na palavra solta.
  it("cita o título da grade de apostas (mercados) como ele aparece no bet-slip", () => {
    const betSlip = readFileSync(path.join(root, "components", "bet-slip.tsx"), "utf8");
    const heading = betSlip.match(/function SectionHeading[\s\S]*?<span[^>]*>\s*([^<]+?)\s*<\/span>/);
    expect(heading?.[1]).toBe("mercados");
    expect(html).toMatch(/<span[^>]*>mercados<\/span>/);
  });
});
