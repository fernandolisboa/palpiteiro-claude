import { Eyebrow } from "@/components/ui/eyebrow";
import { fmt } from "@/lib/format";
import type { Odds } from "@/lib/mock-data";

type OddsCardProps = {
  odds: Odds;
  capturedMinutesAgo: number;
};

export function OddsCard({ odds, capturedMinutesAgo }: OddsCardProps) {
  return (
    <section className="s-odds-card">
      <div className="s-odds-card__head">
        <Eyebrow>mercado · over/under 2.5</Eyebrow>
        <span className="s-eyebrow" style={{ color: "var(--fg-4)" }}>
          {odds.bookmaker}
        </span>
      </div>
      <div className="s-odds-grid">
        <div className="s-odd-tile">
          <div className="s-odd-tile__l s-odd-tile__l--over">↑ over 2.5</div>
          <div className="s-odd-tile__v">{fmt.odd(odds.over)}</div>
          <div className="s-odd-tile__implied">
            implícita {fmt.conf(odds.impliedOver)}
          </div>
        </div>
        <div className="s-odd-tile">
          <div className="s-odd-tile__l s-odd-tile__l--under">↓ under 2.5</div>
          <div className="s-odd-tile__v">{fmt.odd(odds.under)}</div>
          <div className="s-odd-tile__implied">
            implícita {fmt.conf(odds.impliedUnder)}
          </div>
        </div>
      </div>
      <div className="s-odds-card__foot">
        <span>overround {odds.overround.toFixed(1).replace(".", ",")}%</span>
        <span>atualizado há {capturedMinutesAgo} min</span>
      </div>
    </section>
  );
}
