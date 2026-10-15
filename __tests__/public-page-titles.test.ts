// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

// /como-funciona renderiza o AppShell, que lê a sessão (`@/auth` → next-auth, que não
// carrega no vitest). Só o `metadata` interessa aqui.
vi.mock("@/auth", () => ({ auth: vi.fn(), signOut: vi.fn() }));

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
      absolute: "Palpiteiro · palpites de futebol e bolão entre amigos",
    });
  });

  it("a metadata da landing não fala jargão do motor (#579)", () => {
    const og = landingMetadata.openGraph as { description?: string } | undefined;
    for (const d of [String(landingMetadata.description), String(og?.description)]) {
      expect(d).not.toMatch(/\bedge\b|\bmotor\b|\bUM\b|cada jogo/);
    }
  });

  it("/como-funciona usa title.absolute (não duplica a marca)", () => {
    expect(comoFuncionaMetadata.title).toEqual({
      absolute: "Como funciona · Palpiteiro",
    });
  });

  it("a descrição de /como-funciona não fala jargão do motor (#579)", () => {
    expect(String(comoFuncionaMetadata.description)).not.toMatch(/\bedge\b|\bPASS\b/);
  });
});
