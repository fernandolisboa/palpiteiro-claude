// @vitest-environment node
import { describe, expect, it } from "vitest";

import { generateImageMetadata } from "@/app/icon";
import manifest from "@/app/manifest";
import { gatedMatcherRegex } from "@/lib/security/gated-routes";

/**
 * Ícones + manifest (#440). O manifest aponta pras rotas de app/icon.tsx; se um tamanho
 * sair de `generateImageMetadata`, o ícone de instalação vira 404 sem nenhum erro de build.
 */

const isGated = (path: string) => gatedMatcherRegex().test(path);

describe("manifest", () => {
  const m = manifest();
  const generated = generateImageMetadata().map((icon) => ({
    src: `/icon/${icon.id}`,
    sizes: `${icon.size.width}x${icon.size.height}`,
  }));

  it("cada ícone do manifest é um tamanho gerado por app/icon.tsx", () => {
    for (const icon of m.icons ?? []) {
      expect(generated).toContainEqual({ src: icon.src, sizes: icon.sizes });
    }
  });

  it("tem os tamanhos que o Chrome pede pra instalar (192 e 512)", () => {
    expect(m.icons?.map((i) => i.sizes)).toEqual(
      expect.arrayContaining(["192x192", "512x512"]),
    );
  });

  it("ícones e manifest são lidos sem sessão (fora do matcher do middleware)", () => {
    for (const path of ["/manifest.webmanifest", "/apple-icon", ...generated.map((g) => g.src)]) {
      expect(isGated(path)).toBe(false);
    }
  });

  it("abre na lista de jogos, em tela cheia, sem service worker", () => {
    expect(m.start_url).toBe("/jogos");
    expect(m.display).toBe("standalone");
    expect(m).not.toHaveProperty("serviceworker");
  });
});
