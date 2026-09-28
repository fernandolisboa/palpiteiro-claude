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
