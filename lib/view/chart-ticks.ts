// Ticks do eixo X do gráfico de banca (#574 linha 28d). Puro e sem importar lib/format
// (o gráfico é "use client" e lib/format puxa o motor de análise).

const MONTH_ABBR_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

// Dia civil do instante no fuso. `timeZone` explícito deixa a saída igual no SSR e na
// hidratação (#1); undefined = fuso do runtime (legado, fora das páginas).
function dayParts(iso: string, timeZone?: string): { day: number; month: number; year: number } {
  const d = new Date(iso);
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      day: "2-digit",
      month: "2-digit",
    }).formatToParts(d);
    const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return { day: pick("day"), month: pick("month"), year: pick("year") };
  }
  return { day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() };
}

/** "03 out" — rótulo do tick no fuso do usuário. */
export function formatTick(iso: string, timeZone?: string): string {
  const { day, month } = dayParts(iso, timeZone);
  return `${day.toString().padStart(2, "0")} ${MONTH_ABBR_PT[month - 1]}`;
}

/**
 * O `t` do PRIMEIRO ponto de cada dia civil (no fuso). A série tem um ponto por
 * liquidação, então vários pontos caem no mesmo dia e o eixo repetia a data.
 */
export function dayTicks(points: readonly { t: string }[], timeZone?: string): string[] {
  const seen = new Set<string>();
  const ticks: string[] = [];
  for (const p of points) {
    const { day, month, year } = dayParts(p.t, timeZone);
    const key = `${year}-${month}-${day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ticks.push(p.t);
  }
  return ticks;
}
