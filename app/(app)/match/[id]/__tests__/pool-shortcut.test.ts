// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Atalho "criar bolão" da página do jogo (#580): segue a mesma janela do bolão ao vivo
// que /bolao e createFriendPool (`poolWindowOpen`, até os 15'). Sem passar a janela,
// `matchCapabilities` fecha o atalho no apito e o bolão ao vivo some da página.
const src = readFileSync(join(__dirname, "..", "page.tsx"), "utf8");

describe("app/(app)/match/[id]/page.tsx: atalho do bolão", () => {
  it("passa poolWindowOpen com o estado ao vivo pra matchCapabilities", () => {
    expect(src).toMatch(
      /poolWindowOpen:\s*poolWindowOpen\(match,\s*inPlayState,\s*now,\s*\{\s*liveMode\s*\}\)/
    );
  });
});
