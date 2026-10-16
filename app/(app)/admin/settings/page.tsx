import { DefinitionRow } from "@/components/admin/definition-row";
import { PageHeading } from "@/components/admin/page-heading";
import { ADMIN_FLAGS, type AdminFlagDef } from "@/lib/config/admin-flags";
import {
  getAdminFlagValues,
  getDefaultModelId,
  getGenerationParams,
} from "@/lib/db/queries/ai-config";

import { AdminFlagControl } from "./admin-flag-control";
import { DefaultModelForm } from "./default-model-form";
import { GenerationParamsForm } from "./generation-params-form";
import { ModelVersionsPanel } from "./model-versions-panel";
import { TeamRatingsPanel } from "./team-ratings-panel";

export const dynamic = "force-dynamic";
// "Reajustar agora" roda o refit do Dixon-Coles na server action desta página.
export const maxDuration = 300;

// Gateado por app/admin/layout.tsx (role === "admin" → notFound pra outros).
export default async function AdminSettingsPage() {
  const [current, genParams, flagValues] = await Promise.all([
    getDefaultModelId(),
    getGenerationParams(),
    getAdminFlagValues(),
  ]);

  return (
    <div className="bg-background text-foreground">
      <div className="mx-auto w-full max-w-reading px-6 py-8">
        <PageHeading
          backLink={{ href: "/admin", label: "admin" }}
          title="Configurações de IA"
          subtitle="modelo e motor de análise · flags · Dixon-Coles"
        />

        <section className="pb-8">
          <h2 className="pb-3 font-mono text-meta uppercase tracking-label text-muted-foreground">
            versões de modelo
          </h2>
          {/* Haiku, Sonnet e Opus: a versão em uso (automática, ADR 0062, ou a
              conferida do registry), o fallback, o preço e as falhas. */}
          <ModelVersionsPanel enabled={flagValues.enableAutoModelVersions === true} />
        </section>

        <section>
          <h2 className="pb-4 font-mono text-meta uppercase tracking-label text-muted-foreground">
            padrão global
          </h2>
          <DefaultModelForm current={current} />
        </section>

        <section className="pt-10">
          <h2 className="pb-4 font-mono text-meta uppercase tracking-label text-muted-foreground">
            parâmetros de geração
          </h2>
          <GenerationParamsForm current={genParams} />
        </section>

        <section className="pt-10">
          <h2 className="pb-3 font-mono text-meta uppercase tracking-label text-muted-foreground">
            flags
          </h2>
          <div className="rounded-md border border-border">
            {/* Renderizado do registry (lib/config/admin-flags.ts): flag nova
                entra lá, sem mexer aqui. */}
            {ADMIN_FLAGS.map((flag) => {
              const current = flagValues[flag.key];
              return (
                <DefinitionRow
                  key={flag.key}
                  className="items-start gap-4 px-4 py-3 last:border-b-0"
                  label={
                    <div className="flex flex-col gap-1">
                      <span className="text-body font-medium">
                        {flag.label} · {formatFlagValue(flag, current)}
                      </span>
                      <span className="text-body-sm text-muted-foreground">
                        {flag.description}
                      </span>
                      {"costNote" in flag && flag.costNote && (
                        <span className="font-mono text-meta text-muted-foreground">
                          custo: {flag.costNote}
                        </span>
                      )}
                    </div>
                  }
                  value={<AdminFlagControl flag={flag} current={current} />}
                />
              );
            })}
          </div>
          <p className="pt-3 text-body-sm text-muted-foreground">
            Valem para todos os usuários, sem redeploy.
          </p>
        </section>

        <TeamRatingsPanel enabled={flagValues.enableDixonColes === true} />
      </div>
    </div>
  );
}

function formatFlagValue(flag: AdminFlagDef, value: boolean | string): string {
  if (flag.kind === "boolean") return value ? "ligada" : "desligada";
  return flag.valueLabels?.[String(value)] ?? String(value);
}
