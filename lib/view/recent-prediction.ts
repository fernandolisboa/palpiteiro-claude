import { formatEdge, leagueToKey } from "@/lib/format";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { teamToTeam } from "@/lib/view/team";
import type {
  Recommendation,
  RecentPredictionView,
} from "@/lib/view/types";

const MONTH_ABBR_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

// "DD mmm" no fuso do usuário (#1). Undefined = fuso do runtime (legado/testes).
function formatRecentWhen(date: Date, timeZone?: string): string {
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return `${pick("day").toString().padStart(2, "0")} ${MONTH_ABBR_PT[pick("month") - 1]}`;
  }
  const day = date.getDate().toString().padStart(2, "0");
  return `${day} ${MONTH_ABBR_PT[date.getMonth()]}`;
}

type RecentInput = {
  predictionId: string;
  matchId: string;
  league: SupportedLeague;
  homeTeam: string;
  awayTeam: string;
  // = key da seleção escolhida (qualquer mercado) ou "pass". `string` agnóstico
  // desde o contract (#179); REC_TOKEN é total, com fallback toUpperCase.
  recommendation: string;
  edgePct: string | number | null;
  createdAt: Date;
};

// Tokens pinados do over/under/pass (paridade byte-idêntica). O feed recente NÃO
// junta `markets`, então não há marketKey aqui pra derivar o selectionLabel da
// apresentação (#173, PR-1 escopo "fallback mínimo"): seleções de mercado novo
// (1X2) caem num token neutro em MAIÚSCULAS (ex.: "HOME") — célula sã, não quebrada.
// O display 1X2 polido (Casa/Empate/Fora) é PR-2, quando a query passar a juntar markets.
const REC_TOKEN: Record<string, Recommendation> = {
  over: "OVER",
  under: "UNDER",
  pass: "PASS",
};

function recToken(recommendation: RecentInput["recommendation"]): Recommendation {
  return recommendation in REC_TOKEN
    ? REC_TOKEN[recommendation]
    : recommendation.toUpperCase();
}

export function toRecentPredictionView(
  row: RecentInput,
  timeZone?: string,
): RecentPredictionView {
  const league = leagueToKey(row.league);
  return {
    id: row.predictionId,
    matchId: row.matchId,
    // `.short` deriva sempre do canonical (league-inerte); o league vai junto só
    // pra manter a assinatura uniforme do seam — a tradução de `.name` é descartada.
    home: teamToTeam(row.homeTeam, league).short,
    away: teamToTeam(row.awayTeam, league).short,
    rec: recToken(row.recommendation),
    edge: formatEdge(row.edgePct),
    when: formatRecentWhen(row.createdAt, timeZone),
    league,
  };
}
