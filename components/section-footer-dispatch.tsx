"use client";

import { useActionState, useRef, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";

import { analyzeMatch, type AnalyzeMatchResult } from "@/app/actions/predictions";
import { AnalysisResult } from "@/components/analysis-result";
import { ModelOverrideSelect } from "@/components/model-override-select";
import { Button } from "@/components/ui/button";
import {
  initialModelOverride,
  resyncModelOverride,
} from "@/lib/ai/model-override";
import type { AnalysisView } from "@/lib/view/types";

type Props = {
  matchId: string;
  // Mercado DESTA seção (cru): viaja no hidden input do form, então a reanálise é
  // escopada a este mercado — só esta seção muda (AC #244).
  marketKey: string;
  // Análise atual da seção (prop server, refrescada por revalidatePath). O resultado
  // transiente da action (state.view) é renderizado direto (single-result por seção, sem
  // o risco de duplicação do painel #243): espelha o single-mode antigo.
  view: AnalysisView;
  // modelVersion CRU (AIModelId) da análise — seed do dropdown no PRIMEIRO mount (o
  // modelo que rodou). Em sessão a escolha do usuário persiste (a seção não remonta na
  // reanálise: key=marketKey), inclusive o sentinel "default".
  modelId: string;
  // Modelos selecionáveis pela audiência ({id,label}). Vazio (usuário regular) → sem
  // dropdown: só o label + refresh. Gate efetivo é server-side em analyzeMatch.
  selectableModels: { id: string; label: string }[];
  defaultModelLabel: string;
};

// Rodapé de reanálise POR SEÇÃO (#244): "análise feita com modelo X" + dropdown de modelo
// inline + botão refresh. Form + useActionState próprios → reanalisar uma seção não mexe
// nas outras. A seção NÃO remonta na reanálise (key=marketKey no pai), então a escolha de
// modelo persiste (sem reset pro default). Montado SÓ em jogo analisável (o caminho
// read-only não monta hooks).
export function SectionFooterDispatch({
  matchId,
  marketKey,
  view,
  modelId,
  selectableModels,
  defaultModelLabel,
}: Props) {
  const [state, formAction, pending] = useActionState(analyzeMatch, {
    ok: true,
    view,
  } satisfies AnalyzeMatchResult);

  // Persistência do dropdown entre reanálises (#239), por seção. Seed inicial = o modelo
  // que rodou esta análise (modelId); a escolha viva (seededOverride) sobrevive à
  // reanálise — preserva inclusive o sentinel "default" (a seção não remonta).
  const seededOverride = useRef(
    initialModelOverride(modelId, selectableModels),
  );
  const [modelOverride, setModelOverride] = useState(seededOverride.current);
  const prevState = useRef(state);
  const actionCompleted = prevState.current !== state;
  prevState.current = state;
  const resynced = resyncModelOverride({
    displayed: modelOverride,
    live: seededOverride.current,
    actionCompleted,
  });
  if (resynced !== null) setModelOverride(resynced);
  const handleModelChange = (value: string) => {
    seededOverride.current = value;
    setModelOverride(value);
  };

  const shownView = state.ok ? state.view : view;
  const errorMsg = !state.ok ? state.error : null;
  const hasModelChoice = selectableModels.length > 0;

  return (
    <form action={formAction} aria-busy={pending}>
      <input type="hidden" name="matchId" value={matchId} />
      <input type="hidden" name="marketKey" value={marketKey} />

      {pending ? (
        <div className="relative">
          <div className="pointer-events-none opacity-40">
            <AnalysisResult view={shownView} />
          </div>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 shadow">
              <Loader2 className="size-4 animate-spin text-accent-fg" />
              <span className="text-[12.5px] font-medium tracking-tight">
                Reanalisando…
              </span>
            </div>
          </div>
        </div>
      ) : (
        <AnalysisResult view={shownView} />
      )}

      {/* Erro de reanálise: mantém o resultado anterior visível (shownView=view) e
          mostra um aviso; o refresh do rodapé tenta de novo. */}
      {errorMsg && (
        <p className="px-4 pt-2 text-[12px] text-warn-fg tracking-tight">
          {errorMsg}
        </p>
      )}

      {/* Rodapé: label do modelo que rodou + (admin) dropdown inline + refresh à direita. */}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-border pt-3">
        <div className="flex flex-wrap items-end gap-3">
          <span className="font-mono text-[10.5px] text-muted-foreground tracking-tight">
            análise feita com modelo {shownView.model}
          </span>
          {hasModelChoice && (
            <ModelOverrideSelect
              value={modelOverride}
              onChange={handleModelChange}
              models={selectableModels}
              defaultModelLabel={defaultModelLabel}
            />
          )}
        </div>
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          disabled={pending}
        >
          <RefreshCcw className="size-3.5" />
          {pending ? "Reanalisando…" : "Analisar de novo"}
        </Button>
      </div>
    </form>
  );
}
