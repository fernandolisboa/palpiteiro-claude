import { DefinitionRow } from "@/components/admin/definition-row";
import { PageHeading } from "@/components/admin/page-heading";
import { SELECTABLE_MODELS } from "@/lib/ai/models";
import {
  getAnalysisEngine,
  getDefaultModelId,
  getGenerationParams,
} from "@/lib/db/queries/ai-config";

import { AnalysisEngineForm } from "./analysis-engine-form";
import { DefaultModelForm } from "./default-model-form";
import { GenerationParamsForm } from "./generation-params-form";

export const dynamic = "force-dynamic";

// Gateado por app/admin/layout.tsx (role === "admin" → notFound pra outros).
export default async function AdminSettingsPage() {
  const current = await getDefaultModelId();
  const genParams = await getGenerationParams();
  const analysisEngine = await getAnalysisEngine();

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
          <h2 className="pb-4 font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
            motor de análise
          </h2>
          <AnalysisEngineForm current={analysisEngine} />
        </section>
      </div>
    </div>
  );
}
