import { DefinitionRow } from "@/components/admin/definition-row";
import {
  listLeagueFits,
  type LeagueFitSummary,
} from "@/lib/db/queries/team-ratings";
import { LEAGUE_LABEL, formatRelativeAgo, leagueToKey } from "@/lib/format";
import { DC_MAX_FIT_AGE_MS } from "@/lib/quant/match-model";

import { RefitRatingsButton } from "./refit-ratings-button";

// Telemetria: falha de leitura não pode derrubar a página de configurações.
async function readFits(): Promise<LeagueFitSummary[] | null> {
  try {
    return await listLeagueFits();
  } catch (err) {
    console.warn(
      JSON.stringify({
        scope: "admin_settings",
        warning: "falha ao ler team_rating_fits",
        message: err instanceof Error ? err.message : String(err),
      })
    );
    return null;
  }
}

/** Último ajuste do Dixon-Coles por liga (ADR 0051) + refit sob demanda. */
export async function TeamRatingsPanel() {
  const fits = await readFits();
  const now = new Date();

  return (
    <section className="pt-10">
      <div className="flex items-start justify-between gap-4 pb-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-eyebrow tracking-label text-muted-foreground font-mono uppercase">
            modelo de placar · dixon-coles
          </h2>
          <p className="text-body-sm text-muted-foreground">
            Refit diário às 07:00 UTC. Ajuste com mais de 72h, ou time com menos
            jogos que o mínimo, cai no heurístico da tabela.
          </p>
        </div>
        <RefitRatingsButton />
      </div>
      <div className="border-border rounded-md border">
        {fits === null && (
          <p className="text-body-sm text-destructive px-4 py-3">
            Não foi possível ler os ajustes.
          </p>
        )}
        {fits?.length === 0 && (
          <p className="text-body-sm text-muted-foreground px-4 py-3">
            Nenhum ajuste ainda. Rode o refit ou espere o cron.
          </p>
        )}
        {fits?.map((f) => {
          const stale =
            now.getTime() - f.fittedAt.getTime() > DC_MAX_FIT_AGE_MS;
          return (
            <DefinitionRow
              key={f.league}
              className="items-start gap-4 px-4 py-3 last:border-b-0"
              label={
                <div className="flex flex-col gap-1">
                  <span className="text-body font-medium">
                    {LEAGUE_LABEL[leagueToKey(f.league)]}
                  </span>
                  <span className="text-eyebrow text-muted-foreground font-mono">
                    {f.matchCount} jogos · temporadas {f.seasons.join(", ")} ·{" "}
                    {f.usableTeamCount}/{f.teamCount} times com histórico
                  </span>
                </div>
              }
              value={
                <div className="flex flex-col items-end gap-1">
                  <span
                    className={
                      stale
                        ? "text-meta text-destructive font-mono"
                        : "text-meta text-muted-foreground font-mono"
                    }
                  >
                    há {formatRelativeAgo(f.fittedAt, now)}
                    {stale ? " · velho, usando heurístico" : ""}
                  </span>
                  <span className="text-eyebrow text-muted-foreground font-mono tabular-nums">
                    mando {f.homeAdvantage.toFixed(2)} · ρ {f.rho.toFixed(3)}
                  </span>
                </div>
              }
            />
          );
        })}
      </div>
    </section>
  );
}
