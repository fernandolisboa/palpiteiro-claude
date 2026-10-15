import { OddsInline } from "@/components/match-list/odds-inline";
import { matchRowPhase } from "@/lib/view/match-list";
import type { MatchRowView } from "@/lib/view/types";

function Score({ home, away }: { home: number; away: number }) {
  return (
    <span className="font-mono text-label font-medium tabular-nums">
      {home}
      <span className="px-1 text-muted-foreground">–</span>
      {away}
    </span>
  );
}

/**
 * Lado direito da linha da lista de jogos (#577), por fase (`matchRowPhase`):
 *  - live: placar parcial + legenda, ou "—" (o selo AO VIVO fica no lugar da hora,
 *    uma vez por linha, #574). Ao vivo nunca mostra odd: não parece apostável;
 *  - finished: placar + "encerrado" (sem placar reportado, só "encerrado": nunca um
 *    0–0 inventado nem "sem odd");
 *  - off: "Adiado" / "Cancelado";
 *  - upcoming: as odds lado a lado, ou "sem odd".
 * Ponto de extensão do #580 (ao vivo): minuto e placar ao vivo entram no ramo live.
 */
export function RowTrailing({ m }: { m: MatchRowView }) {
  const phase = matchRowPhase(m);
  if (phase === "live") {
    return m.liveScore ? (
      <div className="flex flex-col items-end gap-0.5 text-right">
        <Score home={m.liveScore.home} away={m.liveScore.away} />
        <span className="text-meta text-muted-foreground">{m.liveScore.caption}</span>
      </div>
    ) : (
      <span className="text-meta text-muted-foreground">—</span>
    );
  }
  if (phase === "finished") {
    return (
      <div className="flex flex-col items-end gap-0.5 text-right">
        {m.homeScore !== null && m.awayScore !== null && (
          <Score home={m.homeScore} away={m.awayScore} />
        )}
        <span className="text-meta uppercase tracking-label text-muted-foreground">
          encerrado
        </span>
      </div>
    );
  }
  if (phase === "off") {
    return (
      <span className="text-meta uppercase tracking-label text-muted-foreground">
        {m.status === "cancelled" ? "Cancelado" : "Adiado"}
      </span>
    );
  }
  return m.odds ? (
    <OddsInline outcomes={m.odds.outcomes} />
  ) : (
    <span className="text-meta text-muted-foreground">sem odd</span>
  );
}
