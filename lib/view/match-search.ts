import { z } from "zod";

import type {
  MatchSearchTerm,
  TeamCatalogEntry,
} from "@/lib/db/queries/matches";
import { LEAGUE_LABEL, leagueToKey } from "@/lib/format";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { teamToTeam } from "@/lib/view/team";
import { displayTeamName, teamCode } from "@/lib/view/team-labels";
import type { LeagueKey, Team } from "@/lib/view/types";

// Busca e filtros da lista de jogos (#643): `q` (texto livre), `team` (escudo
// escolhido, nome CANÔNICO) e `analyzed` (só os analisados pelo usuário, só os não
// analisados ou todos). Vivem na URL, como a liga e as datas, e rodam no servidor:
// a lista padrão tem teto de 100 jogos, e filtrar no cliente esconderia o que passa
// dele.

export type AnalyzedFilter = "all" | "yes" | "no";

export type ListFilters = {
  q?: string;
  team?: string;
  analyzed?: AnalyzedFilter;
};

// Teto do texto da busca e do nome do time na URL: um nome canônico tem bem menos.
const MAX_QUERY_LENGTH = 80;
const MAX_TEAM_LENGTH = 100;

const analyzedSchema = z.enum(["yes", "no"]);

/** Colapsa espaços e corta no teto; vazio vira undefined. */
export function normalizeQuery(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const q = raw
    // ".." no `back` do link do jogo faz o voltar descartar a URL (resolveBackHref).
    .replace(/\.{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
    .trim();
  return q === "" ? undefined : q;
}

/**
 * Lê os filtros da URL. Nunca lança: valor inválido cai no padrão (sem filtro),
 * como `parseRangeParams`.
 */
export function parseListFilters(sp: {
  q?: string;
  team?: string;
  analyzed?: string;
}): ListFilters {
  const team =
    typeof sp.team === "string" ? sp.team.trim().slice(0, MAX_TEAM_LENGTH) : "";
  const analyzed = analyzedSchema.safeParse(sp.analyzed);
  return {
    q: normalizeQuery(sp.q),
    team: team === "" ? undefined : team,
    analyzed: analyzed.success ? analyzed.data : "all",
  };
}

export function hasActiveFilters(filters: ListFilters): boolean {
  return Boolean(
    filters.q || filters.team || (filters.analyzed && filters.analyzed !== "all"),
  );
}

/** Minúsculas e sem acento: "Grêmio" e "gremio" casam. */
export function foldText(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

// "Flamengo x Palmeiras": o separador entre os times não é termo de busca.
const STOPWORDS = new Set(["x", "×", "vs", "v", "versus", "contra"]);

// Apelidos em PT pras competições, além do rótulo do app e da sigla da URL.
const LEAGUE_ALIASES: Partial<Record<SupportedLeague, string[]>> = {
  brasileirao_a: ["brasileiro"],
  champions_league: ["liga dos campeoes"],
  premier_league: ["ingles"],
  la_liga: ["espanhol"],
  serie_a: ["italiano"],
  bundesliga: ["alemao"],
  ligue_1: ["frances"],
  copa_sudamericana: ["sudamericana", "sulamericana"],
};

// Dia da semana ISO (1 = segunda … 7 = domingo). Só o nome inteiro (e "sáb"): as
// abreviações "ter", "qua", "seg"… são começo de nome de time ("Terengganu") e
// virariam filtro de data no meio da digitação.
const WEEKDAYS: Record<string, number> = {
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
  sab: 6,
  domingo: 7,
};

// Teto de termos: cada termo de texto leva as listas de times pro SQL.
const MAX_TERMS = 6;

const RELATIVE_DAYS: Record<string, number> = { ontem: -1, hoje: 0, amanha: 1 };

// Barra ou hífen; ponto não ("2.5" é a linha de gols, não 2 de maio).
const DATE_PATTERN = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/;

/** Os termos da busca: minúsculos, sem acento, sem pontuação nas pontas. */
export function tokenizeQuery(q: string): string[] {
  const tokens = foldText(q)
    // "segunda-feira" → "segunda".
    .replace(/-feira\b/g, "")
    .split(/[\s,;]+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((t) => t !== "" && !STOPWORDS.has(t));
  return [...new Set(tokens)].slice(0, MAX_TERMS);
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

// "2026-10-23" + n dias, sem passar pelo fuso (aritmética de calendário).
function addDays(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

// Data do termo, ou null quando o termo não é data. `todayKey` é o dia civil de
// hoje no fuso do usuário ("2026-10-23").
function dateTerm(token: string, todayKey: string): MatchSearchTerm | null {
  const relative = RELATIVE_DAYS[token];
  if (relative !== undefined) {
    return { kind: "day", day: addDays(todayKey, relative) };
  }
  const weekday = WEEKDAYS[token];
  if (weekday !== undefined) return { kind: "weekday", isoDow: weekday };

  const match = DATE_PATTERN.exec(token);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  if (match[3] === undefined) {
    // Sem ano: qualquer ano (29/02 só existe em bissexto, mas vale como termo).
    if (!isCalendarDate(2024, month, day)) return null;
    return { kind: "dayMonth", dayMonth: `${pad2(day)}/${pad2(month)}` };
  }
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  if (!isCalendarDate(year, month, day)) return null;
  return { kind: "day", day: `${year}-${pad2(month)}-${pad2(day)}` };
}

function leagueMatches(league: SupportedLeague, token: string): boolean {
  const key = leagueToKey(league);
  if (key === token) return true;
  const names = [LEAGUE_LABEL[key], ...(LEAGUE_ALIASES[league] ?? [])];
  return names.some((name) => foldText(name).includes(token));
}

function teamMatches(entry: TeamCatalogEntry, token: string): boolean {
  const key = leagueToKey(entry.league);
  if (foldText(teamCode(entry.name)) === token) return true;
  return [entry.name, displayTeamName(entry.name, key)].some((name) =>
    foldText(name).includes(token),
  );
}

/**
 * Traduz o texto da busca em termos pro SQL (`getMatchesInRange`). Cada termo
 * precisa casar (AND); um termo casa com um jogo pelo time (nome canônico, nome de
 * exibição ou sigla), pela competição ou pela data. Datas ("25/10", "25/10/2026",
 * "hoje", "amanhã", "ontem", "sábado"/"sáb") são só data. Time e competição casam
 * aqui, em TS, sobre o catálogo de times do período (acento resolvido direito); o
 * SQL só recebe as listas. Termo de texto que não casa nada vira lista vazia, e a
 * busca não traz jogo nenhum.
 */
export function buildSearchTerms(args: {
  q: string;
  catalog: readonly TeamCatalogEntry[];
  leagues: readonly SupportedLeague[];
  todayKey: string;
}): MatchSearchTerm[] {
  return tokenizeQuery(args.q).map((token) => {
    const date = dateTerm(token, args.todayKey);
    if (date) return date;
    const teams = new Set<string>();
    for (const entry of args.catalog) {
      if (teamMatches(entry, token)) teams.add(entry.name);
    }
    return {
      kind: "text",
      teams: [...teams],
      leagues: args.leagues.filter((league) => leagueMatches(league, token)),
    };
  });
}

/**
 * Vazio com filtro ativo: diz o que foi buscado e aponta pro "Limpar filtros"
 * (a ação vem da página).
 */
export function filteredEmptyMessage(
  filters: ListFilters,
  teamLabel?: string,
): { title: string; detail: string } {
  const parts: string[] = [];
  if (filters.q) parts.push(`"${filters.q}"`);
  if (filters.team) parts.push(teamLabel ?? filters.team);
  if (filters.analyzed === "yes") parts.push("analisados");
  if (filters.analyzed === "no") parts.push("não analisados");
  return {
    title: "Nenhum jogo encontrado",
    detail: `Nada com ${parts.join(" + ")} neste período. Tente outro termo ou limpe os filtros.`,
  };
}

/** Um time na escolha por escudo (#643): `value` é o nome canônico (vai na URL). */
export type TeamOption = { value: string; team: Team };

export type TeamOptionGroup = {
  league: LeagueKey;
  label: string;
  teams: TeamOption[];
};

function byDisplayName(a: TeamOption, b: TeamOption): number {
  return a.team.name.localeCompare(b.team.name, "pt-BR");
}

/**
 * Os times do período agrupados por competição, na ordem das ligas ativas, e por
 * nome de exibição dentro do grupo. Um time em duas competições (Brasileirão e
 * Libertadores) aparece nas duas; escolher qualquer uma filtra os jogos dele.
 */
export function teamOptionGroups(
  catalog: readonly TeamCatalogEntry[],
  leagueOrder: readonly LeagueKey[],
): TeamOptionGroup[] {
  const byLeague = new Map<LeagueKey, TeamOption[]>();
  for (const entry of catalog) {
    const key = leagueToKey(entry.league);
    const list = byLeague.get(key) ?? [];
    list.push({ value: entry.name, team: teamToTeam(entry.name, key, entry.crestUrl) });
    byLeague.set(key, list);
  }
  return leagueOrder
    .filter((key) => byLeague.has(key))
    .map((key) => ({
      league: key,
      label: LEAGUE_LABEL[key],
      teams: (byLeague.get(key) ?? []).sort(byDisplayName),
    }));
}

/**
 * O time escolhido (`team` da URL) pra exibir no chip. Fora do catálogo (link antigo,
 * período sem jogo dele) ainda mostra um nome, derivado na primeira liga ativa.
 */
export function selectedTeamOption(
  catalog: readonly TeamCatalogEntry[],
  team: string | undefined,
  fallbackLeague: LeagueKey,
): TeamOption | undefined {
  if (!team) return undefined;
  const entry =
    catalog.find((e) => e.name === team && e.crestUrl) ??
    catalog.find((e) => e.name === team);
  if (entry) {
    return {
      value: team,
      team: teamToTeam(team, leagueToKey(entry.league), entry.crestUrl),
    };
  }
  return { value: team, team: teamToTeam(team, fallbackLeague) };
}
