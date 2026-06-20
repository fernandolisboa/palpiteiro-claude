import { describe, expect, it } from "vitest";

import { appendBackParam, resolveBackHref } from "@/lib/view/back-href";

describe("appendBackParam", () => {
  it("no-op quando listHref ausente (undefined) → href de detalhe limpo", () => {
    expect(appendBackParam("/match/abc", undefined, "/jogos")).toBe("/match/abc");
  });

  it("no-op quando listHref === base (sem filtro a preservar)", () => {
    expect(appendBackParam("/match/abc", "/jogos", "/jogos")).toBe("/match/abc");
  });

  it("anexa ?back= (encodado) quando a lista tem filtro", () => {
    expect(
      appendBackParam(
        "/match/abc",
        "/jogos?league=wc&preset=custom&from=2026-06-18&to=2026-06-20",
        "/jogos",
      ),
    ).toBe(
      "/match/abc?back=%2Fjogos%3Fleague%3Dwc%26preset%3Dcustom%26from%3D2026-06-18%26to%3D2026-06-20",
    );
  });

  it("usa & quando o href de detalhe já tem query", () => {
    expect(appendBackParam("/match/abc?x=1", "/jogos?league=wc", "/jogos")).toBe(
      "/match/abc?x=1&back=%2Fjogos%3Fleague%3Dwc",
    );
  });

  it("dashboard: anexa preservando status/mercado", () => {
    expect(
      appendBackParam(
        "/dashboard/p1",
        "/dashboard?status=won&market=over_under",
        "/dashboard",
      ),
    ).toBe("/dashboard/p1?back=%2Fdashboard%3Fstatus%3Dwon%26market%3Dover_under");
  });
});

describe("resolveBackHref", () => {
  it("undefined → base", () => {
    expect(resolveBackHref(undefined, "/jogos")).toBe("/jogos");
  });

  it("rota interna sob base (com query) → aceita", () => {
    expect(resolveBackHref("/jogos?league=wc&preset=today14", "/jogos")).toBe(
      "/jogos?league=wc&preset=today14",
    );
  });

  it("exatamente a base → aceita", () => {
    expect(resolveBackHref("/jogos", "/jogos")).toBe("/jogos");
  });

  it("rejeita URL absoluta (open-redirect) → base", () => {
    expect(resolveBackHref("https://evil.com", "/jogos")).toBe("/jogos");
  });

  it("rejeita protocol-relative → base", () => {
    expect(resolveBackHref("//evil.com", "/jogos")).toBe("/jogos");
  });

  it("rejeita outra rota interna (prefixo não-delimitado) → base", () => {
    expect(resolveBackHref("/jogosX?a=1", "/jogos")).toBe("/jogos");
    expect(resolveBackHref("/admin", "/jogos")).toBe("/jogos");
  });

  it("base de dashboard isola de /jogos", () => {
    expect(resolveBackHref("/dashboard?status=won", "/dashboard")).toBe(
      "/dashboard?status=won",
    );
    expect(resolveBackHref("/jogos?league=wc", "/dashboard")).toBe("/dashboard");
  });

  it("segmento de path sob a base → aceita (rota /time/[team] sob /time)", () => {
    expect(resolveBackHref("/time/Brazil", "/time")).toBe("/time/Brazil");
    // canonical URL-encoded (espaços/acentos) também round-trips
    expect(resolveBackHref("/time/S%C3%A3o%20Paulo%20FC", "/time")).toBe(
      "/time/S%C3%A3o%20Paulo%20FC",
    );
    // delimitador `/` impede que /timeX passe por /time
    expect(resolveBackHref("/timeX/Brazil", "/time")).toBe("/time");
  });

  it("hardening: rejeita traversal/double-slash/backslash mesmo sob base válida (#408 review)", () => {
    // `..` sobe diretório (/time/../admin → /admin) — rejeitado
    expect(resolveBackHref("/time/../admin", "/time")).toBe("/time");
    expect(resolveBackHref("/time/..%2Fadmin/..", "/time")).toBe("/time");
    // `//` segmento protocol-relative-ish — rejeitado
    expect(resolveBackHref("/time//evil.com", "/time")).toBe("/time");
    // backslash (truque de path Windows/normalização) — rejeitado
    expect(resolveBackHref("/time/\\evil", "/time")).toBe("/time");
    // o caso legítimo (sem `..`/`//`/`\`) segue aceito
    expect(resolveBackHref("/time/Brazil", "/time")).toBe("/time/Brazil");
  });

  it("lista de bases → aceita qualquer uma; fallback = a primeira", () => {
    expect(resolveBackHref("/time/Brazil", ["/jogos", "/time"])).toBe(
      "/time/Brazil",
    );
    expect(resolveBackHref("/jogos?league=wc", ["/jogos", "/time"])).toBe(
      "/jogos?league=wc",
    );
    // back inválido (open-redirect) cai na PRIMEIRA base
    expect(resolveBackHref("https://evil.com", ["/jogos", "/time"])).toBe(
      "/jogos",
    );
    expect(resolveBackHref(undefined, ["/jogos", "/time"])).toBe("/jogos");
  });
});
