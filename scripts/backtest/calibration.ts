/*
 * Trilha de calibração (report 13): (1) de-vig proporcional vs Shin vs potência e
 * (2) mistura log-linear Dixon-Coles + mercado com peso por liga ajustado em
 * walk-forward. GRÁTIS: lê os snapshots versionados em data/backtest/ — zero chamada
 * de API, zero LLM. Determinístico.
 *
 *   npx tsx scripts/backtest/calibration.ts [--out report.md]
 *
 * De-vig: sem parâmetro ajustado, então avalia todo jogo com odds de todas as
 * temporadas do snapshot (paired diff contra o proporcional, IC 90% bootstrap).
 *
 * Mistura: DC refitado a cada dia de jogo (mesmo setup dos reports 10 e 12) nas
 * temporadas 2021–2025; o peso w da temporada s é ajustado SÓ nas temporadas < s
 * (janela expansível a partir de 2021) e aplicado em s. Período principal 2023–2025,
 * como nos reports anteriores. Duas versões do mercado: o fechamento (benchmark) e o
 * pré-fechamento (coletado dias antes, o análogo do snapshot de odds da produção).
 */
import { readFileSync, writeFileSync } from "node:fs";

import {
  blendLogLoss,
  fitBlendWeight,
  walkForwardBlend,
  type BlendMarket,
} from "@/lib/backtest/blend";
import { parseFootballDataCsv } from "@/lib/backtest/matches";
import {
  marketStrategy,
  pairedLogLossDiff,
  runBacktest,
  summarize,
  type EvaluatedMatch,
  type MarketOddsSource,
  type Strategy,
} from "@/lib/backtest/runner";
import { dixonColesStrategy } from "@/lib/backtest/strategies";
import { simulateValueBets } from "@/lib/backtest/value-bets";
import type { DevigMethod } from "@/lib/odds/implied-probability";
import { MIN_EDGE_PP } from "@/lib/odds/scenario";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const outPath = process.argv.includes("--out") ? arg("out", "") : null;

const LEAGUES = [
  { key: "BRA", label: "Brasileirão", csv: "data/backtest/BRA-2026-09-24.csv" },
  {
    key: "E0",
    label: "Premier League",
    csv: "data/backtest/E0-2026-10-13.csv",
  },
  { key: "SP1", label: "La Liga", csv: "data/backtest/SP1-2026-10-13.csv" },
] as const;

const BLEND_SEASONS = [2021, 2022, 2023, 2024, 2025];
const MAIN = new Set([2023, 2024, 2025]);
const METHODS: DevigMethod[] = ["proportional", "shin", "power"];
const BOOKS = ["pinnacle", "avg"] as const;
const SOURCES: MarketOddsSource[] = ["closing", "preClosing"];
const MARKETS: BlendMarket[] = ["1x2", "over25"];

// |x| < 0,00005 vira "0.0000" sem sinal: um peso w = 0 dá diferença exatamente 0, e
// "−0.0000" em negrito seria ruído de arredondamento lido como achado.
const f4 = (n: number) =>
  !Number.isFinite(n)
    ? "—"
    : Math.abs(n) < 5e-5
      ? "0.0000"
      : (n > 0 ? "+" : "") + n.toFixed(4);
// Limites de IC mantêm o sinal ("-0.0000"): um limite que arredonda pra zero
// ainda diz de que lado do 0 o intervalo está.
const f4ci = (n: number) =>
  Number.isFinite(n) ? (n >= 0 ? "+" : "") + n.toFixed(4) : "—";
const f4u = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : "—");
const bold = (s: string, on: boolean) => (on ? `**${s}**` : s);
const marketLabel = (m: BlendMarket) => (m === "1x2" ? "1X2" : "over 2.5");
const sourceLabel = (s: MarketOddsSource) =>
  s === "closing" ? "fechamento" : "pré-fechamento";

