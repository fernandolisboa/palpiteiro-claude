"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Loader2, RotateCcw, Sparkles } from "lucide-react";

import { AnalyzedBadge } from "@/components/match-list/analyzed-badge";
import {
  consumeRun,
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

// O fim de cada run relê a lista uma vez só, mesmo com as duas árvores (celular e
// desktop) montadas e olhando o mesmo jogo.
const refreshed = new WeakSet<RunEntry>();

// Estado da linha fora do store de runs, compartilhado pelas duas árvores: "analisado"
// depois de a lista entregar o run (o refresh ainda não trouxe o `hasPrediction`) e o
// run pela reserva da server action, que não passa pelo store.
const rowStates = new Map<string, RowAnalysis>();
const rowListeners = new Map<string, Set<() => void>>();

function setRowState(matchId: string, state: RowAnalysis | null) {
  if (state) rowStates.set(matchId, state);
  else rowStates.delete(matchId);
  for (const l of rowListeners.get(matchId) ?? []) l();
}

function subscribeRowState(matchId: string, listener: () => void): () => void {
  let set = rowListeners.get(matchId);
  if (!set) {
    set = new Set();
    rowListeners.set(matchId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) rowListeners.delete(matchId);
  };
}

// Testes: cada caso começa sem estado de linha de outro.
export function resetRowStatesForTests(): void {
  rowStates.clear();
  rowListeners.clear();
}

function currentStep(entry: RunEntry): string | null {
  for (let i = entry.steps.length - 1; i >= 0; i--) {
    if (entry.steps[i].status === "active") return entry.steps[i].label;
  }
  return null;
}

// Só um run de pré-jogo completo é "da linha". Um "só o palpite" ou um run ao vivo que
// terminou com a lista aberta fica pro HERO entregar na página do jogo.
function isRowRun(entry: RunEntry): boolean {
  return entry.intent === "analysis" && !entry.live;
}

const FALLBACK_ERROR = "Falha temporária ao gerar análise. Tente novamente.";

/**
 * Estado do run deste jogo pra linha da lista. O run vive no store por jogo (o mesmo do
 * HERO); a lista entrega o run que terminou bem (relê a lista e tira do store, pra o
 * HERO não reabrir as etapas de um run já visto) e deixa as falhas no store, que o HERO
 * também mostra. `canAnalyze` falso esconde a falha: sem botão, sem "tentar de novo".
 */
export function useRowAnalysis(
  matchId: string,
  canAnalyze: boolean,
): {
  state: RowAnalysis;
  start: () => void;
} {
  const router = useOptionalRouter();
  const subscribe = useCallback(
    (listener: () => void) => subscribeRun(matchId, listener),
    [matchId],
  );
  const entry = useSyncExternalStore(subscribe, () => getRun(matchId), () => null);
  const subscribeRow = useCallback(
    (listener: () => void) => subscribeRowState(matchId, listener),
    [matchId],
  );
  const rowState = useSyncExternalStore(
    subscribeRow,
    () => rowStates.get(matchId) ?? null,
    () => null,
  );

  const finished = entry?.status === "finished" ? entry : null;
  useEffect(() => {
    if (!finished || refreshed.has(finished)) return;
    refreshed.add(finished);
    // O jogo guardado no cache do roteador também fica velho (#639).
    markRouterCacheStale();
    if (!isRowRun(finished)) return;
    if (finished.outcome && !finished.outcome.ok) return;
    // Terminou bem (ou sem desfecho conhecido): a lista relida decide pelo
    // `hasPrediction`; "analisado" só quando o run disse que deu certo.
    if (finished.outcome?.ok) setRowState(matchId, { kind: "done" });
    consumeRun(matchId);
    if (finished.refresh) router?.refresh();
  }, [finished, matchId, router]);

  const start = useCallback(() => {
    const formData = new FormData();
    formData.set("matchId", matchId);
    formData.set("intent", "analysis");
    formData.set("pageLive", "0");
    setRowState(matchId, null);
    void startRun(matchId, formData, {
      intent: "analysis",
      live: false,
      baseSetId: null,
    }).then(async (mode) => {
      if (mode !== "fallback") return;
      setRowState(matchId, { kind: "running", step: null });
      // Import sob demanda: a reserva quase nunca roda, e a lista (e os testes que a
      // renderizam soltos) não carrega o módulo das actions à toa.
      const result = await import("@/app/actions/predictions")
        .then(({ runPalpiteHero }) => runPalpiteHero(null, formData))
        .catch(() => null);
      const outcome: HeroRunOutcome = result
        ? toHeroRunOutcome(result)
        : { ok: false, error: FALLBACK_ERROR };
      // A action já revalida /jogos; o cache do roteador guarda o jogo velho.
      markRouterCacheStale();
      setRowState(
        matchId,
        outcome.ok ? { kind: "done" } : { kind: "error", message: outcome.error },
      );
    });
  }, [matchId]);

  const state = ((): RowAnalysis => {
    if (entry?.status === "running") return { kind: "running", step: currentStep(entry) };
    if (rowState) return rowState;
    if (finished && isRowRun(finished) && finished.outcome && !finished.outcome.ok) {
      return { kind: "error", message: finished.outcome.error };
    }
    return { kind: "idle" };
  })();
  if (state.kind === "error" && !canAnalyze) return { state: { kind: "idle" }, start };
  return { state, start };
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
  if (!canAnalyze) return null;
  const retry = state.kind === "error";
  return (
    <button
      type="button"
      onClick={onStart}
      title={ROW_ANALYZE_TITLE}
      aria-label={retry ? "Tentar a análise com IA de novo" : "Analisar com IA"}
      className={cn(
        CHIP,
        // Some na linha destacada pelo passo "abra um jogo" do tour (guided-tour.tsx).
        "[[data-tour-interactive]_[data-tour=match-row]_&]:hidden",
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
        // Acima do link esticado da linha: o `title` da etapa cortada aparece.
        "relative z-10 text-meta tracking-tight empty:hidden",
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
