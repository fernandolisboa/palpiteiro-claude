import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Pino sem-paga (#165): o replay eval chama a API PAGA da Anthropic e é manual
// (`pnpm tsx scripts/replay-prompt-eval.ts`). Estes asserts garantem que ele
// NUNCA entre no caminho de test/CI por engano: (a) nenhuma config de Vitest /
// script de `package.json test` o referencia; (b) o próprio script tem a guarda
// `if (process.env.CI) throw`.

const repoRoot = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

describe("replay-prompt-eval — guarda sem-paga", () => {
  it("vitest.config.ts não referencia replay-prompt-eval", () => {
    expect(read("vitest.config.ts")).not.toContain("replay-prompt-eval");
  });

  it("o script test do package.json não invoca replay-prompt-eval", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    const testScript = pkg.scripts?.test ?? "";
    expect(testScript).not.toContain("replay-prompt-eval");
  });

  it("o script tem a guarda `if (process.env.CI) throw`", () => {
    const src = read("scripts/replay-prompt-eval.ts");
    expect(src).toContain("process.env.CI");
    // a guarda lança antes de qualquer requireEnv/chamada paga.
    expect(src).toMatch(/if\s*\(\s*process\.env\.CI\s*\)/);
  });
});
