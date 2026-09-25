import { DefinitionRow } from "@/components/admin/definition-row";
import { PageHeading } from "@/components/admin/page-heading";
import { SELECTABLE_MODELS } from "@/lib/ai/models";
import { ADMIN_FLAGS, type AdminFlagDef } from "@/lib/config/admin-flags";
import {
  getAdminFlagValues,
  getDefaultModelId,
  getGenerationParams,
} from "@/lib/db/queries/ai-config";

import { AdminFlagControl } from "./admin-flag-control";
import { DefaultModelForm } from "./default-model-form";
import { GenerationParamsForm } from "./generation-params-form";

export const dynamic = "force-dynamic";

// Gateado por app/admin/layout.tsx (role === "admin" → notFound pra outros).
export default async function AdminSettingsPage() {
  const current = await getDefaultModelId();
  const genParams = await getGenerationParams();
  const flagValues = await getAdminFlagValues();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-reading px-6 py-8">
        <PageHeading
          backLink={{ href: "/admin", label: "admin" }}
          title="Configurações de IA"
          subtitle="modelo de análise · default global"
        />

        <section className="pb-8">
          <h2 className="pb-3 font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
            modelos disponíveis
          </h2>
          <div className="rounded-md border border-border">
            {/* Lista TODO o registry. Hoje todos são userSelectable (após #240 +
                #241), mas um modelo admin-only ganha um rótulo explícito — assim
                a lista nunca insinua que um modelo não-salvável é padrão usável
                (o dropdown de "padrão global" o desabilita em paralelo). */}
            {SELECTABLE_MODELS.map((m) => (
              <DefinitionRow
                key={m.id}
                className="px-4 py-3 last:border-b-0"
                label={
                  <div className="flex flex-col">
                    <span className="text-body font-medium">
                      {m.label}
                      {m.userSelectable ? "" : " · admin-only"}
                    </span>
                    <span className="font-mono text-eyebrow text-muted-foreground">
                      {m.id}
                    </span>
                  </div>
                }
                value={
                  <span className="font-mono text-meta tabular-nums text-muted-foreground">
                    ${m.inputPricePerMTok} in / ${m.outputPricePerMTok} out · 1M
                  </span>
                }
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="pb-4 font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
            padrão global
          </h2>
          <DefaultModelForm current={current} />
        </section>

        <section className="pt-10">
          <h2 className="pb-4 font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
            parâmetros de geração
          </h2>
          <GenerationParamsForm current={genParams} />
        </section>

        <section className="pt-10">
          <h2 className="pb-3 font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
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
                        <span className="font-mono text-eyebrow text-muted-foreground">
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
      </div>
    </div>
  );
}

function formatFlagValue(flag: AdminFlagDef, value: boolean | string): string {
  if (flag.kind === "boolean") return value ? "ligada" : "desligada";
  return flag.valueLabels?.[String(value)] ?? String(value);
}
