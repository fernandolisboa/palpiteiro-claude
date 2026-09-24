/*
 * Backtest walk-forward do Dixon-Coles MLE vs o λ heurístico de produção (ADR 0039
 * D2, #502). GRÁTIS: lê o snapshot versionado em data/backtest/ — zero chamada de
 * API, zero LLM. Determinístico (mesmo snapshot → mesmo relatório).
 *
 *   npx tsx scripts/backtest/run.ts [--csv data/backtest/BRA-2026-09-24.csv]
 *                                   [--seasons 2023,2024,2025] [--out report.md]
 *
 * Imprime (e opcionalmente grava) um relatório markdown: log-loss/Brier por
 * estratégia e temporada, e as diferenças PAREADAS com IC 90% bootstrap. Critério
 * de GO do ADR 0039: DC − heurístico em P(over 2.5) com o limite SUPERIOR do IC < 0.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { parseFootballDataCsv } from "@/lib/backtest/matches";
import {
  closingMarketStrategy,
  pairedLogLossDiff,
  runBacktest,
  summarize,
  type EvaluatedMatch,
  type Strategy,
} from "@/lib/backtest/runner";
import {
  baseRateStrategy,
  dixonColesStrategy,
  heuristicStrategy,
} from "@/lib/backtest/strategies";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const csvPath = arg("csv", "data/backtest/BRA-2026-09-24.csv");
const seasons = arg("seasons", "2023,2024,2025").split(",").map(Number);
const outPath = process.argv.includes("--out") ? arg("out", "") : null;
const MIN_SEASON_GAMES = 5;

const matches = parseFootballDataCsv(readFileSync(csvPath, "utf8"));
const dc = dixonColesStrategy();
const base = baseRateStrategy();
const strategies: Strategy[] = [
  base,
  heuristicStrategy,
  dc,
  closingMarketStrategy,
];

const t0 = Date.now();
const evaluated = runBacktest(matches, strategies, {
  seasons,
  minSeasonGames: MIN_SEASON_GAMES,
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

const f3 = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : "—");
const ci = (d: ReturnType<typeof pairedLogLossDiff>) =>
  d.ci ? `[${f3(d.ci.lo)}, ${f3(d.ci.hi)}]` : "—";

function metricsTable(
  rows: readonly EvaluatedMatch[],
  market: "1x2" | "over25",
): string[] {
  const names =
    market === "over25"
      ? [base.name, heuristicStrategy.name, dc.name]
      : strategies.map((s) => s.name);
  const lines = [
    "| estratégia | n | log-loss | Brier |",
    "| --- | --- | --- | --- |",
  ];
  for (const name of names) {
    const s = summarize(rows, name, market);
    lines.push(`| ${name} | ${s.n} | ${f3(s.logLoss)} | ${f3(s.brier)} |`);
  }
  return lines;
}

function diffLine(
  rows: readonly EvaluatedMatch[],
  a: string,
  b: string,
  market: "1x2" | "over25",
): string {
  const d = pairedLogLossDiff(rows, a, b, market);
  return `| ${a} − ${b} | ${market === "over25" ? "over 2.5" : "1X2"} | ${d.n} | ${f3(d.meanDiff)} | ${ci(d)} |`;
}

const report: string[] = [];
report.push(
  `# Backtest: Dixon-Coles MLE vs λ heurístico (ADR 0039, #502)`,
  "",
  `Snapshot: \`${csvPath}\` · temporadas avaliadas: ${seasons.join(", ")} · aquecimento: os dois times com ≥ ${MIN_SEASON_GAMES} jogos na temporada · ${evaluated.length} jogos avaliados · ${elapsed}s.`,
  "",
  "Walk-forward: cada jogo só vê jogos de dias anteriores. DC refitado a cada dia de jogo (ξ = 0.0019/dia, janela 3 anos, prior de 2 gols). Heurístico = `computeMatchLambdas` de produção sobre a tabela reconstruída da temporada. Mercado = fechamento 1X2 de-vigado (Pinnacle, senão média).",
  "",
  "## Critério de GO (over 2.5)",
  "",
  "| diferença (a − b) | mercado | n | média | IC 90% |",
  "| --- | --- | --- | --- | --- |",
  diffLine(evaluated, dc.name, heuristicStrategy.name, "over25"),
  diffLine(evaluated, dc.name, heuristicStrategy.name, "1x2"),
  diffLine(evaluated, dc.name, closingMarketStrategy.name, "1x2"),
  diffLine(
    evaluated,
    heuristicStrategy.name,
    closingMarketStrategy.name,
    "1x2",
  ),
  diffLine(evaluated, dc.name, base.name, "over25"),
  diffLine(evaluated, heuristicStrategy.name, base.name, "over25"),
  "",
);
const go = pairedLogLossDiff(
  evaluated,
  dc.name,
  heuristicStrategy.name,
  "over25",
);
report.push(
  `**Veredito:** ${go.ci && go.ci.hi < 0 ? "GO — o DC bate o heurístico em over 2.5 com o IC inteiro abaixo de 0." : "NO-GO — o IC da diferença em over 2.5 não fica inteiro abaixo de 0."}`,
  "",
  "## Todas as temporadas",
  "",
  "### Over 2.5",
  "",
  ...metricsTable(evaluated, "over25"),
  "",
  "### 1X2",
  "",
  ...metricsTable(evaluated, "1x2"),
  "",
);
for (const season of seasons) {
  const rows = evaluated.filter((e) => e.match.season === season);
  report.push(
    `## ${season}`,
    "",
    "### Over 2.5",
    "",
    ...metricsTable(rows, "over25"),
    "",
    "### 1X2",
    "",
    ...metricsTable(rows, "1x2"),
    "",
  );
}

const text = report.join("\n");
console.log(text);
if (outPath) writeFileSync(outPath, text + "\n");
