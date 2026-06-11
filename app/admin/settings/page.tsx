import { BackLink } from "@/components/back-link";
import { SELECTABLE_MODELS } from "@/lib/ai/models";
import { getDefaultModelId } from "@/lib/db/queries/ai-config";

import { DefaultModelForm } from "./default-model-form";

export const dynamic = "force-dynamic";

// Gateado por app/admin/layout.tsx (role === "admin" → notFound pra outros).
export default async function AdminSettingsPage() {
  const current = await getDefaultModelId();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-[640px] px-6 py-8">
        <BackLink href="/admin" label="admin" />

        <h1 className="text-[20px] font-medium tracking-[-0.02em]">
          Configurações de IA
        </h1>
        <p className="pb-6 font-mono text-[11px] text-muted-foreground">
          modelo de análise · default global
        </p>

        <section className="pb-8">
          <h2 className="pb-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            modelos disponíveis
          </h2>
          <div className="rounded-md border border-border">
            {SELECTABLE_MODELS.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between border-b border-border px-4 py-3 last:border-b-0"
              >
                <div className="flex flex-col">
                  <span className="text-[13px] font-medium">{m.label}</span>
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    {m.id}
                  </span>
                </div>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  ${m.inputPricePerMTok} in / ${m.outputPricePerMTok} out · 1M
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="pb-4 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            padrão global
          </h2>
          <DefaultModelForm current={current} />
        </section>
      </div>
    </div>
  );
}
