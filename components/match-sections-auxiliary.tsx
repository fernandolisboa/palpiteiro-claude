import { EmptyState } from "@/components/empty-state";
import { MatchCollapsible } from "@/components/match-collapsible";
import { Separator } from "@/components/ui/separator";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import {
  SportsDataUnsupportedError,
  type FixtureRef,
  type NormalizedInjury,
  type NormalizedLineup,
} from "@/lib/providers/sports-data/types";
import { toInjuriesView, toLineupView } from "@/lib/view/sections";

type Props = {
  fixtureRef: FixtureRef;
};

type InjuriesResult = {
  data: { home: NormalizedInjury[]; away: NormalizedInjury[] };
  available: boolean;
};

async function fetchInjuries(
  fixtureRef: FixtureRef,
): Promise<InjuriesResult> {
  const provider = getSportsDataProvider();
  try {
    const data = await provider.getInjuriesByFixture(fixtureRef);
    return { data, available: true };
  } catch (err) {
    if (err instanceof SportsDataUnsupportedError) {
      return { data: { home: [], away: [] }, available: false };
    }
    logAuxError("injuries", err);
    return { data: { home: [], away: [] }, available: false };
  }
}

async function fetchLineups(
  fixtureRef: FixtureRef,
): Promise<NormalizedLineup | undefined> {
  const provider = getSportsDataProvider();
  try {
    return await provider.getLineups(fixtureRef);
  } catch (err) {
    if (err instanceof SportsDataUnsupportedError) return undefined;
    logAuxError("lineups", err);
    return undefined;
  }
}

function logAuxError(kind: string, err: unknown) {
  console.error(
    JSON.stringify({
      scope: "match-sections-auxiliary",
      kind,
      error: "fetch_failed",
      message: err instanceof Error ? err.message : String(err),
    }),
  );
}

export async function MatchAuxiliarySections({ fixtureRef }: Props) {
  const [injuriesResult, lineup] = await Promise.all([
    fetchInjuries(fixtureRef),
    fetchLineups(fixtureRef),
  ]);

  const injuriesView = toInjuriesView({
    available: injuriesResult.available,
    home: injuriesResult.data.home,
    away: injuriesResult.data.away,
  });
  const lineupView = toLineupView(lineup, {
    homeTeam: fixtureRef.homeTeam,
    awayTeam: fixtureRef.awayTeam,
  });

  const injuriesMeta = !injuriesView.available
    ? "dados indisponíveis"
    : injuriesView.home.length + injuriesView.away.length === 0
      ? "nenhuma baixa"
      : `${injuriesView.home.length + injuriesView.away.length} baixas`;

  const lineupsMeta = !lineupView.available
    ? "ainda não divulgadas"
    : lineupView.home && lineupView.away
      ? "divulgadas"
      : "parciais";

  return (
    <>
      <div className="pt-3">
        <MatchCollapsible title="Lesões e suspensões" meta={injuriesMeta}>
          {injuriesView.available &&
          injuriesView.home.length + injuriesView.away.length > 0 ? (
            <InjuriesBody view={injuriesView} />
          ) : injuriesView.available ? (
            <EmptyState
              className="py-6"
              title="Nenhuma baixa reportada para esta partida."
            />
          ) : (
            <EmptyState
              className="py-6"
              title="O provider atual não disponibiliza lesões e suspensões pra esta competição."
            />
          )}
        </MatchCollapsible>
      </div>
      <div className="pt-3">
        <MatchCollapsible title="Escalações" meta={lineupsMeta}>
          {lineupView.available ? (
            <LineupBody view={lineupView} />
          ) : (
            <EmptyState
              className="py-6"
              title="Escalações ainda não foram divulgadas pela competição."
            />
          )}
        </MatchCollapsible>
      </div>
    </>
  );
}

function InjuriesBody({
  view,
}: {
  view: ReturnType<typeof toInjuriesView>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {(["home", "away"] as const).map((side) => {
        const items = view[side];
        if (items.length === 0) return null;
        return (
          <div key={side} className="flex flex-col gap-1">
            <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
              {side === "home" ? "casa" : "visitante"}
            </span>
            {items.map((p) => (
              <div
                key={`${side}-${p.name}`}
                className="flex items-center justify-between text-body-sm tracking-tight"
              >
                <span className="text-foreground">{p.name}</span>
                <span className="font-mono text-eyebrow text-muted-foreground">
                  {p.status}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function LineupBody({
  view,
}: {
  view: ReturnType<typeof toLineupView>;
}) {
  if (!view.available) return null;
  return (
    <div className="flex flex-col gap-3">
      {(["home", "away"] as const).map((side, i) => {
        const lineup = view[side];
        if (!lineup) return null;
        return (
          <div key={side} className="flex flex-col gap-1.5">
            {i > 0 && <Separator />}
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                {side === "home" ? "casa" : "visitante"}
              </span>
              {lineup.formation && (
                <span className="font-mono text-eyebrow tabular-nums text-muted-foreground">
                  {lineup.formation}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-body-sm tracking-tight">
              {lineup.starters.map((p) => (
                <span key={p}>{p}</span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
