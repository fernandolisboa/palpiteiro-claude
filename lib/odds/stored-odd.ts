// A odd como `prediction_selection_odds.odd` (`numeric(6,3)`) a grava. O insert manda o
// texto de `toFixed(3)`; o palpite em memória usa o MESMO arredondamento, pra o run e o
// "Gerar só o palpite" (que lê do banco) darem o mesmo palpite (#668). `toFixed` não é
// `Math.round(x * 1000) / 1000`: em 2.0025 o primeiro dá 2.002 e o segundo 2.003.

/** Texto que vai pro insert da coluna `numeric(6,3)`. */
export function storedOddText(odd: number): string {
  return odd.toFixed(3);
}

/** A odd que volta do banco depois do insert. */
export function asStoredOdd(odd: number): number {
  return Number(storedOddText(odd));
}
