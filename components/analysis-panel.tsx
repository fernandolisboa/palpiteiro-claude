"use client";

import { useActionState, useRef, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";

import { analyzeMatch, type AnalyzeMatchResult } from "@/app/actions/predictions";
import { AnalysisErrorCard } from "@/components/analysis-error-card";
import { AnalysisResult } from "@/components/analysis-result";
import { AnalyzeCTA } from "@/components/analyze-cta";
import { MarketSelect } from "@/components/market-select";
import { ModelOverrideSelect } from "@/components/model-override-select";
import { PreviousAnalyses } from "@/components/previous-analyses";
import { Button } from "@/components/ui/button";
import {
  initialModelOverride,
  resyncModelOverride,
} from "@/lib/ai/model-override";
import { MODEL_REGISTRY, isAIModelId } from "@/lib/ai/models";
import type { AnalysisView, PreviousAnalysisItem } from "@/lib/view/types";

type Props = {
  matchId: string;
  existing: AnalysisView | null;
  oddsAvailable: boolean;
  // Modelos que esta audiência pode escolher como override ({id,label}
  // serializável, resolvido no server). Vazio → seletor escondido. A garantia
  // de gating é server-side em analyzeMatch.
  selectableModels: { id: string; label: string }[];
  // Mercados que esta audiência pode analisar ({key,label} serializável,
  // resolvido no server, over_under primeiro). ≤1 → seletor escondido (hidden,
  // default over_under). Gate efetivo é re-validado server-side em analyzeMatch.
  selectableMarkets: { key: string; label: string }[];
  // Label do default global, resolvido no server. Usado quando não há override
  // nem preferência (ou "Usar padrão global") pra rotular o progresso.
  defaultModelLabel: string;
  // Preferência pessoal do usuário (id cru, validado contra audiência no
  // server) ou null. Espelha a cascata de predict: sem override, é o modelo que
  // vai REALMENTE rodar — então rotula o passo "gerando análise (…)".
  preferredModelId: string | null;
  // Análises ANTERIORES deste jogo (#204): history.slice(1), já mapeadas pra view
  // no server. Renderizadas numa seção colapsável abaixo da atual, OCULTA durante
  // pending (a lista server fica stale no meio da reanálise; após revalidatePath a
  // recém-substituída entra no histórico). Vazio → a seção não renderiza.
  previous: PreviousAnalysisItem[];
};

export function AnalysisPanel({
  matchId,
  existing,
  oddsAvailable,
  selectableModels,
  selectableMarkets,
  defaultModelLabel,
  preferredModelId,
  previous,
}: Props) {
  const initial: AnalyzeMatchResult | null = existing
    ? { ok: true, view: existing }
    : null;
  const [state, formAction, pending] = useActionState(analyzeMatch, initial);
  // Persiste o modelo escolhido entre reanálises (#239): sem isso, cada conclusão
  // de análise repõe o dropdown no "default" (regra em `resyncModelOverride`). O
  // seed é a preferência server-side; `seededOverride` guarda o valor "vivo" (a
  // última escolha) que deve sobreviver à reanálise. Sem URL/localStorage (issue).
  const seededOverride = useRef(
    initialModelOverride(preferredModelId, selectableModels),
  );
  const [modelOverride, setModelOverride] = useState(seededOverride.current);
  // Re-aplica a escolha viva quando a action conclui (identidade de `state` muda).
  // setState na FASE DE RENDER é o padrão React intencional ("ajustar state ao
  // mudar uma entrada" / store info from previous render) — NÃO troque por
  // useEffect, que reintroduziria o flash do default.
  const prevState = useRef(state);
  const actionCompleted = prevState.current !== state;
  prevState.current = state;
  const resynced = resyncModelOverride({
    displayed: modelOverride,
    live: seededOverride.current,
    actionCompleted,
  });
  if (resynced !== null) setModelOverride(resynced);
  // Cada escolha no dropdown vira o novo valor "vivo" a re-semear nas próximas
  // reanálises — assim um override one-off persiste como a preferência faria.
  const handleModelChange = (value: string) => {
    seededOverride.current = value;
    setModelOverride(value);
  };
  // Mercado a analisar. Default = primeiro mercado selecionável (over_under, que
  // sorta primeiro no server) ou "over_under" se a lista vier vazia. Com ≤1
  // mercado o seletor some e a action coerce pro default — defesa em profundidade.
  const [marketKey, setMarketKey] = useState(
    selectableMarkets[0]?.key ?? "over_under",
  );

  // Modelo que a análise vai REALMENTE usar — espelha a cascata de predict:
  // override por análise > preferência do usuário > default global. Alimenta o
  // passo "gerando análise (…)" do AnalyzeCTA.
  const modelLabel =
    modelOverride !== "default" && isAIModelId(modelOverride)
      ? MODEL_REGISTRY[modelOverride].label
      : preferredModelId && isAIModelId(preferredModelId)
        ? MODEL_REGISTRY[preferredModelId].label
        : defaultModelLabel;

  const view = state?.ok ? state.view : existing;
  const errorMsg = state && !state.ok ? state.error : null;

  const hasSelectableModels = selectableModels.length > 0;
  // Seletor de mercado só com >1 opção (audiência com match_result além do
  // over_under = admin). Mercado único → seletor escondido, `marketKey` viaja num
  // hidden input. Espelha o gate do ModelOverrideSelect.
  const hasMarketChoice = selectableMarkets.length > 1;

  // Override por análise, limitado à audiência (lista vinda do server). Sem
  // modelos selecionáveis o select some e a action usa o default global.
  const modelSelect = hasSelectableModels ? (
    <ModelOverrideSelect
      value={modelOverride}
      onChange={handleModelChange}
      models={selectableModels}
      defaultModelLabel={defaultModelLabel}
    />
  ) : null;

  const marketSelect = hasMarketChoice ? (
    <MarketSelect
      value={marketKey}
      onChange={setMarketKey}
      markets={selectableMarkets}
    />
  ) : null;

  // Há algum controle (mercado e/ou modelo) acima da CTA?
  const hasControls = hasSelectableModels || hasMarketChoice;
  const controls = (
    <>
      {marketSelect}
      {modelSelect}
    </>
  );

  // Wrapper flex (NÃO fragmento): o gap-3 da match page espaça o PAINEL dos
  // irmãos, não o form da seção de histórico DENTRO dele — um fragmento deixaria a
  // costura form↔histórico colada. O <form> segue intacto (aria-busy + hidden
  // inputs + contexto de submit) como 1º filho; a seção é o irmão depois dele.
  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} aria-busy={pending}>
        <input type="hidden" name="matchId" value={matchId} />
        {/* Mercado único: o seletor some, mas `marketKey` ainda viaja no FormData. */}
        {!hasMarketChoice && (
          <input type="hidden" name="marketKey" value={marketKey} />
        )}

        {/* Quando já existe predição e há controles (mercado e/ou modelo), a
            re-análise vem do botão ao lado dos dropdowns (afordância ÚNICA) — por
            isso o AnalysisResult abaixo NÃO recebe `again`, pra não duplicar o botão.
            Na primeira análise (sem view) os dropdowns aparecem sozinhos acima da CTA. */}
        {view && hasControls ? (
          <div className="flex flex-wrap items-end gap-3 pb-3">
            {controls}
            <Button type="submit" size="sm" disabled={pending}>
              <RefreshCcw className="size-3.5" />
              {pending ? "Reanalisando…" : "Analisar de novo"}
            </Button>
          </div>
        ) : (
          !view &&
          hasControls && (
            <div className="flex flex-wrap items-end gap-3 pb-3">{controls}</div>
          )
        )}

        {pending && view ? (
          <div className="relative">
            <div className="pointer-events-none opacity-40">
              <AnalysisResult view={view} again={!hasControls} />
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
        ) : pending ? (
          <AnalyzeCTA pending modelLabel={modelLabel} />
        ) : view ? (
          <AnalysisResult view={view} again={!hasControls} />
        ) : errorMsg ? (
          <AnalysisErrorCard error={errorMsg} />
        ) : oddsAvailable ? (
          <AnalyzeCTA pending={false} />
        ) : (
          <NoOddsHint />
        )}
      </form>

      {/* OCULTA durante pending: a lista server fica stale no meio da reanálise.
          Após revalidatePath (analyzeMatch) a recém-substituída entra no histórico e
          a seção reaparece com pending=false. Vazia → PreviousAnalyses retorna null. */}
      {!pending && <PreviousAnalyses items={previous} />}
    </div>
  );
}

function NoOddsHint() {
  return (
    <div className="rounded-md border border-dashed border-border px-4 py-3 text-[11.5px] text-muted-foreground tracking-tight">
      Análise indisponível enquanto não houver odds publicadas para este jogo.
    </div>
  );
}
