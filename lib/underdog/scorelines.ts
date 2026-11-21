import type { ScorelineMatrix } from "@/lib/quant/scoreline-model";

import { UNDERDOG_SCORELINES } from "./constants";
import type { UnderdogScoreline, UnderdogSide } from "./types";

// Os placares de vitória do azarão mais prováveis (#671): as células da matriz refeita
// em que o azarão vence, por p desc (empate de p → menos gols, depois menos gols do
// mandante, como topScorelines). `topScorelines` da row guarda só os 5 do jogo inteiro,
// e os de zebra quase nunca estão lá.

const round1 = (n: number) => Math.round(n * 10) / 10;

export function underdogScorelines(
  matrix: ScorelineMatrix,
  side: UnderdogSide,
  n: number = UNDERDOG_SCORELINES
): UnderdogScoreline[] {
  const cells: { home: number; away: number; p: number }[] = [];
  for (let h = 0; h <= matrix.maxGoals; h++) {
    for (let a = 0; a <= matrix.maxGoals; a++) {
      const wins = side === "home" ? h > a : a > h;
      if (wins) cells.push({ home: h, away: a, p: matrix.cells[h][a] });
    }
  }
  cells.sort(
    (x, y) =>
      y.p - x.p || x.home + x.away - (y.home + y.away) || x.home - y.home
  );
  return cells
    .slice(0, Math.max(0, n))
    .map((c) => ({ home: c.home, away: c.away, pct: round1(c.p * 100) }));
}
