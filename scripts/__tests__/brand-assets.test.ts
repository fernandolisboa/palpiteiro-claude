// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BRAND_ASSETS_DIR, renderBrandAssets } from "@/scripts/brand-assets";

/**
 * Arquivos da marca em docs/brand/ (ADR 0067). Eles são cópia da geometria do app pra uso
 * fora dele; se o símbolo mudar e ninguém rodar `pnpm brand:export`, este teste falha em vez
 * de o Google ou um perfil social ficarem com o logo velho sem ninguém notar.
 */
describe("docs/brand/ acompanha o símbolo do app", async () => {
  const assets = await renderBrandAssets();

  it.each(assets.map((a) => [a.file, a.bytes] as const))(
    "%s está igual ao gerado (senão: pnpm brand:export)",
    (file, bytes) => {
      const path = join(BRAND_ASSETS_DIR, file);
      expect(existsSync(path), `${path} não existe`).toBe(true);
      expect(readFileSync(path).equals(bytes), `${path} desatualizado`).toBe(true);
    },
  );

  it("o PNG do Google tem 120×120", () => {
    const png = assets.find((a) => a.file === "palpiteiro-google-oauth-120.png")!.bytes;
    // IHDR: largura e altura em big-endian logo depois da assinatura e do cabeçalho do chunk.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([120, 120]);
  });
});
