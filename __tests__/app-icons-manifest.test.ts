// @vitest-environment node
import { describe, expect, it } from "vitest";

import { size as size32 } from "@/app/icon";
import { size as size192 } from "@/app/icon1";
import { size as size512 } from "@/app/icon2";
import manifest from "@/app/manifest";
import { gatedMatcherRegex } from "@/lib/security/gated-routes";

/**
 * Ícones + manifest (#440). O manifest aponta pras rotas de app/icon1.tsx e icon2.tsx; se
 * um arquivo mudar de tamanho ou de nome, o ícone de instalação quebra sem erro de build.
 */

const isGated = (path: string) => gatedMatcherRegex().test(path);
const px = (s: { width: number; height: number }) => `${s.width}x${s.height}`;

describe("manifest", () => {
  const m = manifest();

  it("lista /icon1 (192) e /icon2 (512) com o tamanho que cada arquivo gera", () => {
    expect(m.icons).toEqual([
      { src: "/icon1", sizes: px(size192), type: "image/png" },
      { src: "/icon2", sizes: px(size512), type: "image/png" },
    ]);
    expect([px(size192), px(size512)]).toEqual(["192x192", "512x512"]);
  });

  it("o favicon da aba é 32px", () => {
    expect(px(size32)).toBe("32x32");
  });

  it("ícones e manifest são lidos sem sessão (fora do matcher do middleware)", () => {
    for (const path of ["/manifest.webmanifest", "/icon", "/icon1", "/icon2", "/apple-icon"]) {
      expect(isGated(path)).toBe(false);
    }
  });

  it("abre na lista de jogos, em tela cheia", () => {
    expect(m.start_url).toBe("/jogos");
    expect(m.display).toBe("standalone");
  });
});
