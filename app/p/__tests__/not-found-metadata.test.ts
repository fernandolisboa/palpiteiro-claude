// @vitest-environment node
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { metadata } from "@/app/p/[id]/not-found";
import { metadata as segmentMetadata } from "@/app/p/layout";
import { NEUTRAL_DESCRIPTION } from "@/app/p/[id]/load-shared-palpite";

// #416 — guarda ESTRUTURAL do 404 real: a ausência de loading.tsx em /p é o que entrega o
// HARD-404 (com um loading boundary, o Next streama o skeleton com HTTP 200 ANTES de o
// notFound() disparar → soft-404). loading.tsx é a convenção DEFAULT do repo (8 outras rotas
// têm a sua), então um re-add acidental (ex.: passe de consistência/polish) reintroduz o
// soft-404 silenciosamente — passa typecheck/lint/testes e só vaza via curl -I em prod. Esta
// asserção falha alto no momento do re-add. Espelha o padrão existsSync de country-codes.test.ts.
describe("/p sem loading.tsx (#416) — guarda do 404 real contra soft-404", () => {
  it("app/p/[id]/loading.tsx NÃO existe", () => {
    expect(existsSync(join(process.cwd(), "app/p/[id]/loading.tsx"))).toBe(false);
  });
});

// #416 / privacy MAJOR 3: no HARD-404 (sem loading.tsx em /p, ver page.tsx) o Next descarta
// o generateMetadata da página e resolve a metadata DESTA boundary. Sem export próprio aqui,
// a description "Recomendações de aposta…" da root layout cascateia pra og:description num
// dead-link público regulatório. Este teste pina a description NEUTRA + noindex como guarda
// de regressão: se alguém remover o export de metadata do not-found.tsx, isto falha.
describe("not-found.tsx metadata (#416) — dead-link NÃO vaza linguagem de valor da root", () => {
  it("description NEUTRA + robots noindex/nofollow", () => {
    expect(metadata.description).toBe(NEUTRAL_DESCRIPTION);
    expect(metadata.openGraph?.description).toBe(NEUTRAL_DESCRIPTION);
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("NUNCA contém a description 'Recomendações de aposta' da root layout", () => {
    expect(JSON.stringify(metadata)).not.toContain("Recomendações de aposta");
  });
});

// #416 — piso do segmento /p (app/p/layout.tsx): mesma invariante neutra herdada por toda
// boundary sob /p (defense-in-depth contra uma boundary futura sem export próprio).
describe("app/p/layout.tsx metadata (#416) — piso neutro do segmento", () => {
  it("description NEUTRA + robots noindex/nofollow; sem 'Recomendações de aposta'", () => {
    expect(segmentMetadata.description).toBe(NEUTRAL_DESCRIPTION);
    expect(segmentMetadata.openGraph?.description).toBe(NEUTRAL_DESCRIPTION);
    expect(segmentMetadata.robots).toEqual({ index: false, follow: false });
    expect(JSON.stringify(segmentMetadata)).not.toContain("Recomendações de aposta");
  });
});
