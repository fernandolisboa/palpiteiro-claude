"use client";

import { useActionState } from "react";

import {
  updateAnalysisEngine,
  type UpdateAnalysisEngineResult,
} from "@/app/actions/ai-config";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  ANALYSIS_ENGINE_LABEL,
  ANALYSIS_ENGINES,
  type AnalysisEngine,
} from "@/lib/ai/engine/analysis-engine";

type Props = {
  current: AnalysisEngine;
};

// Flag do motor de análise (ADR 0041 §5). O server revalida role + valor em
// updateAnalysisEngine.
export function AnalysisEngineForm({ current }: Props) {
  const [state, action, pending] = useActionState<
    UpdateAnalysisEngineResult | null,
    FormData
  >(updateAnalysisEngine, null);

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-eyebrow tracking-label text-muted-foreground font-mono uppercase">
          Motor de análise
        </span>
        <div className="max-w-aside">
          <Select name="analysisEngine" defaultValue={current}>
            {ANALYSIS_ENGINES.map((engine) => (
              <option
                key={engine}
                value={engine}
                className="bg-popover text-popover-foreground"
              >
                {ANALYSIS_ENGINE_LABEL[engine]}
              </option>
            ))}
          </Select>
        </div>
      </label>

      <p className="text-body-sm text-muted-foreground">
        No motor Código + JEV, a probabilidade e a aposta saem do modelo de
        placar ajustado pelos julgamentos JEV, e o LLM só escreve o racional.
        Vale para 1X2, over/under, ambas marcam e dupla chance; os demais
        mercados seguem no LLM. Vale para todas as análises novas, sem redeploy.
      </p>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Salvando…" : "Salvar motor"}
      </Button>

      {state &&
        (state.ok ? (
          <p
            className="text-body text-edge-fg"
            role="status"
            aria-live="polite"
          >
            Motor salvo.
          </p>
        ) : (
          <p
            className="text-body text-destructive"
            role="alert"
            aria-live="assertive"
          >
            {state.error}
          </p>
        ))}
    </form>
  );
}
