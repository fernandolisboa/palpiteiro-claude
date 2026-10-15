import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  mergeTourState,
  parseTourState,
  shouldAutoStart,
  stateAfterChapter,
  TOUR_CHAPTERS,
  tourMatchIndex,
} from "@/lib/tour/steps";
import { MATCH_TAB_IDS } from "@/lib/view/match-tabs";

describe("shouldAutoStart", () => {
  it("abre a lista só pra quem nunca viu", () => {
    expect(shouldAutoStart("jogos", null)).toBe(true);
    expect(shouldAutoStart("jogos", "jogos")).toBe(false);
    expect(shouldAutoStart("jogos", "done")).toBe(false);
    expect(shouldAutoStart("jogos", "dismissed")).toBe(false);
  });

  it("abre a página do jogo só depois da parte da lista", () => {
    expect(shouldAutoStart("jogo", "jogos")).toBe(true);
    expect(shouldAutoStart("jogo", null)).toBe(false);
    expect(shouldAutoStart("jogo", "done")).toBe(false);
    expect(shouldAutoStart("jogo", "dismissed")).toBe(false);
  });

  it("encadeia os capítulos", () => {
    expect(stateAfterChapter("jogos")).toBe("jogos");
    expect(stateAfterChapter("jogo")).toBe("done");
  });
});

describe("mergeTourState", () => {
  it("usa o servidor quando o aparelho não tem nada", () => {
    expect(mergeTourState("jogos", null)).toBe("jogos");
    expect(mergeTourState(null, null)).toBeNull();
  });

  it("o valor do aparelho só adianta, nunca atrasa", () => {
    // Gravação ainda não chegou ao DB quando a próxima página renderizou.
    expect(mergeTourState(null, "dismissed")).toBe("dismissed");
    expect(mergeTourState("jogos", "done")).toBe("done");
    // Concluído em outro aparelho: o "jogos" antigo daqui não reabre nada.
    expect(mergeTourState("done", "jogos")).toBe("done");
    expect(mergeTourState("dismissed", "jogos")).toBe("dismissed");
  });
});

describe("parseTourState", () => {
  it("aceita só o enum", () => {
    expect(parseTourState("done")).toBe("done");
    expect(parseTourState("lixo")).toBeNull();
    expect(parseTourState(null)).toBeNull();
    expect(parseTourState(1)).toBeNull();
  });
});

describe("tourMatchIndex", () => {
  it("pula jogos que não dá mais pra analisar", () => {
    expect(
      tourMatchIndex([{ analyzable: false }, {}, { analyzable: true }]),
    ).toBe(2);
    expect(tourMatchIndex([{ analyzable: false }])).toBe(-1);
    expect(tourMatchIndex([])).toBe(-1);
  });
});

// Contrato: todo alvo do tour tem um `data-tour` de verdade no código. Renomear um
// alvo sem atualizar o tour faria o passo sumir em silêncio (passo sem alvo é pulado).
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "__tests__" || name === "node_modules") return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

describe("alvos do tour", () => {
  const root = path.resolve(__dirname, "../../..");
  const source = [...sourceFiles(path.join(root, "app")), ...sourceFiles(path.join(root, "components"))]
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  const targets = Object.values(TOUR_CHAPTERS)
    .flat()
    .flatMap((step) => (step.target ? [step.target] : []));

  it.each(targets)("data-tour=%s existe no código", (target) => {
    const pattern = new RegExp(`data-tour=[^\\n]*"${target}"`);
    expect(source).toMatch(pattern);
  });
});

describe("abas do tour (#576)", () => {
  const steps = Object.values(TOUR_CHAPTERS).flat();

  it("todo step.tab é uma aba da página do jogo", () => {
    const tabs = steps.flatMap((step) => (step.tab ? [step.tab] : []));
    expect(tabs.length).toBeGreaterThan(0);
    for (const tab of tabs) expect(MATCH_TAB_IDS).toContain(tab);
  });

  it("passo com aba tem alvo (a aba sozinha não destaca nada)", () => {
    for (const step of steps) if (step.tab) expect(step.target).toBeTruthy();
  });

  it("capítulo do jogo: Mercados, Seu palpite e Dados abrem a própria aba", () => {
    const byTarget = Object.fromEntries(
      TOUR_CHAPTERS.jogo.map((step) => [step.target ?? step.title, step.tab]),
    );
    expect(byTarget).toMatchObject({
      palpite: undefined,
      mercados: "mercados",
      "seu-palpite": "seu-palpite",
      "match-stats": "dados",
      Pronto: undefined,
    });
  });
});
