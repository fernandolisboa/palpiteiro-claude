import { DataEmptyLine } from "@/components/data-empty-line";
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

  const injuriesCount = injuriesView.home.length + injuriesView.away.length;

  // Bloco sem dado vira uma linha (#576); com dado, o MatchCollapsible (fechado).
  return (
    <>
      <div className="pt-3">
        {injuriesView.available && injuriesCount > 0 ? (
          <MatchCollapsible title="Lesões e suspensões" meta={`${injuriesCount} baixas`}>
            <InjuriesBody view={injuriesView} />
          </MatchCollapsible>
        ) : (
          <DataEmptyLine
            title="Lesões e suspensões"
            reason={injuriesView.available ? "nenhuma baixa reportada" : "dados indisponíveis"}
          />
        )}
      </div>
      <div className="pt-3">
        {lineupView.available ? (
          <MatchCollapsible
            title="Escalações"
            meta={lineupView.home && lineupView.away ? "divulgadas" : "parciais"}
          >
            <LineupBody view={lineupView} />
          </MatchCollapsible>
        ) : (
          <DataEmptyLine title="Escalações" reason="ainda não divulgadas" />
        )}
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
    <div className="flex max-w-reading flex-col gap-3">
      {(["home", "away"] as const).map((side) => {
        const items = view[side];
        if (items.length === 0) return null;
        return (
          <div key={side} className="flex flex-col gap-1">
            <span className="text-meta uppercase tracking-label text-muted-foreground">
              {side === "home" ? "mandante" : "visitante"}
            </span>
            {items.map((p) => (
              <div
                key={`${side}-${p.name}`}
                className="flex items-center justify-between text-body-sm tracking-tight"
              >
                <span className="text-foreground">{p.name}</span>
                <span className="text-meta text-muted-foreground">
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
              <span className="text-meta uppercase tracking-label text-muted-foreground">
                {side === "home" ? "mandante" : "visitante"}
              </span>
              {lineup.formation && (
                <span className="font-mono text-meta tabular-nums text-muted-foreground">
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
