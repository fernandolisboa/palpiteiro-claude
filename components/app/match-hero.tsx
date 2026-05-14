import { Avatar } from "@/components/ui/avatar";
import type { Match } from "@/lib/mock-data";

export function MatchHero({ match }: { match: Match }) {
  return (
    <section className="s-hero">
      <div className="s-hero__team">
        <Avatar short={match.home.short} color={match.home.color} size="xl" />
        <div>
          <div className="s-hero__name">{match.home.name}</div>
          <div className="s-hero__role">casa</div>
        </div>
      </div>
      <div className="s-hero__center">
        <div className="s-hero__status">{match.kickoffFull}</div>
        <div className="s-hero__vs">×</div>
        <div className="s-hero__venue">{match.venue}</div>
      </div>
      <div className="s-hero__team">
        <Avatar short={match.away.short} color={match.away.color} size="xl" />
        <div>
          <div className="s-hero__name">{match.away.name}</div>
          <div className="s-hero__role">fora</div>
        </div>
      </div>
    </section>
  );
}
