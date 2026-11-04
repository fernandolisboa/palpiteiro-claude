"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { Loader2, RotateCcw, Sparkles } from "lucide-react";

import { AnalyzedBadge } from "@/components/match-list/analyzed-badge";
import {
  getRun,
  startRun,
  subscribeRun,
  type RunEntry,
} from "@/components/palpites/palpite-run-store";
import { toHeroRunOutcome, type HeroRunOutcome } from "@/lib/ai/progress/protocol";
import { markRouterCacheStale } from "@/lib/nav/router-cache";
import { useOptionalRouter } from "@/lib/nav/use-optional-router";
import { cn } from "@/lib/utils";

// "Analisar com IA" direto da lista de jogos. Dispara o MESMO run da página do jogo
// (rota de streaming → runPalpiteHero, com os mesmos gates e a mesma cobrança) e guarda
// o run no mesmo store por jogo (palpite-run-store): abrir o jogo no meio mostra as
// etapas de agora, e o HERO entrega o desfecho lá também.

export const ROW_ANALYZE_TITLE =
  "Analisar com IA: usa análises do seu limite do dia e leva alguns minutos.";

export type RowAnalysis =
  | { kind: "idle" }
  | { kind: "running"; step: string | null }
  | { kind: "done" }
  | { kind: "error"; message: string };

const noSubscribe = () => () => {};
// O fim de cada run relê a lista uma vez só, mesmo com as duas árvores (celular e
// desktop) montadas e olhando o mesmo jogo.
const refreshed = new WeakSet<RunEntry>();

function currentStep(entry: RunEntry): string | null {
  for (let i = entry.steps.length - 1; i >= 0; i--) {
    if (entry.steps[i].status === "active") return entry.steps[i].label;
  }
  return null;
}

function fromOutcome(outcome: HeroRunOutcome | null): RowAnalysis {
  if (outcome && !outcome.ok) return { kind: "error", message: outcome.error };
  return { kind: "done" };
}

/**
 * Estado do run deste jogo pra linha da lista. O run vive no store por jogo; a reserva
 * pela server action (rota de streaming fora do ar) fica no estado local.
 */
export function useRowAnalysis(matchId: string): {
  state: RowAnalysis;
  start: () => void;
} {
  const router = useOptionalRouter();
  const subscribe = useCallback(
    (listener: () => void) => subscribeRun(matchId, listener),
    [matchId],
  );
  const entry = useSyncExternalStore(subscribe, () => getRun(matchId), () => null);
  // useSyncExternalStore sem assinatura só pra saber se já hidratou.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [fallback, setFallback] = useState<RowAnalysis | null>(null);
  const [fallbackPending, startFallback] = useTransition();

  const finished = entry?.status === "finished" ? entry : null;
  useEffect(() => {
    if (!finished || refreshed.has(finished)) return;
    refreshed.add(finished);
    // O jogo guardado no cache do roteador também fica velho (#639).
    markRouterCacheStale();
    if (finished.refresh) router?.refresh();
  }, [finished, router]);

  const start = useCallback(() => {
    const formData = new FormData();
    formData.set("matchId", matchId);
    formData.set("intent", "analysis");
    formData.set("pageLive", "0");
    setFallback(null);
    void startRun(matchId, formData, {
      intent: "analysis",
      live: false,
      baseSetId: null,
    }).then((mode) => {
      if (mode !== "fallback") return;
      startFallback(async () => {
        // Import sob demanda: a reserva quase nunca roda, e a lista (e os testes que a
        // renderizam soltos) não carrega o módulo das actions à toa.
        const result = await import("@/app/actions/predictions")
          .then(({ runPalpiteHero }) => runPalpiteHero(null, formData))
          .catch(() => null);
        const outcome = result
          ? toHeroRunOutcome(result)
          : { ok: false as const, error: "Falha temporária ao gerar análise. Tente novamente." };
        setFallback(fromOutcome(outcome));
        markRouterCacheStale();
        if (outcome.ok) router?.refresh();
      });
    });
  }, [matchId, router]);

  if (!hydrated) return { state: { kind: "idle" }, start };
  if (entry?.status === "running") {
    return { state: { kind: "running", step: currentStep(entry) }, start };
  }
  if (fallbackPending) return { state: { kind: "running", step: null }, start };
  if (finished) return { state: fromOutcome(finished.outcome), start };
  return { state: fallback ?? { kind: "idle" }, start };
}

const CHIP =
  "relative z-10 inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2.5 text-meta font-medium whitespace-nowrap";

/**
 * O selo à direita dos nomes: "analisado" quando já há análise, o botão "analisar"
 * quando dá pra rodar, "analisando" durante o run e "tentar de novo" se falhou.
 * `relative z-10`: fica acima do link esticado da linha.
 */
export function RowAnalyzeChip({
  state,
  onStart,
  hasPrediction,
  canAnalyze,
  className,
}: {
  state: RowAnalysis;
  onStart: () => void;
  hasPrediction: boolean;
  canAnalyze: boolean;
  className?: string;
}) {
  if (state.kind === "running") {
    return (
      <span
        className={cn(CHIP, "border-palpite-border bg-palpite-soft text-palpite-strong-fg", className)}
      >
        <Loader2 aria-hidden="true" className="palpite-spin size-3 animate-spin" />
        analisando
      </span>
    );
  }
  if (hasPrediction || state.kind === "done") return <AnalyzedBadge className={className} />;
  if (!canAnalyze && state.kind !== "error") return null;
  const retry = state.kind === "error";
  return (
    <button
      type="button"
      onClick={onStart}
      title={ROW_ANALYZE_TITLE}
      aria-label={retry ? "Tentar a análise com IA de novo" : "Analisar com IA"}
      className={cn(
        CHIP,
        // Quieto em repouso (a lista tem muitos): cinza com a faísca quente; quente
        // inteiro no hover/foco.
        "group/analyze cursor-pointer border-border bg-background text-muted-foreground transition-colors hover:border-palpite-border hover:bg-palpite-soft hover:text-palpite-strong-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
    >
      {retry ? (
        <RotateCcw aria-hidden="true" className="size-3" />
      ) : (
        <Sparkles aria-hidden="true" className="size-3 text-palpite-strong-fg" />
      )}
      {retry ? "tentar de novo" : "analisar"}
    </button>
  );
}

/**
 * A linha de baixo durante e depois do run: a etapa de agora ("Lendo os preços do
 * mercado") ou o erro. Região viva, pra o leitor de tela ouvir o andamento.
 */
export function RowAnalyzeStatus({
  state,
  className,
}: {
  state: RowAnalysis;
  className?: string;
}) {
  const text =
    state.kind === "running"
      ? (state.step ?? "Começando a análise")
      : state.kind === "error"
        ? state.message
        : null;
  return (
    <p
      role="status"
      className={cn(
        "text-meta tracking-tight empty:hidden",
        state.kind === "running" && "truncate",
        state.kind === "error" ? "text-destructive" : "text-muted-foreground",
        className,
      )}
      title={text ?? undefined}
    >
      {text}
    </p>
  );
}
