export const fmt = {
  pct: (n: number | null | undefined, digits = 1): string => {
    if (n == null || Number.isNaN(n)) return "—";
    const sign = n > 0 ? "+" : n < 0 ? "−" : "";
    return sign + Math.abs(n).toFixed(digits).replace(".", ",") + "%";
  },
  pp: (n: number | null | undefined, digits = 1): string => {
    if (n == null || Number.isNaN(n)) return "—";
    const sign = n > 0 ? "+" : n < 0 ? "−" : "";
    return sign + Math.abs(n).toFixed(digits).replace(".", ",") + " pp";
  },
  conf: (n: number | null | undefined): string =>
    n == null ? "—" : `${Math.round(n)}%`,
  odd: (n: number | null | undefined): string =>
    n == null ? "—" : n.toFixed(2).replace(".", ","),
  units: (n: number | null | undefined, digits = 2): string => {
    if (n == null) return "—";
    if (n === 0) return "0,00 u";
    const sign = n > 0 ? "+" : "−";
    return sign + Math.abs(n).toFixed(digits).replace(".", ",") + " u";
  },
};
