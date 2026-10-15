import {
  ANALYSIS_ENGINE_LABEL,
  engineFromModelVersion,
  liveModelFromVersion,
} from "@/lib/ai/engine/analysis-engine";
import type { PredictionJudgments } from "@/lib/ai/engine/types";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import type { LeagueKey } from "@/lib/view/types";
import { formatUnits } from "@/lib/format-number";

export const LEAGUE_LABEL: Record<LeagueKey, string> = {
  bsa: "Brasileirão",
  ucl: "Champions",
  wc: "Copa do Mundo",
  sa: "Serie A",
  bl: "Bundesliga",
  l1: "Ligue 1",
  lib: "Libertadores",
  sula: "Sul-Americana",
  epl: "Premier League",
  laliga: "La Liga",
};

// Exhaustive map (compile error if a SupportedLeague is left unmapped).
const LEAGUE_KEY_BY_LEAGUE: Record<SupportedLeague, LeagueKey> = {
  brasileirao_a: "bsa",
  champions_league: "ucl",
  world_cup: "wc",
  serie_a: "sa",
  bundesliga: "bl",
  ligue_1: "l1",
  copa_libertadores: "lib",
  copa_sudamericana: "sula",
  premier_league: "epl",
  la_liga: "laliga",
};

export function leagueToKey(league: SupportedLeague): LeagueKey {
  return LEAGUE_KEY_BY_LEAGUE[league];
}

const LEAGUE_BY_KEY = Object.fromEntries(
  Object.entries(LEAGUE_KEY_BY_LEAGUE).map(([league, key]) => [key, league]),
) as Record<LeagueKey, SupportedLeague>;

export function keyToLeague(key: LeagueKey): SupportedLeague {
  return LEAGUE_BY_KEY[key];
}

const MONTH_ABBR_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

const WEEKDAY_ABBR_PT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

// ── Componentes de data/hora num fuso (#1 timezone) ──────────────────────────
// `timeZone` undefined = comportamento LEGADO (fuso do runtime, via getHours/…):
// preserva os testes existentes e os call sites que ainda não threadam o fuso.
// Definido = formatação no fuso do usuário via `Intl` (robusto a DST/offsets).

type DateParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
};

function zonedParts(d: Date, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let hour = pick("hour");
  if (hour === 24) hour = 0; // guard defensivo (hour12:false dá 00-23 por spec)
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour,
    minute: pick("minute"),
  };
}

function partsOf(d: Date, timeZone?: string): DateParts {
  if (timeZone) return zonedParts(d, timeZone);
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
  };
}

