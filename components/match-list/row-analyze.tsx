"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Loader2, RefreshCw, RotateCcw, Sparkles } from "lucide-react";

import {
  consumeRun,
  getRun,
  startRun,
  subscribeRun,
  type RunEntry,
} from "@/components/palpites/palpite-run-store";
import type { ProgressStepView } from "@/components/palpites/palpite-progress";
import {
  toHeroRunOutcome,
  type HeroRunOutcome,
} from "@/lib/ai/progress/protocol";
import { markRouterCacheStale } from "@/lib/nav/router-cache";
import { useOptionalRouter } from "@/lib/nav/use-optional-router";
import { cn } from "@/lib/utils";

// "Analisar com IA" direto da lista de jogos. Dispara o MESMO run da página do jogo
// (rota de streaming → runPalpiteHero, com os mesmos gates e a mesma cobrança) e guarda
// o run no mesmo store por jogo (palpite-run-store): abrir o jogo no meio mostra as
// etapas de agora, e o HERO entrega o desfecho lá também.

export const ROW_ANALYZE_TITLE =
  "Analisar com IA: usa análises do seu limite do dia e leva alguns minutos.";
export const ROW_REANALYZE_TITLE =
  "Analisar de novo com IA: usa análises do seu limite do dia e leva alguns minutos.";

export type RowAnalysis =
  | { kind: "idle" }
  | { kind: "running"; step: string | null; steps: ProgressStepView[] }
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
      setRowState(matchId, { kind: "running", step: null, steps: [] });
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
    if (entry?.status === "running") {
      return { kind: "running", step: currentStep(entry), steps: entry.steps };
    }
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

export const ROW_FOCUS =
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

// Some na linha destacada pelo passo "abra um jogo" do tour (guided-tour.tsx).
export const ROW_TOUR_HIDDEN =
  "[[data-tour-interactive]_[data-tour=match-row]_&]:hidden";

/** "analisado": já analisado, ou o run da linha acabou de dar certo. */
export function showsAnalyzed(
  state: RowAnalysis,
  hasPrediction: boolean
): boolean {
  return hasPrediction || state.kind === "done";
}

const ANALYZE_LABEL = "Analisar com IA";
export const REANALYZE_LABEL = "Analisar com IA de novo";
const RETRY_LABEL = "Tentar a análise com IA de novo";
export const PROGRESS_LABEL = "Ver o progresso da análise";

/**
 * A ação da linha: "analisar", "reanalisar" quando o jogo já tem análise, "analisando"
 * durante o run e "tentar de novo" se falhou. Em repouso todas são cinza quietas (a
 * lista tem muitas); o que muda é o ícone: a faísca quente pra analisar, o ↻ cinza pra
 * reanalisar. No hover/foco, quente (analisar) ou azul do "analisado" (reanalisar).
 * `relative z-10`: fica acima do link esticado da linha.
 *
 * look: chip (pílula com a palavra), icon (só o ícone, no lugar da setinha), block
 * (largura toda do pai, embaixo das odds).
 */
export function RowAnalyzeChip({
  state,
  onStart,
  onShowProgress,
  hasPrediction,
  canAnalyze,
  look = "chip",
  className,
}: {
  state: RowAnalysis;
  onStart: () => void;
  // Durante o run, tocar em "analisando" abre as etapas (celular). Ausente = só o selo.
  onShowProgress?: () => void;
  hasPrediction: boolean;
  canAnalyze: boolean;
  look?: "chip" | "icon" | "block";
  className?: string;
}) {
  const icon = look === "icon";
  const shape = icon
    ? "relative z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-md border"
    : look === "block"
      ? "relative z-10 inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-md border px-2.5 text-meta font-medium whitespace-nowrap"
      : CHIP;
  const glyph = icon ? "size-3.5" : "size-3";
  if (state.kind === "running") {
    const running = cn(
      shape,
      "border-palpite-border bg-palpite-soft text-palpite-strong-fg",
      className
    );
    const body = (
      <>
        <Loader2
          aria-hidden="true"
          className={cn("palpite-spin animate-spin", glyph)}
        />
        {!icon && "analisando"}
      </>
    );
    if (onShowProgress) {
      return (
        <button
          type="button"
          onClick={onShowProgress}
          aria-label={PROGRESS_LABEL}
          title={PROGRESS_LABEL}
          className={cn(running, "cursor-pointer", ROW_FOCUS)}
        >
          {body}
        </button>
      );
    }
    return (
      <span
        role={icon ? "img" : undefined}
        aria-label={icon ? "analisando" : undefined}
        title={icon ? "Analisando" : undefined}
        className={running}
      >
        {body}
      </span>
    );
  }
  if (!canAnalyze) return null;
  const retry = state.kind === "error";
  const again = !retry && showsAnalyzed(state, hasPrediction);
  const label = retry ? RETRY_LABEL : again ? REANALYZE_LABEL : ANALYZE_LABEL;
  return (
    <button
      type="button"
      onClick={onStart}
      title={again ? ROW_REANALYZE_TITLE : ROW_ANALYZE_TITLE}
      aria-label={label}
      className={cn(
        shape,
        ROW_TOUR_HIDDEN,
        "border-border bg-background text-muted-foreground cursor-pointer transition-colors",
        ROW_FOCUS,
        again
          ? "hover:border-accent-border hover:bg-accent-soft hover:text-accent-fg"
          : "hover:border-palpite-border hover:bg-palpite-soft hover:text-palpite-strong-fg",
        className
      )}
    >
      {retry ? (
        <RotateCcw aria-hidden="true" className={glyph} />
      ) : again ? (
        <RefreshCw aria-hidden="true" className={glyph} />
      ) : (
        <Sparkles
          aria-hidden="true"
          className={cn("text-palpite-strong-fg", icon ? "size-4" : "size-3")}
        />
      )}
      {!icon && (retry ? "tentar de novo" : again ? "reanalisar" : "analisar")}
    </button>
  );
}

/**
 * A linha de baixo durante e depois do run (celular): a etapa de agora ("Lendo os
 * preços do mercado") ou o erro. Região viva, pra o leitor de tela ouvir o andamento.
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
