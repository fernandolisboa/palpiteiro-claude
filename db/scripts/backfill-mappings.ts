/**
 * Lógica DETERMINÍSTICA do backfill multi-mercado (#162) como funções PURAS,
 * sem DB e sem LLM — para serem unit-testadas isoladamente. O runner
 * (`backfill-multimarket.ts`) usa estas funções; o que é testado é o que roda.
 *
 * Princípios (ADR 0015 D6 + ADR 0016 D2): o backfill é determinístico, idempotente
 * e NÃO fabrica fatos. Onde o dado degrada (par de odds ausente, split de placar
 * não confiável), produz null — nunca um valor plausível-mas-errado.
 */

export type Recommendation = "over" | "under" | "pass";
export type SelectionKey = "over" | "under";

/** `over`/`under` → a seleção homônima; `pass` → null (não há seleção, ADR 0015 D5). */
export function recommendationToSelectionKey(
  rec: Recommendation,
): SelectionKey | null {
  if (rec === "over") return "over";
  if (rec === "under") return "under";
  return null;
}

/**
 * Par congelado over/under (ADR 0012) → uma linha por seleção. Drizzle devolve
 * numeric como STRING; repassamos a string crua (sem re-formatar) pra preservar a
 * precisão exata gravada. Se QUALQUER lado do par for null (rows pré-ADR-0012, sem
 * backfill do par), retorna [] — a row degrada sem linhas, sem inventar odd.
 * Independe da `recommendation`: o par existe inclusive em `pass` (candidate set).
 */
export function frozenPairToSelectionOdds(
  overOdd: string | null,
  underOdd: string | null,
): Array<{ selectionKey: SelectionKey; odd: string }> {
  if (overOdd === null || underOdd === null) return [];
  return [
    { selectionKey: "over", odd: overOdd },
    { selectionKey: "under", odd: underOdd },
  ];
}

export type ResultData = {
  homeScore: number | null;
  awayScore: number | null;
  totalGoals: number;
};

/**
 * Monta o `result_data` (ADR 0016 D2) a partir do escalar settled `total_goals` +
 * o placar por lado de `matches`. `totalGoals` é cópia VERBATIM do escalar (o fato
 * sobre o qual a row foi liquidada — idênticos por construção). O split por lado só
 * é usado quando BATE com o total settled (`home + away === totalGoals`); caso
 * contrário degrada a `null` — `matches.home/away` pode ser stale ou full-time c/
 * prorrogação (ver memória football-data fullTime-includes-ET), e fabricar um split
 * que discorda do total seria um fato plausível-mas-errado (ADR 0016 D2 + princípio
 * "prefer skip over silent wrong settle").
 */
export function buildResultData(
  homeScore: number | null,
  awayScore: number | null,
  totalGoals: number,
): ResultData {
  const splitTrustworthy =
    homeScore !== null &&
    awayScore !== null &&
    homeScore + awayScore === totalGoals;
  return {
    homeScore: splitTrustworthy ? homeScore : null,
    awayScore: splitTrustworthy ? awayScore : null,
    totalGoals,
  };
}

/**
 * Snapshot binário (`match_odds_snapshots`) → 2 linhas por seleção pro
 * `selection_odds_snapshots`. `odd` é a string crua do Drizzle; `line` é numérico
 * (vai pro `market_params` jsonb). overround_pct/captured_at/bookmaker são copiados
 * pelo runner (mesmos pros dois lados — é o mesmo snapshot de origem).
 */
export function snapshotToSelectionRows(snap: {
  overOdd: string;
  underOdd: string;
  line: string;
}): Array<{ selectionKey: SelectionKey; odd: string; line: number }> {
  const line = Number(snap.line);
  return [
    { selectionKey: "over", odd: snap.overOdd, line },
    { selectionKey: "under", odd: snap.underOdd, line },
  ];
}
