// @vitest-environment node
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import robots from "@/app/robots";

/**
 * Guarda do robots.txt (#666). Página da área logada responde 307 → /signin pra quem
 * não tem sessão (o Googlebot). Se o robots não a bloqueia, o Google segue o redirect
 * e o Search Console reporta "Page with redirect". A lista do disallow é mantida à
 * mão, então este teste lê `app/(app)/` e acusa rota nova esquecida.
 */

function rules() {
  const r = robots().rules;
  if (Array.isArray(r)) throw new Error("robots.ts deve ter um único bloco de regras");
  const asList = (v: string | string[] | undefined) => (v === undefined ? [] : [v].flat());
  return { allow: asList(r.allow), disallow: asList(r.disallow) };
}

const loggedInSegments = readdirSync(join(process.cwd(), "app", "(app)"), {
  withFileTypes: true,
})
  .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("("))
  .map((e) => `/${e.name}`);

describe("robots.txt", () => {
  it("encontra as rotas da área logada (sanidade do readdir)", () => {
    expect(loggedInSegments).toContain("/jogos");
    expect(loggedInSegments).toContain("/como-usar");
  });

  it.each(loggedInSegments)("bloqueia a rota logada %s", (segment) => {
    expect(rules().disallow).toContain(segment);
  });

  it("bloqueia a API", () => {
    expect(rules().disallow).toContain("/api");
  });

  it("não bloqueia o /signin, senão o Google não lê o noindex dele", () => {
    expect(rules().disallow).not.toContain("/signin");
  });

  it.each(["/", "/como-funciona", "/termos", "/privacidade"])(
    "libera a página pública %s",
    (path) => {
      expect(rules().allow).toContain(path);
      expect(rules().disallow).not.toContain(path);
    }
  );
});
