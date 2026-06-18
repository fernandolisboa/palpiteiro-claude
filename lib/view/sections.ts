import { leagueToKey } from "@/lib/format";
import type {
  NormalizedFixture,
  NormalizedH2H,
  NormalizedInjury,
  NormalizedLineup,
  NormalizedStanding,
} from "@/lib/providers/sports-data/types";
import { displayTeamName } from "@/lib/view/team-labels";
import type {
  FormResult,
  FormView,
  FormViewRow,
  H2HView,
  H2HViewRow,
  InjuriesView,
  LineupView,
  StandingsView,
  StandingsViewRow,
} from "@/lib/view/types";

const MONTH_ABBR_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

function shortDate(date: Date): string {
  const day = date.getDate().toString().padStart(2, "0");
  const mon = MONTH_ABBR_PT[date.getMonth()];
  const yr = (date.getFullYear() % 100).toString().padStart(2, "0");
  return `${day} ${mon} ${yr}`;
}

function buildFormRow(
  fixtures: NormalizedFixture[],
  team: string,
  limit: number,
): FormViewRow {
  const sorted = [...fixtures].sort(
    (a, b) => b.kickoffTimestampMs - a.kickoffTimestampMs,
  );
  const results: FormResult[] = [];
  for (const f of sorted) {
    if (f.score.home === null || f.score.away === null) continue;
    const isHome = f.homeTeam === team;
    const isAway = f.awayTeam === team;
    if (!isHome && !isAway) continue;
    const gf = isHome ? f.score.home : f.score.away;
    const ga = isHome ? f.score.away : f.score.home;
    results.push(gf > ga ? "W" : gf === ga ? "D" : "L");
    if (results.length >= limit) break;
  }
  return { name: team, results };
}

export function toFormView(args: {
  homeTeam: string;
  awayTeam: string;
  homeForm: NormalizedFixture[];
  awayForm: NormalizedFixture[];
  limit?: number;
}): FormView {
  const limit = args.limit ?? 5;
  return {
    home: buildFormRow(args.homeForm, args.homeTeam, limit),
    away: buildFormRow(args.awayForm, args.awayTeam, limit),
  };
}

// Cut padrão (over/under na linha 2.5): total ≥ 3 gols → "over". Byte-idêntico ao
// corte legado — é o default de toH2HView, então a paridade do over/under é exata.
const overUnderClassify = (homeGoals: number, awayGoals: number): string =>
  homeGoals + awayGoals >= 3 ? "over" : "under";

// `classify` parametriza a lente de H2H por mercado (#169): mapeia os gols do
// confronto numa key de seleção. `null` = mercado não baseado em gols → tags
// neutras ("") e summary só com a média (sem "over X%"). O #170 passa
// `getMarketPresentation(marketKey).classifyH2H`; o caller atual (match-sections)
// não muda e cai no default over/under.
export function toH2HView(
  h2h: NormalizedH2H[],
  limit = 5,
  classify: ((homeGoals: number, awayGoals: number) => string) | null =
    overUnderClassify,
): H2HView {
  const sorted = [...h2h].sort(
    (a, b) => b.kickoffTimestampMs - a.kickoffTimestampMs,
  );
  const rows: H2HViewRow[] = [];
  let overCount = 0;
  let totalGoals = 0;
  let counted = 0;
  for (const f of sorted) {
    if (f.score.home === null || f.score.away === null) continue;
    const total = f.score.home + f.score.away;
    const tag = classify ? classify(f.score.home, f.score.away) : "";
    rows.push({
      date: shortDate(new Date(f.kickoffTimestampMs)),
      h: f.homeTeam,
      a: f.awayTeam,
      s: `${f.score.home} – ${f.score.away}`,
      tag,
    });
    if (tag === "over") overCount++;
    totalGoals += total;
    counted++;
    if (rows.length >= limit) break;
  }
  const avgGoals = counted === 0 ? 0 : totalGoals / counted;
  const summary =
    counted === 0
      ? "sem histórico recente"
      : classify === null
        ? `média ${avgGoals.toFixed(1)} gols`
        : `over ${Math.round((overCount / counted) * 100)}% · média ${avgGoals.toFixed(1)} gols`;
  return { rows, summary };
}

