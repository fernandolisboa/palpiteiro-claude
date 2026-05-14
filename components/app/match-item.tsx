import Link from "next/link";
import { ChevronRight, Sparkles } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { fmt } from "@/lib/format";
import type { Match } from "@/lib/mock-data";

export function MatchItem({ match }: { match: Match }) {
  const a = match.prediction;
  const lblColor = a ? `s-match__predicted--${a.rec}` : "";
  return (
    <Link href={`/matches/${match.id}`} className="s-match">
      <header className="s-match__head">
        <span className="s-league">{match.league}</span>
        <span className="s-dot-sep" />
        <span
          className={`s-match__time ${match.soon ? "s-match__time--soon" : ""}`}
        >
          {match.timeRel}
        </span>
        {a && (
          <span className={`s-match__predicted ${lblColor}`}>
            <Sparkles size={11} />
            <span>{a.rec === "pass" ? "pass" : a.rec}</span>
          </span>
        )}
      </header>

      <div className="s-match__teams">
        <div className="s-match__team">
          <Avatar short={match.home.short} color={match.home.color} />
          <span className="s-match__team-name">{match.home.name}</span>
        </div>
        <span className="s-match__vs">vs</span>
        <div className="s-match__team">
          <Avatar short={match.away.short} color={match.away.color} />
          <span className="s-match__team-name">{match.away.name}</span>
        </div>
      </div>

      <footer className="s-match__foot">
        <div className="s-match__odds">
          <span className="s-odd">
            <span className="s-odd__l">O</span>
            {fmt.odd(match.odds.over)}
          </span>
          <span className="s-odd">
            <span className="s-odd__l">U</span>
            {fmt.odd(match.odds.under)}
          </span>
        </div>
        <span className="s-match__chev">
          <ChevronRight size={16} />
        </span>
      </footer>
    </Link>
  );
}

export function MatchItemSkeleton() {
  return (
    <div className="s-sk-card">
      <div className="s-sk-row" style={{ justifyContent: "space-between" }}>
        <span className="s-sk" style={{ width: 80, height: 18, borderRadius: 3 }} />
        <span className="s-sk" style={{ width: 40, height: 10, borderRadius: 3 }} />
      </div>
      <div className="s-sk-row">
        <span className="s-sk s-sk-circle" />
        <span className="s-sk" style={{ width: 140, height: 14 }} />
      </div>
      <div className="s-sk-row">
        <span className="s-sk s-sk-circle" />
        <span className="s-sk" style={{ width: 120, height: 14 }} />
      </div>
      <div className="s-sk-foot">
        <span className="s-sk" style={{ width: 130, height: 26, borderRadius: 4 }} />
        <span className="s-sk" style={{ width: 16, height: 16, borderRadius: 4 }} />
      </div>
    </div>
  );
}
