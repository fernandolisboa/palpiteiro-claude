import { AlertTriangle } from "lucide-react";

import { DefinitionRow } from "@/components/admin/definition-row";
import { PageHeading } from "@/components/admin/page-heading";
import { Callout } from "@/components/ui/callout";
import {
  estimateMonthlyOddsCredits,
  ODDS_API_MONTHLY_CREDITS,
  ODDS_CREDITS_PER_MONTH_ESTIMATE,
  projectRemainingMonthOddsCredits,
} from "@/lib/config/odds-credits";
import { getLeagueSettings } from "@/lib/db/queries/league-settings";
import {
  getProviderQuota,
  type ProviderQuotaRow,
} from "@/lib/db/queries/provider-quota";
import { LEAGUE_LABEL, formatRelativeAgo, leagueToKey } from "@/lib/format";
import { ODDS_API_PROVIDER } from "@/lib/odds/persist-odds-api-quota";
import { CANONICAL_TEAMS } from "@/lib/providers/sports-data/canonical-teams";

import { LeagueToggle } from "./league-toggle";

export const dynamic = "force-dynamic";

// Saldo real é telemetria: falha de leitura não pode derrubar a página dos toggles.
async function readOddsApiQuota(): Promise<ProviderQuotaRow | null> {
  try {
    return await getProviderQuota(ODDS_API_PROVIDER);
  } catch (err) {
    console.warn(
      JSON.stringify({
        scope: "admin_leagues",
        warning: "falha ao ler provider_quota",
        message: err instanceof Error ? err.message : String(err),
      })
    );
    return null;
  }
}

// A cota da The Odds API reseta por mês: leitura de mês (UTC) anterior não diz o saldo de hoje.
function isSameUtcMonth(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth()
  );
}

// Gateado por app/admin/layout.tsx (role === "admin" → notFound pra outros).
// Ligas ativas no banco (ADR 0050): o toggle vale sem deploy pra home, sync de
// fixtures e prewarm de odds.
export default async function AdminLeaguesPage() {
  const [settings, quota] = await Promise.all([
    getLeagueSettings(),
    readOddsApiQuota(),
  ]);
  const now = new Date();
  const active = settings.filter((s) => s.active).map((s) => s.league);
  const totalCredits = estimateMonthlyOddsCredits(active);
  const overBudget = totalCredits > ODDS_API_MONTHLY_CREDITS;
  const quotaIsCurrent =
    quota !== null && isSameUtcMonth(quota.observedAt, now);
  const ago = quota ? formatRelativeAgo(quota.observedAt, now) : null;
  const quotaReadAgo = ago === "agora" ? "agora" : `há ${ago}`;
  const projectedRest = projectRemainingMonthOddsCredits(active, now);
  const remainingBelowProjection =
    quotaIsCurrent &&
    quota.monthlyRemaining !== null &&
    quota.monthlyRemaining < projectedRest;

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
          {quota ? (
            <DefinitionRow
              label={<span className="text-body">Saldo real (odds api)</span>}
              value={
                <span
                  className={
                    remainingBelowProjection
                      ? "text-meta text-destructive font-mono tabular-nums"
                      : "text-meta text-muted-foreground font-mono tabular-nums"
                  }
                >
                  usado {quota.monthlyUsed ?? "?"} / {ODDS_API_MONTHLY_CREDITS}{" "}
                  · restam {quota.monthlyRemaining ?? "?"} · lido {quotaReadAgo}
                </span>
              }
            />
          ) : (
            <p className="text-body-sm text-muted-foreground pt-3">
              O saldo real aparece depois do próximo run do prewarm de odds.
            </p>
          )}
          {quota && !quotaIsCurrent && (
            <p className="text-body-sm text-muted-foreground pt-3">
              Última leitura é de um mês anterior; a cota já resetou. O saldo
              atualiza no próximo run do prewarm.
            </p>
          )}
          {remainingBelowProjection && (
            <Callout
              variant="warn"
              className="mt-4"
              icon={<AlertTriangle aria-hidden="true" className="size-4" />}
              title="Saldo abaixo do gasto projetado"
            >
              <p className="text-body-sm text-muted-foreground">
                Restam {quota.monthlyRemaining} créditos, mas as ligas ativas
                devem gastar ~{projectedRest} até o fim do mês (estimativa
                proporcional aos dias restantes, UTC). Desligue alguma liga pra
                não estourar a cota antes do reset.
              </p>
            </Callout>
          )}
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
                até o reset mensal. Compare com o saldo real acima.
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
