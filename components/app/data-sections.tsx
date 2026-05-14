import { Activity, Bandage, Swords, Trophy, Users } from "lucide-react";
import { Collapsible } from "@/components/app/collapsible";
import { FormPips, FormTable } from "@/components/app/form";
import { H2HTable } from "@/components/app/h2h-table";
import { AbsenceCol } from "@/components/app/absences";
import { Eyebrow } from "@/components/ui/eyebrow";
import type { Match, MatchDetail } from "@/lib/mock-data";

type Props = {
  match: Match;
  detail: MatchDetail;
  layout?: "mobile" | "desktop";
};

export function DataSections({ match, detail, layout = "mobile" }: Props) {
  const wide = layout === "desktop";

  const formaColl = (
    <Collapsible
      icon={<Activity size={16} />}
      title="Forma recente"
      defaultOpen
      meta={<FormPips results={detail.forms.homeSummary} />}
    >
      <div className="s-form-pair">
        <div>
          <Eyebrow>
            <span style={{ display: "block", marginBottom: 8 }}>{match.home.name}</span>
          </Eyebrow>
          <FormTable rows={detail.forms.home} />
        </div>
        <div>
          <Eyebrow>
            <span style={{ display: "block", marginBottom: 8 }}>{match.away.name}</span>
          </Eyebrow>
          <FormTable rows={detail.forms.away} />
        </div>
      </div>
    </Collapsible>
  );

  const h2hColl = (
    <Collapsible
      icon={<Swords size={16} />}
      title="Confrontos diretos (H2H)"
      meta={`últimos ${detail.h2h.length}`}
    >
      <H2HTable rows={detail.h2h} />
    </Collapsible>
  );

  const standingsColl = detail.standings && (
    <Collapsible icon={<Trophy size={16} />} title="Classificação">
      <div className="s-stand-grid">
        <div className="s-stand">
          <div className="s-stand__h">{match.home.name}</div>
          <div className="s-stand__row">
            <span>posição</span>
            <span>{detail.standings.home.pos}º</span>
          </div>
          <div className="s-stand__row">
            <span>pts em {detail.standings.home.played}j</span>
            <span>{detail.standings.home.pts}</span>
          </div>
          <div className="s-stand__row">
            <span>gols</span>
            <span>
              {detail.standings.home.gf}–{detail.standings.home.ga}
            </span>
          </div>
        </div>
        <div className="s-stand">
          <div className="s-stand__h">{match.away.name}</div>
          <div className="s-stand__row">
            <span>posição</span>
            <span>{detail.standings.away.pos}º</span>
          </div>
          <div className="s-stand__row">
            <span>pts em {detail.standings.away.played}j</span>
            <span>{detail.standings.away.pts}</span>
          </div>
          <div className="s-stand__row">
            <span>gols</span>
            <span>
              {detail.standings.away.gf}–{detail.standings.away.ga}
            </span>
          </div>
        </div>
      </div>
    </Collapsible>
  );

  const absencesColl = (
    <Collapsible icon={<Bandage size={16} />} title="Lesões / suspensões">
      <div className="s-abs-grid">
        <AbsenceCol team={match.home.name} data={detail.absences.home} />
        <AbsenceCol team={match.away.name} data={detail.absences.away} />
      </div>
    </Collapsible>
  );

  const lineupColl = (
    <Collapsible icon={<Users size={16} />} title="Escalação provável" meta="publicada ~40min antes">
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--fg-3)",
        }}
      >
        — escalação ainda não publicada
      </div>
    </Collapsible>
  );

  if (wide) {
    return (
      <>
        <div className="s-coll-grid-2">
          {formaColl}
          {h2hColl}
        </div>
        {standingsColl}
        <div className="s-coll-grid-2">
          {absencesColl}
          {lineupColl}
        </div>
      </>
    );
  }

  return (
    <>
      {formaColl}
      {h2hColl}
      {standingsColl}
      {absencesColl}
      {lineupColl}
    </>
  );
}