export function toStandingsView(args: {
  standing: NormalizedStanding | undefined;
  homeTeam: string;
  awayTeam: string;
  windowSize?: number;
}): StandingsView {
  const standing = args.standing;
  const window = args.windowSize ?? 5;
  if (!standing || standing.tables.length === 0) {
    return { rows: [], round: "—" };
  }

  let table = standing.tables[0];
  let focusHome = table.teams.find((t) => t.team === args.homeTeam);
  let focusAway = table.teams.find((t) => t.team === args.awayTeam);
  for (const t of standing.tables) {
    const fh = t.teams.find((x) => x.team === args.homeTeam);
    const fa = t.teams.find((x) => x.team === args.awayTeam);
    if (fh || fa) {
      table = t;
      focusHome = fh ?? focusHome;
      focusAway = fa ?? focusAway;
      if (fh && fa) break;
    }
  }

  const focusPositions = [focusHome?.position, focusAway?.position].filter(
    (p): p is number => typeof p === "number",
  );
  const anchor = focusPositions.length
    ? Math.max(1, Math.min(...focusPositions) - 1)
    : 1;
  // Clampa o início da janela contra o fim da tabela: sem isso, quando os times
  // de foco ficam perto do fundo, a janela estoura o array e descarta as linhas
  // do topo (incluindo o líder) — ex.: grupo de 4 com jogo entre pos 3 e 4 some
  // o pos 1. Clampar também evita janela sub-preenchida no fundo (issue #337).
  const start = Math.max(0, Math.min(anchor - 1, table.teams.length - window));
  const sliced = table.teams.slice(start, start + window);
  // Tradução display-only (#340): a classificação não passa pelo seam teamToTeam,
  // então roteamos o mesmo mapa aqui pra Copa concordar com feed/hero. O `team`
  // exibido vira PT-BR; o `focus` continua comparando o canonical cru.
  const leagueKey = leagueToKey(standing.league);
  const rows: StandingsViewRow[] = sliced.map((t) => ({
    pos: t.position,
    team: displayTeamName(t.team, leagueKey),
    p: t.points,
    gf: t.goalsFor,
    ga: t.goalsAgainst,
    focus: t.team === args.homeTeam || t.team === args.awayTeam,
  }));

  const totalPlayed = table.teams[0]?.played ?? 0;
  const round = totalPlayed > 0 ? `rodada ${totalPlayed}` : "—";
  return { rows, round };
}

function injurySideToView(
  injuries: NormalizedInjury[],
): Array<{ name: string; status: string }> {
  return injuries.map((i) => ({
    name: i.player.name,
    status: i.status,
  }));
}

export function toInjuriesView(args: {
  available: boolean;
  home: NormalizedInjury[];
  away: NormalizedInjury[];
}): InjuriesView {
  return {
    available: args.available,
    home: injurySideToView(args.home),
    away: injurySideToView(args.away),
  };
}

export function toLineupView(
  lineup: NormalizedLineup | undefined,
  args: { homeTeam: string; awayTeam: string },
): LineupView {
  if (!lineup) {
    return { available: false };
  }
  const homeSide =
    lineup.home.team === args.homeTeam
      ? lineup.home
      : lineup.away.team === args.homeTeam
        ? lineup.away
        : undefined;
  const awaySide =
    lineup.away.team === args.awayTeam
      ? lineup.away
      : lineup.home.team === args.awayTeam
        ? lineup.home
        : undefined;
  return {
    available: true,
    home: homeSide
      ? {
          formation: homeSide.formation,
          starters: homeSide.starters.map((p) => p.name),
        }
      : undefined,
    away: awaySide
      ? {
          formation: awaySide.formation,
          starters: awaySide.starters.map((p) => p.name),
        }
      : undefined,
  };
}
