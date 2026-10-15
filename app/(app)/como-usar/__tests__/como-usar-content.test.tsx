import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { COMO_USAR_SECTIONS, ComoUsarContent } from "../como-usar-content";
import { TOUR_RESTART_HREF } from "@/lib/tour/steps";
import { MATCH_TAB_IDS } from "@/lib/view/match-tabs";

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
      "Seu palpite",
      "Mercados",
      "Dados",
      "IA",
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
      "Em aberto",
      "Encerradas",
      "Detalhe técnico",
    ]) {
      expect(html).toContain(label);
      expect(ui).toContain(label);
    }
  });

  // As abas da página do jogo (#576): o guia cita os rótulos como eles aparecem nas
  // abas (literais em components/match-tabs.tsx, um por id de MATCH_TAB_IDS).
  it("cita as abas da página do jogo pelo rótulo da tela", () => {
    const tabs = readFileSync(path.join(root, "components", "match-tabs.tsx"), "utf8");
    const labels = MATCH_TAB_IDS.map((id) => {
      const m = new RegExp(`"?${id}"?:\\s*"([^"]+)"`).exec(tabs);
      return m?.[1];
    });
    expect(labels).toEqual(["Mercados", "Seu palpite", "Dados"]);
    for (const label of labels) {
      expect(html).toMatch(new RegExp(`<span[^>]*>${label}</span>`));
    }
  });
});
