// @vitest-environment node
import { describe, expect, it } from "vitest";

import { metadata } from "@/app/p/[id]/not-found";
import { NEUTRAL_DESCRIPTION } from "@/app/p/[id]/load-shared-palpite";

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
