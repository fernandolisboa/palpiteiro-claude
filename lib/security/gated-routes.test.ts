import { describe, expect, it } from "vitest";

import {
  findStaticGatedRoutes,
  gatedMatcherRegex,
  STATIC_GATED_ALLOWLIST,
} from "@/lib/security/gated-routes";

const matcher = gatedMatcherRegex();
const isGated = (path: string) => matcher.test(path);

describe("findStaticGatedRoutes", () => {
  it("acusa página gateada pré-renderizada", () => {
    expect(findStaticGatedRoutes(["/como-usar", "/jogos"], isGated)).toEqual([
      "/como-usar",
      "/jogos",
    ]);
  });

  it("ignora as públicas e as metadata routes (CSP estática ou sem HTML)", () => {
    expect(
      findStaticGatedRoutes(
        [
          "/",
          "/como-funciona",
          "/termos",
          "/privacidade",
          "/signin",
          "/robots.txt",
          "/sitemap.xml",
        ],
        isGated
      )
    ).toEqual([]);
  });

  it("segmento dinâmico vira valor de exemplo (rota com fallback do ISR)", () => {
    expect(
      findStaticGatedRoutes(
        ["/p/[id]", "/match/[id]", "/docs/[[...slug]]"],
        isGated
      )
    ).toEqual(["/match/[id]", "/docs/[[...slug]]"]);
  });

  it("o 404 default fica liberado de propósito", () => {
    expect(STATIC_GATED_ALLOWLIST).toEqual(["/_not-found"]);
    expect(isGated("/_not-found")).toBe(true);
    expect(findStaticGatedRoutes(["/_not-found"], isGated)).toEqual([]);
  });
});
