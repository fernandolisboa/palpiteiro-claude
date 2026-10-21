import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { describe, expect, it } from "vitest";

import config from "@/next.config";

/**
 * Cache dos ícones, do manifest e do card da landing (#440/#442, ADR 0024).
 *
 * São metadata routes estáticas: não podem cair no bloco `no-cache` do documento HTML
 * (o crawler e o navegador rebaixariam a cada hit) e sim no bloco de cache de CDN, junto
 * de robots/sitemap. Compila as `source` com o matcher do próprio Next, então o teste é
 * comportamental (não depende da formatação do next.config.ts).
 */

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

const rules = await (config as { headers: () => Promise<HeaderRule[]> }).headers();

function cacheControlFor(path: string): string[] {
  return rules
    .filter((rule) => getPathMatch(rule.source, { strict: true })(path) !== false)
    .flatMap((rule) => rule.headers)
    .filter((h) => h.key === "Cache-Control")
    .map((h) => h.value);
}

const CDN_CACHE = "public, max-age=0, s-maxage=86400, must-revalidate";
const HTML_NO_CACHE = "no-cache, must-revalidate";

describe("Cache-Control das metadata routes estáticas", () => {
  it.each([
    "/robots.txt",
    "/sitemap.xml",
    "/manifest.webmanifest",
    "/icon/32",
    "/icon/192",
    "/icon/512",
    "/apple-icon",
    "/opengraph-image",
  ])("%s tem só o cache de CDN", (path) => {
    expect(cacheControlFor(path)).toEqual([CDN_CACHE]);
  });

  it.each(["/", "/jogos", "/como-funciona", "/iconx", "/icones", "/match/1"])(
    "documento HTML %s segue no-cache",
    (path) => {
      expect(cacheControlFor(path)).toEqual([HTML_NO_CACHE]);
    },
  );
});
