// Formatadores numéricos de TELA em pt-BR (vírgula decimal, #574 linha 15).
// Puro e sem imports: seguro em componente "use client" (lib/format puxa o motor
// de análise). O sinal negativo continua o hífen ASCII do toFixed, porque a UI
// decide o tom com `startsWith("-")`. Nada aqui vai pra prompt de LLM.

const DASH = "—";

function toFinite(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

/** `toFixed` com vírgula decimal: formatDecimal(1.5, 2) → "1,50". */
export function formatDecimal(n: number, decimals: number): string {
  return n.toFixed(decimals).replace(".", ",");
}

/** "1,92" — odd decimal com 2 casas. Aceita string (numeric do Drizzle) ou number. */
export function formatOdd(value: number | string | null | undefined): string {
  const n = toFinite(value);
  return n === null ? DASH : formatDecimal(n, 2);
}

/** A odd na precisão de exibição do formatOdd, como número (pra comparar o que a tela mostra). */
export function roundOdd(value: number): number {
  return Number(value.toFixed(2));
}

/** "58%" ou "50,7%". Para 0-100 com até 1 casa decimal quando precisa. */
export function formatPct(
  value: number | string | null | undefined,
  opts: { decimals?: number } = {},
): string {
  const n = toFinite(value);
  if (n === null) return DASH;
  const decimals = opts.decimals ?? (Math.abs(n - Math.round(n)) > 0.05 ? 1 : 0);
  return `${formatDecimal(n, decimals)}%`;
}

/** "+7,3" / "-2,1" / null se input null. Com unidade: formatEdgePoints. */
export function formatEdge(value: number | string | null | undefined): string | null {
  const n = toFinite(value);
  if (n === null) return null;
  return `${n > 0 ? "+" : ""}${formatDecimal(n, 1)}`;
}

/**
 * "+5,6 pontos" / "-2,1 pontos" / null se input null: a vantagem (edge) em pontos
 * percentuais com a unidade por extenso (ADR 0056). Sinal ASCII, como formatEdge.
 */
export function formatEdgePoints(value: number | string | null | undefined): string | null {
  const edge = formatEdge(value);
  return edge === null ? null : `${edge} pontos`;
}

/** Saída de formatEvPct quando o retorno arredonda a zero na exibição. */
export const EV_ZERO_LABEL = "0,0%";

/**
 * "+11,4%" / "-4,0%" / "—" se null. Recebe a FRAÇÃO por unidade (saída crua de
 * computeEvPerUnit) e multiplica por 100 internamente — diferente da família
 * formatEdge/formatPct, que recebe valores já em escala de exibição. Valores que
 * arredondam a zero normalizam pra "0,0%" sem sinal — nem "+0,0%" nem o "-0,0%"
 * de signed zero, que afirmam direção que o número não mostra.
 */
export function formatEvPct(evPerUnit: number | null): string {
  if (evPerUnit === null || !Number.isFinite(evPerUnit)) return DASH;
  const pct = evPerUnit * 100;
  const fixed = pct.toFixed(1);
  if (fixed === "0.0" || fixed === "-0.0") return EV_ZERO_LABEL;
  return `${pct > 0 ? "+" : ""}${formatDecimal(pct, 1)}%`;
}

/** Linha de gols: 2.5 → "2,5", 3 → "3". Aceita string ("2.5", chave de grupo). */
export function formatLine(value: number | string | null | undefined): string {
  const n = toFinite(value);
  return n === null ? DASH : String(n).replace(".", ",");
}

/**
 * "+1,50 u" / "-1,00 u" (signed) ou "1,00 u". Toda string `numeric` do Drizzle
 * deve virar número ANTES de chamar. "—" em non-finite.
 */
export function formatUnits(
  value: number,
  opts: { signed?: boolean; decimals?: number } = {},
): string {
  if (!Number.isFinite(value)) return DASH;
  const sign = opts.signed && value >= 0 ? "+" : "";
  return `${sign}${formatDecimal(value, opts.decimals ?? 2)} u`;
}

/**
 * "0,5u" / "1u" / "1,25u" — unidades compactas, sem zeros à direita (cupom e
 * /apostas). `decimals` é o arredondamento antes de cortar os zeros.
 */
export function formatUnitsCompact(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return DASH;
  const fixed = value.toFixed(decimals);
  const trimmed = fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
  return `${trimmed === "-0" ? "0" : trimmed.replace(".", ",")}u`;
}
