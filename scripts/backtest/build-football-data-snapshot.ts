/*
 * Monta o snapshot versionado de uma liga europeia do football-data.co.uk no MESMO
 * schema do `data/backtest/BRA-*.csv` (o que `parseFootballDataCsv` lê), pra rodar
 * `scripts/backtest/run.ts` em outras ligas sem mudar o runner.
 *
 * O football-data publica as ligas europeias em um CSV por temporada
 * (`mmz4281/<aabb>/<div>.csv`, ex.: 2324/E0.csv = Premier League 2023/24), com
 * colunas diferentes do arquivo único do Brasileirão. Este script NÃO baixa nada:
 * lê os arquivos que você baixou (zero fetch, reproduzível pelo snapshot):
 *
 *   mkdir -p /tmp/fd && for s in 1819 1920 2021 2122 2223 2324 2425 2526; do
 *     curl -sSL -o /tmp/fd/E0_$s.csv https://football-data.co.uk/mmz4281/$s/E0.csv
 *   done
 *   npx tsx scripts/backtest/build-football-data-snapshot.ts --div E0 --dir /tmp/fd \
 *     --seasons 1819,1920,2021,2122,2223,2324,2425,2526 \
 *     --out data/backtest/E0-2026-10-13.csv
 *
 * Season = ano de INÍCIO (2023 = 2023/24), pra a temporada ser um inteiro como no
 * Brasileirão. Além das odds de fechamento 1X2 (PSC*, AvgC*), copia as de
 * fechamento de over/under 2.5 (PC>2.5, PC<2.5, AvgC>2.5, AvgC<2.5), que o arquivo
 * do Brasileirão não tem — é o benchmark de mercado do over 2.5 — e as de
 * PRÉ-fechamento dos dois mercados (PS*, Avg*, P>2.5, Avg>2.5). Temporadas antigas
 * sem alguma coluna (ex.: 2018/19 não tem AvgC*) saem com a célula vazia; servem só
 * de histórico pro ajuste.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const COUNTRY: Record<string, [string, string]> = {
  E0: ["England", "Premier League"],
  SP1: ["Spain", "La Liga"],
  I1: ["Italy", "Serie A"],
  D1: ["Germany", "Bundesliga"],
  F1: ["France", "Ligue 1"],
};

// Colunas de saída → coluna de origem no CSV por temporada.
const ODDS_COLUMNS = [
  "PSCH",
  "PSCD",
  "PSCA",
  "AvgCH",
  "AvgCD",
  "AvgCA",
  "PC>2.5",
  "PC<2.5",
  "AvgC>2.5",
  "AvgC<2.5",
  // Pré-fechamento (coletadas dias antes do jogo): o análogo das odds que a
  // produção vê ao analisar (report 13).
  "PSH",
  "PSD",
  "PSA",
  "AvgH",
  "AvgD",
  "AvgA",
  "P>2.5",
  "P<2.5",
  "Avg>2.5",
  "Avg<2.5",
] as const;

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v) throw new Error(`faltou --${name}`);
  return v;
}

/** dd/mm/yy (temporadas antigas) ou dd/mm/yyyy → dd/mm/yyyy. */
function normalizeDate(raw: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(raw);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${m[1]}/${m[2]}/${year}`;
}

const div = arg("div");
const dir = arg("dir");
const seasons = arg("seasons").split(",");
const out = arg("out");
const [country, league] = COUNTRY[div] ?? [div, div];

const header = [
  "Country",
  "League",
  "Season",
  "Date",
  "Time",
  "Home",
  "Away",
  "HG",
  "AG",
  "Res",
  ...ODDS_COLUMNS,
];
const rows: string[] = [header.join(",")];

for (const code of seasons) {
  if (!/^\d{4}$/.test(code)) throw new Error(`temporada inválida: ${code}`);
  const startYear = 2000 + Number(code.slice(0, 2));
  const text = readFileSync(join(dir, `${div}_${code}.csv`), "latin1");
  const lines = text
    // BOM UTF-8 lido como latin1 vira "ï»¿".
    .replace(/^(\uFEFF|\u00EF\u00BB\u00BF)/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  const cols = lines[0].split(",").map((c) => c.trim());
  const idx = (c: string) => cols.indexOf(c);
  let kept = 0;
  for (const line of lines.slice(1)) {
    // O CSV do football-data não tem campos entre aspas (mesma premissa do parser).
    const cells = line.split(",").map((c) => c.trim());
    const get = (c: string) => (idx(c) >= 0 ? (cells[idx(c)] ?? "") : "");
    const date = normalizeDate(get("Date"));
    if (!date || !get("HomeTeam") || !get("AwayTeam")) continue;
    rows.push(
      [
        country,
        league,
        String(startYear),
        date,
        get("Time"),
        get("HomeTeam"),
        get("AwayTeam"),
        get("FTHG"),
        get("FTAG"),
        get("FTR"),
        ...ODDS_COLUMNS.map(get),
      ].join(","),
    );
    kept += 1;
  }
  console.error(`${div} ${code}: ${kept} jogos`);
}

writeFileSync(out, rows.join("\n") + "\n");
console.error(`gravado ${out} (${rows.length - 1} jogos)`);
