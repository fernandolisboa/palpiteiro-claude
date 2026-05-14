import { CircleHelp } from "lucide-react";
import type { Absence } from "@/lib/mock-data";

type AbsenceColProps = {
  team: string;
  data: Absence[] | "unknown";
};

export function AbsenceCol({ team, data }: AbsenceColProps) {
  if (data === "unknown") {
    return (
      <div className="s-abs">
        <div className="s-abs__h">{team}</div>
        <div className="s-abs__unknown">
          <CircleHelp size={11} />
          <span>dados indisponíveis</span>
        </div>
      </div>
    );
  }
  if (!data || data.length === 0) {
    return (
      <div className="s-abs">
        <div className="s-abs__h">{team}</div>
        <div className="s-abs__none">— nenhuma reportada</div>
      </div>
    );
  }
  return (
    <div className="s-abs">
      <div className="s-abs__h">{team}</div>
      {data.map((a, i) => (
        <div key={i} className="s-abs__item">
          <span>
            {a.player} <span className="s-abs__role">{a.role}</span>
          </span>
          <span
            className="s-abs__role"
            style={{
              color: a.status === "lesão" ? "var(--lost)" : "var(--pending)",
            }}
          >
            {a.status}
          </span>
        </div>
      ))}
    </div>
  );
}
