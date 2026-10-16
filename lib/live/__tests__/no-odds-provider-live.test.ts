import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Guarda de fonte (#580, PLAN-580 §14): nenhum caminho ao vivo busca odds. A tabela ao
// vivo mostra a ÚLTIMA captura de antes do apito, lida do banco; a cota da The Odds API
// não pode ser gasta com o jogo rolando.

const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const ODDS_FETCH = /@\/lib\/providers\/odds-api|@\/lib\/odds\/fetch-and-snapshot|ensureOddsSnapshotsFresh/;

describe("ao vivo não chama o provider de odds", () => {
  it.each([
    "lib/live/action-state.ts",
    "lib/live/in-play-state.ts",
    "lib/live/stamp.ts",
    "lib/bets/live-slip.ts",
    "lib/bets/slip-model.ts",
    "lib/bets/evaluate-slip.ts",
    "lib/view/live-score.ts",
    "lib/db/queries/reference-odds.ts",
    "app/actions/bet-slip.ts",
    "app/actions/bets.ts",
    "components/live-score-refresh.tsx",
    // Leitura ao vivo (#594).
    "lib/ai/markets/_narrator/live/index.ts",
    "lib/ai/markets/_narrator/live/prompt.ts",
  ])("%s não importa busca de odds", (file) => {
    expect(read(file)).not.toMatch(ODDS_FETCH);
  });

  it("a página do jogo só aquece odds no pré-jogo", () => {
    const src = read("app/(app)/match/[id]/page.tsx");
    const calls = src.match(/ensureOddsSnapshotsFresh\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(src).toMatch(
      /isPreMatchForOdds\(match, now\)\s*\?\s*ensureOddsSnapshotsFresh\(/
    );
  });

  // predict.ts importa o provider de odds (o pré-jogo precisa); a seção da leitura ao
  // vivo (#594) não pode usar nenhuma fronteira de odds, nem os dados de contexto do
  // pré-jogo, nem o JEV.
  it("predictInPlay não busca odds, contexto de pré-jogo nem JEV", () => {
    const src = read("lib/ai/predict.ts");
    const start = src.indexOf("// ─── Leitura ao vivo (#594");
    const end = src.indexOf("// ─── Motor code_jev", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section = src.slice(start, end);
    expect(section).toContain("export async function predictInPlay(");
    expect(section).not.toMatch(
      /getOddsProvider|getLatestFreshSelectionOddsSnapshots|ensureOddsSnapshotsFresh|pickBestBookmaker|collectIndependentBinaries|getSportsDataProvider|getAbsencesProvider|runJudgments|resolveMatchJudgments|startNewsFetch|runPredict\(/
    );
  });

  // "Analisar meu palpite" ao vivo (#594): sem busca de fatos (desfalques, forma,
  // tabela) depois do apito; a única chamada fica atrás de `!ctx.live`.
  it("analyzeUserPalpite só busca fatos fora do ao vivo", () => {
    const src = read("app/actions/user-palpite.ts");
    const calls = src.match(/fetchPalpiteFacts\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(src).toMatch(/!ctx\.live\s*&&[^?]*\?\s*await fetchPalpiteFacts\(/);
    expect(src).not.toMatch(/getSportsDataProvider|getAbsencesProvider/);
  });

  it("o ramo ao vivo do analyzeBestBet não aquece odds nem busca notícias", () => {
    const src = read("app/actions/predictions.ts");
    const start = src.indexOf("async function analyzeBestBetLive(");
    const end = src.indexOf("\ntype HeadlineOutcome", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(src.slice(start, end)).not.toMatch(
      /ensureOddsSnapshotsFresh|startNewsFetch|getOddsProvider|startAnalysisContextExtraction/
    );
  });
});