function diffCell(
  rows: readonly EvaluatedMatch[],
  a: string,
  b: string,
  market: BlendMarket,
): { text: string; n: number } {
  const d = pairedLogLossDiff(rows, a, b, market);
  if (d.n === 0) return { text: "—", n: 0 };
  const sig =
    Math.abs(d.meanDiff) >= 5e-5 && !!d.ci && (d.ci.hi < 0 || d.ci.lo > 0);
  const ci = d.ci ? ` [${f4ci(d.ci.lo)}, ${f4ci(d.ci.hi)}]` : "";
  return { text: bold(f4(d.meanDiff), sig) + ci, n: d.n };
}

const report: string[] = [];
const t0 = Date.now();

// ---------- (1) de-vig ----------
report.push(
  "## De-vig: Shin e potência vs proporcional",
  "",
  "Todas as temporadas de cada snapshot, todo jogo com odds. Log-loss do proporcional e diferença pareada (método − proporcional) com IC 90%; negativo = o método é melhor. Em negrito: IC inteiro de um lado do 0.",
  "",
  "| liga | odds | casa | mercado | n | margem média | log-loss proporcional | Shin − proporcional | potência − proporcional |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
);
const parsed = LEAGUES.map((l) => ({
  ...l,
  matches: parseFootballDataCsv(readFileSync(l.csv, "utf8")),
}));
for (const league of parsed) {
  const seasons = [...new Set(league.matches.map((m) => m.season))];
  const strategies: Strategy[] = [];
  for (const source of SOURCES)
    for (const book of BOOKS)
      for (const method of METHODS)
        strategies.push(marketStrategy({ source, book, method }));
  const rows = runBacktest(league.matches, strategies, {
    seasons,
    minSeasonGames: 0,
  });
  for (const source of SOURCES)
    for (const book of BOOKS)
      for (const market of MARKETS) {
        const name = (m: DevigMethod) => `mercado ${source} ${book} ${m}`;
        const base = summarize(rows, name("proportional"), market);
        if (base.n === 0) continue;
        const margins: number[] = [];
        for (const r of rows) {
          const m = r.match;
          const odds =
            market === "1x2"
              ? source === "closing"
                ? book === "pinnacle"
                  ? m.closingPinnacle
                  : m.closingAvg
                : book === "pinnacle"
                  ? m.preClosingPinnacle
                  : m.preClosingAvg
              : null;
          const ou =
            market === "over25"
              ? source === "closing"
                ? book === "pinnacle"
                  ? m.closingOu25Pinnacle
                  : m.closingOu25Avg
                : book === "pinnacle"
                  ? m.preClosingOu25Pinnacle
                  : m.preClosingOu25Avg
              : null;
          if (odds)
            margins.push(1 / odds.home + 1 / odds.draw + 1 / odds.away - 1);
          if (ou) margins.push(1 / ou.over + 1 / ou.under - 1);
        }
        const margin = margins.reduce((a, b) => a + b, 0) / margins.length;
        report.push(
          `| ${league.label} | ${sourceLabel(source)} | ${book === "pinnacle" ? "Pinnacle" : "média"} | ${marketLabel(market)} | ${base.n} | ${(margin * 100).toFixed(1)}% | ${f4u(base.logLoss)} | ${diffCell(rows, name("shin"), name("proportional"), market).text} | ${diffCell(rows, name("power"), name("proportional"), market).text} |`,
        );
      }
}
report.push("");

// ---------- (2) mistura DC + mercado ----------
const DC = "Dixon-Coles MLE";
const VARIANTS = SOURCES.flatMap((source) =>
  BOOKS.map((book) => ({ source, book })),
);
const MKT = (v: { source: MarketOddsSource; book: string }) =>
  `mercado ${v.source} ${v.book} proportional`;
const blended = parsed.map((league) => {
  const rows = runBacktest(
    league.matches,
    [
      dixonColesStrategy(),
      ...VARIANTS.map((v) => marketStrategy({ ...v, method: "proportional" })),
    ],
    { seasons: BLEND_SEASONS, minSeasonGames: 5 },
  );
  console.error(`${league.label}: ${rows.length} jogos avaliados`);
  return { league, rows };
});
const allRows = blended.flatMap((b) => b.rows);
const fmtW = (w: number | null | undefined) =>
  w === null || w === undefined ? "—" : w.toFixed(3);

