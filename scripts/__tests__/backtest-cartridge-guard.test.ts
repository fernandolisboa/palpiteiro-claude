import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Pino sem-paga (#173, AC#3/#4): o backtest chama a API PAGA da Anthropic, é
// dev-only e manual (`pnpm tsx scripts/backtest-cartridge.ts --marketKey=…`).
// Estes asserts garantem que ele NUNCA entre no caminho de test/CI por engano:
// (a) nenhuma config de Vitest / script de `package.json test` o referencia;
// (b) o próprio script tem a guarda `if (process.env.CI) throw`. O teste NÃO
// importa nem executa o script (zero chamadas à API na suíte).

const repoRoot = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

describe("backtest-cartridge — guarda sem-paga", () => {
  it("vitest.config.ts não referencia backtest-cartridge", () => {
    expect(read("vitest.config.ts")).not.toContain("backtest-cartridge");
  });

  it("o script test do package.json não invoca backtest-cartridge", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    const testScript = pkg.scripts?.test ?? "";
    expect(testScript).not.toContain("backtest-cartridge");
  });

  it("o script tem a guarda `if (process.env.CI) throw`", () => {
    const src = read("scripts/backtest-cartridge.ts");
    expect(src).toContain("process.env.CI");
    // a guarda lança antes de qualquer requireEnv/chamada paga.
    expect(src).toMatch(/if\s*\(\s*process\.env\.CI\s*\)/);
  });
});
