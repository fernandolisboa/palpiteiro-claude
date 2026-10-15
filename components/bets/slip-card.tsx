import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ResultBadge } from "@/components/result-badge";
import type { SlipStatus } from "@/lib/bets/slip-ledger";
import type { BetSlipHistoryRow, UserBetLegRow } from "@/lib/db/queries/user-bets";
import {
  LEAGUE_LABEL,
  formatKickoffAbsolute,
  formatOdd,
  formatUnitsCompact,
  leagueToKey,
} from "@/lib/format";
import { readLiveStamp } from "@/lib/live/stamp";
import { historyLegView, slipLegLabel, type TeamNames } from "@/lib/view/bet-slip";
import { liveStampLabel } from "@/lib/view/live-score";
import type { ResultState } from "@/lib/view/result-state";
import { displayMatchTeams } from "@/lib/view/team";

// Um slip em /apostas (#473, #577). Status UMA vez, no cabeçalho; a perna da
// combinada leva o próprio selo (mostra qual caiu), a da simples não. Os números
// re-renderizam o que foi congelado no registro, nunca recalculam com dado novo.

const SLIP_RESULT: Partial<Record<SlipStatus, ResultState>> = {
  acertou: "won",
  errou: "lost",
  pendente: "pending",
};

const NEUTRAL_BADGE = "tracking-tight text-muted-foreground";

function SlipStatusBadge({
  status,
  matchCancelled,
}: {
  status: SlipStatus;
  matchCancelled: boolean;
}) {
  // Jogo cancelado nunca liquida: a aposta vai pra "Encerradas" e não pode dizer
  // "Em aberto" lá. Não é resultado nem "Anulada" (o app não sabe o que a casa fez).
  if (status === "pendente" && matchCancelled) {
    return (
      <Badge variant="outline" size="sm" className={NEUTRAL_BADGE}>
        Jogo cancelado
      </Badge>
    );
  }
  const result = SLIP_RESULT[status];
  if (result) return <ResultBadge result={result} size="sm" />;
  return (
    <Badge variant="outline" size="sm" className={NEUTRAL_BADGE}>
      Não conferida
    </Badge>
  );
}

function legResult(leg: UserBetLegRow): ResultState | null {
  const result = leg.outcome?.result ?? null;
  if (result === "won") return "won";
  if (result === "lost") return "lost";
  return leg.settleable ? "pending" : null;
}

function LegRow({
  leg,
  teams,
  showBadge,
  closed,
}: {
  leg: UserBetLegRow;
  teams: TeamNames;
  showBadge: boolean;
  closed: boolean;
}) {
  const label = slipLegLabel(leg.kind, leg.params, teams);
  const view = historyLegView(leg);
  const result = legResult(leg);
  // Encerrada sem resultado (jogo cancelado, ou não conferida fechada por tempo): a
  // perna pendente fica sem selo; o cabeçalho já diz o porquê. Nunca "Em aberto" lá.
  const hideBadge = closed && result === "pending";
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 text-body-sm tracking-tight text-foreground">{label}</span>
        {showBadge &&
          !hideBadge &&
          (result ? (
            <ResultBadge result={result} />
          ) : (
            <Badge variant="outline" size="xs" className={NEUTRAL_BADGE}>
              não conferimos
            </Badge>
          ))}
      </div>
      {view.visible.length > 0 && (
        <span className="font-mono text-meta tabular-nums text-muted-foreground">
          {view.visible.join(" · ")}
        </span>
      )}
      {view.details.length > 0 && (
        <details>
          <summary className="w-fit cursor-pointer text-meta text-muted-foreground hover:text-foreground">
            detalhes
          </summary>
          <p className="pt-1 font-mono text-meta tabular-nums text-muted-foreground">
            {view.details.join(" · ")}
          </p>
        </details>
      )}
    </div>
  );
}

export function SlipCard({
  slip,
  now,
  timeZone,
  closed = false,
}: {
  slip: BetSlipHistoryRow;
  now: Date;
  timeZone: string;
  // Na lista "Encerradas" (o recorte de `slipBucket`, que a página já calculou).
  closed?: boolean;
}) {
  const league = leagueToKey(slip.match.league);
  const teams = displayMatchTeams(slip.match.homeTeam, slip.match.awayTeam, league);
  const combo = slip.legs.length >= 2;
  const matchCancelled = slip.match.status === "cancelled";
  const comboStake = slip.stakeUnits === null ? null : Number(slip.stakeUnits);
  // Registrada com o jogo rolando (#580): o momento do registro, do carimbo. Carimbo
  // ilegível numa slip ao vivo ainda leva o selo "ao vivo".
  const liveStamp = slip.isLive ? readLiveStamp(slip.liveState) : null;
  const liveLabel = slip.isLive ? (liveStamp ? liveStampLabel(liveStamp) : "ao vivo") : null;
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-start justify-between gap-2 px-4 pt-3 pb-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          {combo && (
            <span className="text-meta uppercase tracking-label text-muted-foreground">
              Combinada · {slip.legs.length} seleções
            </span>
          )}
          <span className="text-body font-medium tracking-tight text-foreground">
            {teams.home} × {teams.away}
          </span>
          <span className="text-meta uppercase tracking-label text-muted-foreground">
            {LEAGUE_LABEL[league]} · {formatKickoffAbsolute(slip.match.kickoffAt, now, timeZone)}
          </span>
          {liveLabel && (
            <span className="pt-1">
              <Badge
                variant="outline"
                size="xs"
                className="font-mono tabular-nums tracking-tight text-muted-foreground"
              >
                {liveLabel}
              </Badge>
            </span>
          )}
          {combo && (slip.comboUserOdd !== null || comboStake !== null) && (
            <span className="pt-1 text-body-sm tracking-tight text-muted-foreground">
              {slip.comboUserOdd !== null && (
                <>
                  odd{" "}
                  <span className="font-mono tabular-nums text-foreground">
                    {formatOdd(slip.comboUserOdd)}
                  </span>
                </>
              )}
              {slip.comboUserOdd !== null && comboStake !== null && " · "}
              {comboStake !== null && (
                <>
                  stake{" "}
                  <span className="font-mono tabular-nums text-foreground">
                    {formatUnitsCompact(comboStake)}
                  </span>
                </>
              )}
            </span>
          )}
        </div>
        <SlipStatusBadge status={slip.status} matchCancelled={matchCancelled} />
      </div>

      <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
        {slip.legs.map((leg) => (
          <LegRow
            key={leg.id}
            leg={leg}
            teams={teams}
            showBadge={combo}
            closed={closed || matchCancelled}
          />
        ))}
      </div>
    </Card>
  );
}
