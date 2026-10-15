import {
  ConfidenceChip,
  Kicker,
  ProbableScore,
} from "@/components/palpites/public-palpite";
import { TeamAvatar } from "@/components/team-avatar";

import { PREVIEW_AWAY, PREVIEW_HOME, PREVIEW_PALPITE, type PreviewTeam } from "./preview-data";

function TeamLine({ team }: { team: PreviewTeam }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <TeamAvatar initials={team.short} hue={team.hue} size={36} />
      <span className="truncate text-body font-medium tracking-tight text-foreground">
        {team.name}
      </span>
    </span>
  );
}

/**
 * Ilustração do Palpite da IA (ADR 0059): o cartão no estilo do palpite público, com
 * os mesmos pedaços (kicker, confiança em palavra, placar provável). Sem selo de
 * resultado: nada "acertou" do app numa página pública.
 */
export function PalpitePreview() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-palpite-border bg-palpite-soft/40 p-5 ring-1 ring-palpite-border/40">
      <div className="flex flex-col gap-2">
        <TeamLine team={PREVIEW_HOME} />
        <TeamLine team={PREVIEW_AWAY} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Kicker />
        <ConfidenceChip confidence={PREVIEW_PALPITE.confidence} />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-balance text-display-sm font-medium leading-snug tracking-tight text-foreground">
          {PREVIEW_PALPITE.verdict}
        </p>
        <ProbableScore score={PREVIEW_PALPITE.probableScore} />
      </div>
    </div>
  );
}
