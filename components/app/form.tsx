import type { FormRow } from "@/lib/mock-data";

export function FormPips({ results }: { results: ("W" | "D" | "L")[] }) {
  return (
    <span className="s-form-pips">
      {results.map((r, i) => (
        <span key={i} className={`s-form-pip s-form-pip--${r.toLowerCase()}`}>
          {r}
        </span>
      ))}
    </span>
  );
}

export function FormTable({ rows }: { rows: FormRow[] }) {
  return (
    <div className="s-form-table">
      {rows.map((r, i) => (
        <div key={i} className="s-form-row">
          <span className="s-form-row__date">{r.date}</span>
          <span className="s-form-row__side">{r.side}</span>
          <span className="s-form-row__opp">{r.opp}</span>
          <span className="s-form-row__score">
            {r.gf}–{r.ga}
          </span>
          <span className={`s-form-row__res s-form-row__res--${r.result.toLowerCase()}`}>
            {r.result}
          </span>
          <span className="s-form-row__tot">tot {r.gf + r.ga}</span>
        </div>
      ))}
    </div>
  );
}
