import { describe, expect, it } from "vitest";

import { hostToOrigin } from "@/lib/settlement/origin-collapse";

describe("hostToOrigin — colapso editorial", () => {
  it("espn.com e espn.com.br → MESMA origem 'espn' (identidade cross-cctld)", () => {
    expect(hostToOrigin("https://www.espn.com/soccer/report")).toBe("espn");
    expect(hostToOrigin("https://www.espn.com.br/futebol/noticia")).toBe(
      "espn",
    );
  });

  it("ge.globo.com e globoesporte.globo.com → MESMA origem 'globo' (*.globo.com)", () => {
    expect(hostToOrigin("https://ge.globo.com/futebol/jogo")).toBe("globo");
    expect(hostToOrigin("https://globoesporte.globo.com/x")).toBe("globo");
    expect(hostToOrigin("https://globo.com/y")).toBe("globo");
  });

  it("espn.com.br vs uol.com.br → DUAS origens distintas", () => {
    expect(hostToOrigin("https://espn.com.br/a")).toBe("espn");
    expect(hostToOrigin("https://uol.com.br/b")).toBe("uol");
  });

  it("eTLD+1 trap: espn.com.br NÃO colapsa para 'com.br'", () => {
    expect(hostToOrigin("https://espn.com.br/a")).not.toBe("com.br");
    expect(hostToOrigin("https://espn.com.br/a")).toBe("espn");
  });

  it("host desconhecido → null (excluído da contagem de origens)", () => {
    expect(hostToOrigin("https://exemplo-aleatorio.net/x")).toBeNull();
    expect(hostToOrigin("https://twitter.com/x")).toBeNull();
  });

  it("'notespn.com' NÃO casa '.espn.com' (boundary do ponto)", () => {
    expect(hostToOrigin("https://notespn.com/x")).toBeNull();
  });

  it("URL inválida → null (sem throw)", () => {
    expect(hostToOrigin("não é url")).toBeNull();
    expect(hostToOrigin("")).toBeNull();
  });

  it("cnnbrasil.com.br → 'cnnbrasil' (sub-colapso seguro: não funde em uol)", () => {
    expect(hostToOrigin("https://www.cnnbrasil.com.br/esporte/x")).toBe(
      "cnnbrasil",
    );
    expect(hostToOrigin("https://www.cnnbrasil.com.br/esporte/x")).not.toBe(
      "uol",
    );
  });

  it("internacionais distintos: bbc, guardian, reuters, goal", () => {
    expect(hostToOrigin("https://www.bbc.com/sport")).toBe("bbc");
    expect(hostToOrigin("https://www.theguardian.com/football")).toBe(
      "guardian",
    );
    expect(hostToOrigin("https://www.reuters.com/sports")).toBe("reuters");
    expect(hostToOrigin("https://www.goal.com/en")).toBe("goal");
  });
});
