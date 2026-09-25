import { AlertTriangle } from "lucide-react";

import { DefinitionRow } from "@/components/admin/definition-row";
import { PageHeading } from "@/components/admin/page-heading";
import { Callout } from "@/components/ui/callout";
import {
  estimateMonthlyOddsCredits,
  ODDS_API_MONTHLY_CREDITS,
  ODDS_CREDITS_PER_MONTH_ESTIMATE,
} from "@/lib/config/odds-credits";
import { getLeagueSettings } from "@/lib/db/queries/league-settings";
import { LEAGUE_LABEL, leagueToKey } from "@/lib/format";
import { CANONICAL_TEAMS } from "@/lib/providers/sports-data/canonical-teams";

import { LeagueToggle } from "./league-toggle";

export const dynamic = "force-dynamic";

// Gateado por app/admin/layout.tsx (role === "admin" → notFound pra outros).
// Ligas ativas no banco (ADR 0050): o toggle vale sem deploy pra home, sync de
// fixtures e prewarm de odds.
export default async function AdminLeaguesPage() {
  const settings = await getLeagueSettings();
  const active = settings.filter((s) => s.active).map((s) => s.league);
  const totalCredits = estimateMonthlyOddsCredits(active);
  const overBudget = totalCredits > ODDS_API_MONTHLY_CREDITS;

  return (
    <div className="bg-background text-foreground min-h-screen">
      <div className="max-w-reading mx-auto w-full px-6 py-8">
        <PageHeading
          backLink={{ href: "/admin", label: "admin" }}
          title="Ligas"
          subtitle="ligas ativas · sem deploy"
        />

        <section className="pb-8">
          <h2 className="text-eyebrow tracking-label text-muted-foreground pb-3 font-mono uppercase">
            orçamento da odds api
          </h2>
          <DefinitionRow
            label={
              <span className="text-body">
                Estimativa mensal das ligas ativas
              </span>
            }
            value={
              <span
                className={
                  overBudget
                    ? "text-meta text-destructive font-mono tabular-nums"
                    : "text-meta text-muted-foreground font-mono tabular-nums"
                }
              >
                ~{totalCredits} / {ODDS_API_MONTHLY_CREDITS} créditos
              </span>
            }
          />
          {overBudget && (
            <Callout
              variant="warn"
              className="mt-4"
              icon={<AlertTriangle aria-hidden="true" className="size-4" />}
              title="Acima da cota grátis"
            >
              <p className="text-body-sm text-muted-foreground">
                A soma estimada passa dos {ODDS_API_MONTHLY_CREDITS}{" "}
                créditos/mês. Estourar a cota derruba as odds de todas as ligas
                até o reset mensal. Acompanhe o quotaMonthlyUsed no log do
                prewarm.
              </p>
            </Callout>
          )}
          <p className="text-body-sm text-muted-foreground pt-3">
            Só prewarm (ADRs 0044, 0045, 0049); o uso de página soma ~30–80/mês.
          </p>
        </section>

        <section>
          <h2 className="text-eyebrow tracking-label text-muted-foreground pb-3 font-mono uppercase">
            ligas suportadas
          </h2>
          <div className="border-border rounded-md border">
            {settings.map((s) => {
              const label = LEAGUE_LABEL[leagueToKey(s.league)];
              const teams = CANONICAL_TEAMS[s.league].length;
              return (
                <DefinitionRow
                  key={s.league}
                  className="gap-4 px-4 py-3 last:border-b-0"
                  label={
                    <div className="flex flex-col">
                      <span className="text-body font-medium">
                        {label}
                        {s.active ? " · ativa" : ""}
                      </span>
                      <span className="text-eyebrow text-muted-foreground font-mono">
                        ~{ODDS_CREDITS_PER_MONTH_ESTIMATE[s.league]}{" "}
                        créditos/mês ·{" "}
                        {teams > 0 ? `${teams} times` : "times não semeados"}
                      </span>
                    </div>
                  }
                  value={
                    <LeagueToggle
                      league={s.league}
                      label={label}
                      active={s.active}
                    />
                  }
                />
              );
            })}
          </div>
          <p className="text-body-sm text-muted-foreground pt-3">
            Liga sem times precisa ser semeada com scripts/generate-team-ids.ts
            (e deploy) antes de ser ligada.
          </p>
        </section>
      </div>
    </div>
  );
}
