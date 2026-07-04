// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { metadata as comoFuncionaMetadata } from "@/app/como-funciona/page";
import { metadata as landingMetadata } from "@/app/page";

/**
 * Guarda do double-brand no `<title>` (#441 subset).
 *
 * O root layout agora tem `title.template = "%s · Palpiteiro"`. Páginas cujo
 * título JÁ carrega a marca (landing, /como-funciona) precisam usar
 * `title.absolute` pra optar fora do template — senão o Next embrulha e sai
 * "... · Palpiteiro · Palpiteiro". Já /termos e /privacidade usam string simples
 * DE PROPÓSITO (querem o sufixo do template), então não entram aqui.
 *
 * O layout é lido do SOURCE (readFileSync) em vez de importado: `@/app/layout`
 * roda `Geist()` (next/font) + `import "./globals.css"`, que o vitest não
 * transforma — mesmo motivo pelo qual os guards irmãos leem source.
 */

describe("títulos das páginas públicas — opt-out do template", () => {
  it("o root layout define o title.template (a razão do opt-out existir)", () => {
    const source = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8");
    expect(source).toMatch(/template:\s*"%s · Palpiteiro"/);
  });

  it("a landing usa title.absolute (não duplica a marca)", () => {
    expect(landingMetadata.title).toEqual({
      absolute: "Palpiteiro · um palpite por jogo, com racional",
    });
  });

  it("/como-funciona usa title.absolute (não duplica a marca)", () => {
    expect(comoFuncionaMetadata.title).toEqual({
      absolute: "Como funciona · Palpiteiro",
    });
  });
});
