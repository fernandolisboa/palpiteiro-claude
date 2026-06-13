import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import type { LeagueKey } from "@/lib/view/types";

export const LEAGUE_LABEL: Record<LeagueKey, string> = {
  bsa: "Brasileirão",
  ucl: "Champions",
  wc: "Copa do Mundo",
};

// Exhaustive map (compile error if a SupportedLeague is left unmapped).
const LEAGUE_KEY_BY_LEAGUE: Record<SupportedLeague, LeagueKey> = {
  brasileirao_a: "bsa",
  champions_league: "ucl",
  world_cup: "wc",
};

export function leagueToKey(league: SupportedLeague): LeagueKey {
  return LEAGUE_KEY_BY_LEAGUE[league];
}

const MONTH_ABBR_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

const WEEKDAY_ABBR_PT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isNextDay(a: Date, base: Date): boolean {
  const next = new Date(base);
  next.setDate(next.getDate() + 1);
  return isSameDay(a, next);
}

function hhmm(d: Date): string {
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * "em 3h 24min" para kickoffs em <24h; "amanhã, 16:00" pro próximo dia;
 * "qui, 21:00" pra esta semana; "DD mmm" pra mais distante.
 */
export function formatKickoffRelative(
  kickoff: Date,
  now: Date = new Date(),
): string {
  const deltaMs = kickoff.getTime() - now.getTime();
  if (deltaMs > 0 && deltaMs < 24 * 60 * 60 * 1000 && isSameDay(kickoff, now)) {
    const totalMin = Math.floor(deltaMs / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `em ${m}min`;
    return `em ${h}h ${m.toString().padStart(2, "0")}min`;
  }
  if (isNextDay(kickoff, now)) {
    return `amanhã, ${hhmm(kickoff)}`;
  }
  const within7d = deltaMs > 0 && deltaMs < 7 * 24 * 60 * 60 * 1000;
  if (within7d) {
    return `${WEEKDAY_ABBR_PT[kickoff.getDay()]}, ${hhmm(kickoff)}`;
  }
  return `${kickoff.getDate().toString().padStart(2, "0")} ${MONTH_ABBR_PT[kickoff.getMonth()]}`;
}

/**
 * "hoje, 21:30" / "amanhã, 16:00" / "qua, 23 mai". Usado no MatchHero.
 */
export function formatKickoffAbsolute(
  kickoff: Date,
  now: Date = new Date(),
): string {
  if (isSameDay(kickoff, now)) return `hoje, ${hhmm(kickoff)}`;
  if (isNextDay(kickoff, now)) return `amanhã, ${hhmm(kickoff)}`;
  const wk = WEEKDAY_ABBR_PT[kickoff.getDay()];
  const day = kickoff.getDate().toString().padStart(2, "0");
  const mon = MONTH_ABBR_PT[kickoff.getMonth()];
  return `${wk}, ${day} ${mon}`;
}

/**
 * "em 3h 24min" se < 24h; null caso contrário. Aparece como `countdown` no hero
 * apenas em jogos iminentes.
 */
export function formatCountdown(
  kickoff: Date,
  now: Date = new Date(),
): string | undefined {
  const deltaMs = kickoff.getTime() - now.getTime();
  if (deltaMs <= 0 || deltaMs >= 24 * 60 * 60 * 1000) return undefined;
  if (!isSameDay(kickoff, now)) return undefined;
  return formatKickoffRelative(kickoff, now);
}

/**
 * "1.92" — odd decimal com 2 casas. Aceita string (numeric do Drizzle) ou number.
 */
export function formatOdd(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

/**
 * "58%" ou "50.7%". Para 0-100 com até 1 casa decimal quando precisa.
 */
export function formatPct(
  value: number | string | null | undefined,
  opts: { decimals?: number } = {},
): string {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  const decimals = opts.decimals ?? (Math.abs(n - Math.round(n)) > 0.05 ? 1 : 0);
  return `${n.toFixed(decimals)}%`;
}

/**
 * "+7.3" / "-2.1" / null se input null. Componente concatena "pp" no render.
 */
export function formatEdge(
  value: number | string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return null;
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}`;
}

/**
 * "+11.4%" / "-4.0%" / "—" se null. Recebe a FRAÇÃO por unidade (saída crua de
 * computeEvPerUnit) e multiplica por 100 internamente — diferente da família
 * formatEdge/formatPct, que recebe valores já em escala de exibição. Negativo
 * usa o hífen ASCII do toFixed (convenção formatEdge). Valores que arredondam
 * a zero na exibição normalizam pra "0.0%" sem sinal — nem "+0.0%" nem o
 * "-0.0%" de signed zero, que afirmam direção que o número não mostra.
 */
export function formatEvPct(evPerUnit: number | null): string {
  if (evPerUnit === null || !Number.isFinite(evPerUnit)) return "—";
  const pct = evPerUnit * 100;
  const fixed = pct.toFixed(1);
  if (fixed === "0.0" || fixed === "-0.0") return "0.0%";
  return `${pct > 0 ? "+" : ""}${fixed}%`;
}

/**
 * "+1.00 u" / "-1.00 u" — unidades de stake/lucro COM sinal (2 casas). Convenção
 * única do dashboard (#170 centraliza aqui pra stake da análise não divergir).
 * Toda string `numeric` do Drizzle deve virar número ANTES de chamar. "—" em
 * non-finite.
 */
export function formatUnitsSigned(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)} u`;
}

/**
 * "1.00 u" — stake em unidades SEM sinal (2 casas), formato do drill-down do
 * dashboard (`prediction.stake`). Reusa formatUnitsSigned e tira o "+" pra não
 * divergir da convenção (R3). null/non-finite → null (sem aposta).
 */
export function formatStakeUnits(value: number | string | null): string | null {
  if (value === null) return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return null;
  return formatUnitsSigned(n).replace("+", "");
}

/**
 * "$0.014" — 3 casas decimais com prefixo $. Preserva formato do preview #33.
 */
export function formatCostUsd(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "$0.000";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "$0.000";
  return `$${n.toFixed(3)}`;
}

/**
 * "$1.23" — 2 casas decimais com prefixo $. Para TOTAIS agregados (admin de
 * custos #13), onde 2 casas leem melhor que as 3 do formatCostUsd por-linha.
 * Aceita string (SUM numeric do Drizzle) ou number; null/NaN → "$0.00".
 */
export function formatCostUsdTotal(
  value: number | string | null | undefined,
): string {
  if (value === null || value === undefined) return "$0.00";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "$0.00";
  return `$${n.toFixed(2)}`;
}

/**
 * "19 mai · 14:22" — formato do `generatedAt` no preview #33.
 */
export function formatGeneratedAt(date: Date): string {
  const day = date.getDate().toString().padStart(2, "0");
  const mon = MONTH_ABBR_PT[date.getMonth()];
  return `${day} ${mon} · ${hhmm(date)}`;
}

/**
 * "2min" / "12min" / "1h" / "2d" — usado no OddsCard "atualizado há X".
 */
export function formatRelativeAgo(
  past: Date,
  now: Date = new Date(),
): string {
  const deltaMs = Math.max(0, now.getTime() - past.getTime());
  const min = Math.floor(deltaMs / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/**
 * "claude-sonnet-4-5-20250929" → "claude-sonnet-4.5". Encurta o sufixo de
 * versão pra exibição mais compacta sem perder a identidade do modelo.
 */
export function formatModelName(modelVersion: string): string {
  const match = /^(claude-[a-z]+)-(\d+)-(\d+)(?:-\d+)?$/.exec(modelVersion);
  if (!match) return modelVersion;
  return `${match[1]}-${match[2]}.${match[3]}`;
}
