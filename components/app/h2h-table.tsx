import type { H2HRow } from "@/lib/mock-data";

export function H2HTable({ rows }: { rows: H2HRow[] }) {
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} className="s-h2h-row">
          <span className="s-h2h-row__date">{r.date}</span>
          <span className="s-h2h-row__home">{r.home}</span>
          <span className="s-h2h-row__score">
            {r.gh}–{r.ga}
          </span>
          <span className="s-h2h-row__away">{r.away}</span>
          <span className="s-h2h-row__tot">{r.gh + r.ga} gols</span>
        </div>
      ))}
    </div>
  );
}