report.push(
  "## Mistura Dixon-Coles + mercado",
  "",
  "Pool log-linear p ∝ DC^w · mercado^(1−w) (no over 2.5 é o logit ponderado), mercado de-vigado proporcional. w da temporada s ajustado só em 2021…s−1 da mesma liga (por liga) ou das três ligas juntas (global). Período principal 2023–2025. Diferença pareada de log-loss; negativo = a mistura é melhor. A Pinnacle some do football-data no meio de 2025/26, então as linhas de Pinnacle têm n menor que as da média.",
  "",
);

for (const v of VARIANTS) {
  const lines: string[] = [];
  for (const { league, rows } of blended) {
    const per = walkForwardBlend(rows, {
      name: "mistura",
      model: DC,
      market: MKT(v),
    });
    const glob = walkForwardBlend(per.rows, {
      name: "mistura global",
      model: DC,
      market: MKT(v),
      fitRows: allRows,
    });
    const main = glob.rows.filter((r) => MAIN.has(r.match.season));
    for (const market of MARKETS) {
      // DC e mercado nas MESMAS linhas em que a mistura opina neste mercado.
      const withBlend = main.filter((r) =>
        market === "1x2"
          ? !!r.byStrategy["mistura"]?.p1x2
          : r.byStrategy["mistura"]?.pOver25 !== undefined,
      );
      const bS = summarize(main, "mistura", market);
      if (bS.n === 0) continue;
      const ws = [2023, 2024, 2025]
        .map((s) => fmtW(per.weights[s]?.[market]))
        .join(", ");
      lines.push(
        `| ${league.label} | ${marketLabel(market)} | ${bS.n} | ${f4u(summarize(withBlend, DC, market).logLoss)} | ${f4u(summarize(withBlend, MKT(v), market).logLoss)} | ${f4u(bS.logLoss)} | ${diffCell(main, "mistura", MKT(v), market).text} | ${diffCell(main, "mistura", DC, market).text} | ${diffCell(main, "mistura global", MKT(v), market).text} | ${ws} |`,
      );
    }
  }
  if (lines.length === 0) continue;
  report.push(
    `### ${sourceLabel(v.source)}, ${v.book === "pinnacle" ? "Pinnacle" : "média das casas"}`,
    "",
    "| liga | mercado | n | log-loss DC | log-loss mercado | log-loss mistura | mistura − mercado | mistura − DC | global − mercado | w (2023, 2024, 2025) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...lines,
    "",
  );
}

// Peso ajustado em 2021–2025 inteiro: referência do que se gravaria hoje como
// constante por liga (in-sample; a avaliação honesta é a tabela walk-forward).
report.push(
  "### Peso ajustado em 2021–2025 inteiro (in-sample, referência)",
  "",
  `| liga | mercado | ${VARIANTS.map((v) => `w ${sourceLabel(v.source)} ${v.book === "pinnacle" ? "Pinnacle" : "média"}`).join(" | ")} |`,
  `| --- | --- | ${VARIANTS.map(() => "---").join(" | ")} |`,
);
for (const { league, rows } of blended) {
  for (const market of MARKETS) {
    const ws = VARIANTS.map((v) =>
      fmtW(fitBlendWeight(rows, DC, MKT(v), market)),
    );
    if (ws.every((w) => w === "—")) continue;
    report.push(
      `| ${league.label} | ${marketLabel(market)} | ${ws.join(" | ")} |`,
    );
  }
}
report.push("");

