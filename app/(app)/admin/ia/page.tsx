import { AdminSubTabs } from "@/components/admin/admin-sub-tabs";
import { FlagList } from "@/components/admin/flag-list";
import { PageHeading } from "@/components/admin/page-heading";
import { MODEL_FAMILIES } from "@/lib/ai/model-versions/types";
import { pinnedModelFor } from "@/lib/ai/models";
import {
  getAdminFlagValues,
  getDefaultModelId,
  getGenerationParams,
} from "@/lib/db/queries/ai-config";

import { DefaultModelForm, type InUsePrices } from "./default-model-form";
import { GenerationParamsForm } from "./generation-params-form";
import {
  familyModelInUse,
  ModelVersionsPanel,
  readModelVersionsPanelData,
} from "./model-versions-panel";
import { RevisitRefresh } from "@/components/revisit-refresh";

export const dynamic = "force-dynamic";

// Assistente de IA · modelos (#633; antes /admin/settings): o modelo de linguagem,
// seus parâmetros e as flags de IA. As flags do motor e o Dixon-Coles moram em
// /admin/motor. Gateado por app/(app)/admin/layout.tsx.
export default async function AdminAiModelsPage() {
  const [current, genParams, flagValues, versions] = await Promise.all([
    getDefaultModelId(),
    getGenerationParams(),
    getAdminFlagValues(),
    readModelVersionsPanelData(),
  ]);
  const autoVersions = flagValues.enableAutoModelVersions === true;
  // O padrão global grava a conferida (chave da família), mas roda a versão em uso:
  // o form mostra o preço dela (estimado até o admin confirmar).
  const inUsePrices: InUsePrices = {};
  for (const family of MODEL_FAMILIES) {
    const inUse = familyModelInUse(family, versions, autoVersions);
    if (inUse === null) continue;
    inUsePrices[pinnedModelFor(family).id] = {
      inputPricePerMTok: inUse.inputPricePerMTok,
      outputPricePerMTok: inUse.outputPricePerMTok,
      estimated: inUse.adopted?.priceEstimated === true,
    };
  }

  return (
    <div className="bg-background text-foreground">
      <RevisitRefresh />
      <div className="mx-auto w-full max-w-reading px-6 py-8">
        <PageHeading
          title="Assistente de IA"
          subtitle="o modelo de linguagem que narra a análise e explica as apostas"
        />
        <AdminSubTabs section="/admin/ia" current="/admin/ia" />

        <section className="pb-8">
          <h2 className="pb-3 font-mono text-meta uppercase tracking-label text-muted-foreground">
            versões de modelo
          </h2>
          {/* Haiku, Sonnet e Opus: a versão em uso (automática, ADR 0062, ou a
              conferida do registry), o fallback, o preço e as falhas. */}
          <ModelVersionsPanel enabled={autoVersions} data={versions} />
        </section>

        <section>
          <h2 className="pb-4 font-mono text-meta uppercase tracking-label text-muted-foreground">
            padrão global
          </h2>
          <DefaultModelForm current={current} inUsePrices={inUsePrices} />
        </section>

        <section className="pt-10">
          <h2 className="pb-4 font-mono text-meta uppercase tracking-label text-muted-foreground">
            parâmetros de geração
          </h2>
          <GenerationParamsForm current={genParams} />
        </section>

        <FlagList area="ia" values={flagValues} />
      </div>
    </div>
  );
}