// 0=dom..6=sáb pra a data CIVIL (independe de fuso, via Date.UTC).
function weekdayOf(p: DateParts): number {
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

function isSameDay(a: DateParts, b: DateParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function isNextDay(a: DateParts, base: DateParts): boolean {
  const next = new Date(Date.UTC(base.year, base.month - 1, base.day + 1));
  return (
    a.year === next.getUTCFullYear() &&
    a.month === next.getUTCMonth() + 1 &&
    a.day === next.getUTCDate()
  );
}

function hhmm(p: DateParts): string {
  return `${p.hour.toString().padStart(2, "0")}:${p.minute
    .toString()
    .padStart(2, "0")}`;
}

// "em 3h 24min" / "em 40min": a contagem de um delta positivo (minutos inteiros).
// No último minuto, "em menos de 1min" (nunca "em 0min").
function startsInLabel(deltaMs: number): string {
  const totalMin = Math.floor(deltaMs / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (totalMin === 0) return "em menos de 1min";
  if (h === 0) return `em ${m}min`;
  return `em ${h}h ${m.toString().padStart(2, "0")}min`;
}

const WEEKDAY_FULL_PT = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

/**
 * Janela da contagem regressiva nas listas (#577): só nas últimas 3h antes do apito.
 * Não é o `IN_PROGRESS_WINDOW_MS` de `lib/view/date-range.ts` (cauda de jogo apitado);
 * coincidir em 3h é acaso.
 */
export const COUNTDOWN_WINDOW_MS = 3 * 60 * 60 * 1000;

/** "19:00": só a hora, no `timeZone` do usuário (undefined = fuso do runtime). */
export function formatTimeOfDay(d: Date, timeZone?: string): string {
  return hhmm(partsOf(d, timeZone));
}

/** "2026-10-18": a data civil no `timeZone` do usuário, chave de agrupamento por dia. */
export function dayKeyOf(d: Date, timeZone?: string): string {
  const p = partsOf(d, timeZone);
  return `${p.year}-${p.month.toString().padStart(2, "0")}-${p.day
    .toString()
    .padStart(2, "0")}`;
}

/**
 * "Hoje" / "Amanhã" / "Ontem" / "Sábado 18/10" (ano só quando difere do de `now`:
 * "Sábado 18/10/2025"). Compara a data CIVIL no fuso, nunca `now ± 24h`: dia de 23h
 * ou 25h na troca de horário não quebra.
 */
export function formatDayHeading(d: Date, now: Date, timeZone?: string): string {
  const k = partsOf(d, timeZone);
  const n = partsOf(now, timeZone);
  if (isSameDay(k, n)) return "Hoje";
  if (isNextDay(k, n)) return "Amanhã";
  if (isNextDay(n, k)) return "Ontem";
  const dd = k.day.toString().padStart(2, "0");
  const mm = k.month.toString().padStart(2, "0");
  const year = k.year === n.year ? "" : `/${k.year}`;
  return `${WEEKDAY_FULL_PT[weekdayOf(k)]} ${dd}/${mm}${year}`;
}

/**
 * "sáb 18/10": dia da semana abreviado e a data, no `timeZone` do usuário (data do
 * jogo nos cartões de "Suas predições recentes", #577). Ano só quando difere do de
 * `now`: "sáb 18/10/2025".
 */
export function formatWeekdayDate(d: Date, now: Date, timeZone?: string): string {
  const k = partsOf(d, timeZone);
  const n = partsOf(now, timeZone);
  const dd = k.day.toString().padStart(2, "0");
  const mm = k.month.toString().padStart(2, "0");
  const year = k.year === n.year ? "" : `/${k.year}`;
  return `${WEEKDAY_ABBR_PT[weekdayOf(k)]} ${dd}/${mm}${year}`;
}

/**
 * "em 2h 15min" / "em 40min" só quando faltam até `windowMs` (padrão 3h, inclusive)
 * para `d`; senão (passado, agora ou mais longe) undefined. Delta puro, sem fuso.
 */
export function formatStartsIn(
  d: Date,
  now: Date,
  windowMs: number = COUNTDOWN_WINDOW_MS,
): string | undefined {
  const deltaMs = d.getTime() - now.getTime();
  if (deltaMs <= 0 || deltaMs > windowMs) return undefined;
  return startsInLabel(deltaMs);
}

/**
 * "em 3h 24min" para kickoffs em <24h; "amanhã, 16:00" pro próximo dia;
 * "qui, 21:00" pra esta semana; "DD mmm" pra mais distante. Formata no `timeZone`
 * do usuário (undefined = fuso do runtime, legado).
 */
export function formatKickoffRelative(
  kickoff: Date,
  now: Date = new Date(),
  timeZone?: string,
): string {
  const deltaMs = kickoff.getTime() - now.getTime();
  const k = partsOf(kickoff, timeZone);
  const n = partsOf(now, timeZone);
  if (deltaMs > 0 && deltaMs < 24 * 60 * 60 * 1000 && isSameDay(k, n)) {
    return startsInLabel(deltaMs);
  }
  if (isNextDay(k, n)) {
    return `amanhã, ${hhmm(k)}`;
  }
  const within7d = deltaMs > 0 && deltaMs < 7 * 24 * 60 * 60 * 1000;
  if (within7d) {
    return `${WEEKDAY_ABBR_PT[weekdayOf(k)]}, ${hhmm(k)}`;
  }
  return `${k.day.toString().padStart(2, "0")} ${MONTH_ABBR_PT[k.month - 1]}`;
}

/**
 * "hoje, 21:30" / "amanhã, 16:00" / "qua, 23 mai". Usado no MatchHero. Formata no
 * `timeZone` do usuário (undefined = fuso do runtime, legado). Com `withOtherYear`,
 * o ano entra quando difere do de `now` no mesmo fuso ("sáb, 18 out 2025"): tabela
 * do Desempenho, que mistura temporadas (#577).
 */
export function formatKickoffAbsolute(
  kickoff: Date,
  now: Date = new Date(),
  timeZone?: string,
  opts: { withOtherYear?: boolean } = {},
): string {
  const k = partsOf(kickoff, timeZone);
  const n = partsOf(now, timeZone);
  if (isSameDay(k, n)) return `hoje, ${hhmm(k)}`;
  if (isNextDay(k, n)) return `amanhã, ${hhmm(k)}`;
  const wk = WEEKDAY_ABBR_PT[weekdayOf(k)];
  const day = k.day.toString().padStart(2, "0");
  const mon = MONTH_ABBR_PT[k.month - 1];
  const year = opts.withOtherYear && k.year !== n.year ? ` ${k.year}` : "";
  return `${wk}, ${day} ${mon}${year}`;
}

/**
 * "hoje, 21:30" / "amanhã, 16:00" / "sáb, 18 out, 16:00": data E hora, pra listas de
 * escolha de jogo (bolão, #567). Formata no `timeZone` do usuário.
 */
export function formatKickoffDateTime(
  kickoff: Date,
  now: Date = new Date(),
  timeZone?: string,
): string {
  const k = partsOf(kickoff, timeZone);
  const n = partsOf(now, timeZone);
  if (isSameDay(k, n) || isNextDay(k, n)) {
    return formatKickoffAbsolute(kickoff, now, timeZone);
  }
  return `${formatKickoffAbsolute(kickoff, now, timeZone)}, ${hhmm(k)}`;
}

/**
 * "em 3h 24min" se < 24h; null caso contrário. Aparece como `countdown` no hero
 * apenas em jogos iminentes.
 */
export function formatCountdown(
  kickoff: Date,
  now: Date = new Date(),
  timeZone?: string,
): string | undefined {
  const deltaMs = kickoff.getTime() - now.getTime();
  if (deltaMs <= 0 || deltaMs >= 24 * 60 * 60 * 1000) return undefined;
  if (!isSameDay(partsOf(kickoff, timeZone), partsOf(now, timeZone))) {
    return undefined;
  }
  return formatKickoffRelative(kickoff, now, timeZone);
}

// Formatadores numéricos de tela (vírgula decimal, #574) moram em lib/format-number
// (puro, seguro no cliente); reexportados aqui pra não mexer nos imports de lib/view.
export {
  EV_ZERO_LABEL,
  formatDecimal,
  formatEdge,
  formatEdgePoints,
  formatEvPct,
  formatLine,
  formatOdd,
  formatPct,
  formatUnits,
  formatUnitsCompact,
  roundOdd,
} from "@/lib/format-number";

/**
 * "+1,00 u" / "-1,00 u" — unidades de stake/lucro COM sinal (2 casas). Convenção
 * única do dashboard (#170 centraliza aqui pra stake da análise não divergir).
 * Toda string `numeric` do Drizzle deve virar número ANTES de chamar. "—" em
 * non-finite.
 */
export function formatUnitsSigned(value: number): string {
  return formatUnits(value, { signed: true });
}

/**
 * "1,00 u" — stake em unidades SEM sinal (2 casas), formato do drill-down do
 * dashboard (`prediction.stake`). null/non-finite → null (sem aposta).
 */
export function formatStakeUnits(value: number | string | null): string | null {
  if (value === null) return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return null;
  return formatUnits(n);
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
 * "19 mai · 14:22" — formato do `generatedAt` no preview #33. Formata no
 * `timeZone` do usuário (undefined = fuso do runtime, legado).
 */
export function formatGeneratedAt(date: Date, timeZone?: string): string {
  const p = partsOf(date, timeZone);
  const day = p.day.toString().padStart(2, "0");
  const mon = MONTH_ABBR_PT[p.month - 1];
  return `${day} ${mon} · ${hhmm(p)}`;
}

/**
 * "19 mai · 14:22:07" — como formatGeneratedAt mas com segundos. Usado no header
 * das "análises anteriores" (#204) pra desambiguar reanálises do MESMO minuto (a
 * key React é a id da predição, estável; o rótulo só ajuda o usuário a distinguir).
 * Segundos são invariantes ao fuso (offsets são de minutos inteiros).
 */
export function formatGeneratedAtSeconds(date: Date, timeZone?: string): string {
  const ss = date.getSeconds().toString().padStart(2, "0");
  return `${formatGeneratedAt(date, timeZone)}:${ss}`;
}

/**
 * "2min" / "12min" / "1h" / "2d" — a idade da captura na tabela de mercados ("há X").
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
 * "há 3h" (formatRelativeAgo devolve "3h"); caso-limite <1min vira "há menos de
 * 1min": copy de valor congelado/calculado nunca diz "agora"/"hoje" (ADR 0012,
 * decisão 2), senão todo valor recém-gerado afirmaria uma atualidade que não tem.
 */
export function formatRelativeAgoLabel(past: Date, now: Date = new Date()): string {
  const ago = formatRelativeAgo(past, now);
  return ago === "agora" ? "há menos de 1min" : `há ${ago}`;
}

/**
 * "claude-sonnet-4-5-20250929" → "claude-sonnet-4.5". Encurta o sufixo de
 * versão pra exibição mais compacta sem perder a identidade do modelo.
 */
export function formatModelName(modelVersion: string): string {
  // O motor code_jev (ADR 0041, #511) grava "<modelId>;engine=code_jev;…" — exibe só o modelo.
  const modelId = modelIdFromVersion(modelVersion);
  const match = /^(claude-[a-z]+)-(\d+)-(\d+)(?:-\d+)?$/.exec(modelId);
  if (!match) return modelId;
  return `${match[1]}-${match[2]}.${match[3]}`;
}

// predictions.modelVersion = o AIModelId, seguido de ";chave=valor" do motor quando a
// análise veio do code_jev (ADR 0041 §5). Devolve só o id do modelo.
export function modelIdFromVersion(modelVersion: string): string {
  return modelVersion.split(";")[0];
}

/**
 * Motor que produziu a análise, pro rodapé técnico (prova de qual motor rodou sem
 * abrir o banco). "LLM" no caminho de cartucho; no code_jev, a fonte do λ e, quando o
 * JEV não entrou (fail-open), o motivo. Mercado que o code_jev não precifica (placar
 * exato, scorer, assist) ou sem λ cai no LLM e aparece como "LLM".
 */
export function formatAnalysisEngine(
  modelVersion: string,
  judgments: PredictionJudgments | null | undefined,
): string {
  const engine = engineFromModelVersion(modelVersion);
  if (engine === null) return "motor desconhecido";
  if (engine === "llm") return ANALYSIS_ENGINE_LABEL.llm;
  // Leitura ao vivo (#594): o código lê a partir do placar e do tempo que falta, sem
  // JEV nem odd. O λ de base vem do pré-jogo.
  if (liveModelFromVersion(modelVersion) !== null) return "Código · modelo ao vivo";
  const parts = [ANALYSIS_ENGINE_LABEL.code_jev];
  // jsonb lido do banco sem validação: row antiga ou parcial não pode derrubar a view.
  if (judgments) {
    const source = judgments.lambda?.source;
    if (source) {
      parts.push(source === "dixon_coles" ? "Dixon-Coles" : "heurístico");
    }
    if (judgments.applied === false) {
      parts.push(
        judgments.failure?.kind
          ? `JEV falhou (${judgments.failure.kind})`
          : "sem JEV",
      );
    }
    // Contexto extra do usuário conferido nesta análise (#565).
    if (judgments.userContext) parts.push("com seu contexto");
  }
  return parts.join(" · ");
}