// Sem a restrição w ∈ [0, 1]: w < 0 = o resultado fica ainda mais longe do DC que
// o mercado (in-sample, só pra leitura; nada disso iria pra produção).
report.push(
  "### Ótimo sem restrição de w (in-sample, 2021–2025, mercado de fechamento da média)",
  "",
  "| liga | mercado | w ótimo em [−1, 1] | ganho de log-loss vs w = 0 |",
  "| --- | --- | --- | --- |",
);
for (const { league, rows } of blended) {
  const mkt = MKT({ source: "closing", book: "avg" });
  for (const market of MARKETS) {
    const w = fitBlendWeight(rows, DC, mkt, market, 0.005, [-1, 1]);
    if (w === null) continue;
    const gain =
      blendLogLoss(rows, DC, mkt, market, w) -
      blendLogLoss(rows, DC, mkt, market, 0);
    report.push(
      `| ${league.label} | ${marketLabel(market)} | ${w.toFixed(3)} | ${f4(gain)} |`,
    );
  }
}
report.push("");

// ---------- (3) apostas de valor do DC puro ----------
const PRICES: {
  label: string;
  source: MarketOddsSource;
  book: "pinnacle" | "avg";
}[] = [
  { label: "pré-fechamento, Pinnacle", source: "preClosing", book: "pinnacle" },
  { label: "pré-fechamento, média", source: "preClosing", book: "avg" },
  { label: "fechamento, média", source: "closing", book: "avg" },
];
const priceOf = (source: MarketOddsSource, book: "pinnacle" | "avg") => ({
  odds1x2: (r: EvaluatedMatch) =>
    source === "closing"
      ? book === "pinnacle"
        ? r.match.closingPinnacle
        : r.match.closingAvg
      : book === "pinnacle"
        ? r.match.preClosingPinnacle
        : r.match.preClosingAvg,
  oddsOu25: (r: EvaluatedMatch) =>
    source === "closing"
      ? book === "pinnacle"
        ? r.match.closingOu25Pinnacle
        : r.match.closingOu25Avg
      : book === "pinnacle"
        ? r.match.preClosingOu25Pinnacle
        : r.match.preClosingOu25Avg,
});
const pct = (x: number) =>
  Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%` : "—";
const pctCi = (x: number, ci: { lo: number; hi: number } | null) =>
  bold(pct(x), !!ci && (ci.hi < 0 || ci.lo > 0)) +
  (ci ? ` [${pct(ci.lo)}, ${pct(ci.hi)}]` : "");
report.push(
  "## Apostas de valor do Dixon-Coles puro",
  "",
  `O jeito que a produção decide, sem JEV nem notícias: por jogo e mercado, a seleção de maior edge (DC − implícita de-vigada da mesma casa) entra se o edge ≥ ${MIN_EDGE_PP} pp; 1 unidade na odd. ROI = lucro médio por unidade apostada; CLV = odd × p(fechamento Pinnacle de-vigado, senão média) − 1. Período principal 2023–2025, IC 90% bootstrap. Apostar no fechamento tem CLV ≈ −margem por definição, então ali só o ROI conta.`,
  "",
  "| liga | odds da aposta | mercado | de-vig do edge | apostas | ROI | CLV |",
  "| --- | --- | --- | --- | --- | --- | --- |",
);
for (const { league, rows } of blended) {
  const main = rows.filter((r) => MAIN.has(r.match.season));
  for (const price of PRICES)
    for (const market of MARKETS)
      for (const method of ["proportional", "shin"] as const) {
        const s = simulateValueBets(main, {
          model: DC,
          market,
          price: priceOf(price.source, price.book),
          method,
          minEdgePp: MIN_EDGE_PP,
        });
        if (s.bets === 0) continue;
        report.push(
          `| ${league.label} | ${price.label} | ${marketLabel(market)} | ${method === "shin" ? "Shin" : "proporcional"} | ${s.bets} | ${pctCi(s.roi, s.roiCi)} | ${price.source === "closing" ? "—" : pctCi(s.clv, s.clvCi)} |`,
        );
      }
}
report.push("");

const text = [
  "# Calibração: de-vig de Shin e mistura Dixon-Coles + mercado",
  "",
  `Gerado por \`scripts/backtest/calibration.ts\` em ${((Date.now() - t0) / 1000).toFixed(0)}s.`,
  "",
  ...report,
].join("\n");
console.log(text);
if (outPath) writeFileSync(outPath, text + "\n");
