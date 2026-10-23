"use client";

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

import {
  consumeRun,
  getRun,
  isRunConsumed,
  resumeRun,
  startRun,
  subscribeRun,
  type RunMeta,
  type RunStep,
} from "@/components/palpites/palpite-run-store";
import type {
  HeroRunOutcome,
  RunIntent,
  RunSnapshot,
} from "@/lib/ai/progress/protocol";

export { PALPITE_RUN_ENDPOINT, type RunStep } from "@/components/palpites/palpite-run-store";

export type PalpiteRun = {
  steps: RunStep[];
  // Run em voo OU o refresh da página com o resultado ainda chegando.
  running: boolean;
  // Do run em voo (ou do último entregue): a copy do progresso e o aviso de manchete.
  intent: RunIntent | null;
  baseSetId: string | null;
  outcome: HeroRunOutcome | null;
  // "fallback" = a rota não atendeu; quem chamou usa a server action.
  start(formData: FormData, meta: RunMeta): Promise<"streamed" | "fallback">;
};

const noSubscribe = () => () => {};

/**
 * Run do HERO com progresso ao vivo (ADR 0064), por jogo. O run mora no store
 * (palpite-run-store), não no componente: sair do jogo não para a leitura, e voltar
 * mostra as etapas de agora ou entrega o desfecho. `activeRun` é o run em voo que a
 * página leu do servidor (sem registro no navegador: F5, outra aba). No fim, o refresh
 * traz o palpite novo pelas props do servidor; `running` só cai quando ele chega, pra
 * o HERO não piscar o estado antigo.
 */
export function usePalpiteRun(
  matchId: string,
  activeRun: RunSnapshot | null,
  setId: string | null,
): PalpiteRun {
  const router = useRouter();
  const subscribe = useCallback(
    (listener: () => void) => subscribeRun(matchId, listener),
    [matchId],
  );
  const entry = useSyncExternalStore(
    subscribe,
    () => getRun(matchId),
    () => null,
  );
  // Montou sem nada assinado ainda (SSR, 1º render): o run do servidor já vale pro
  // desenho, sem piscar o palpite antigo até o efeito abaixo assumir.
  const consumedAlready = useSyncExternalStore(
    noSubscribe,
    () => (activeRun ? isRunConsumed(activeRun.runId) : false),
    () => false,
  );
  const pendingResume = !entry && activeRun !== null && !consumedAlready;

  // Desfecho entregue: fica até o próximo run (os avisos e o "Ver raciocínio").
  const [delivered, setDelivered] = useState<{
    steps: RunStep[];
    intent: RunIntent;
    baseSetId: string | null;
    outcome: HeroRunOutcome | null;
  } | null>(null);
  const [refreshing, startRefresh] = useTransition();

  useEffect(() => {
    if (pendingResume) resumeRun(matchId, activeRun, setId);
  }, [pendingResume, matchId, activeRun, setId]);

  const finished = entry?.status === "finished";
  useEffect(() => {
    if (!finished) return;
    const done = consumeRun(matchId);
    if (!done) return;
    setDelivered({
      steps: done.steps,
      intent: done.intent,
      baseSetId: done.baseSetId,
      outcome: done.outcome,
    });
    if (done.refresh) startRefresh(() => router.refresh());
  }, [finished, matchId, router]);

  const start = useCallback(
    (formData: FormData, meta: RunMeta) => {
      setDelivered(null);
      return startRun(matchId, formData, meta);
    },
    [matchId],
  );

  if (entry) {
    return {
      steps: entry.steps,
      running: true,
      intent: entry.intent,
      baseSetId: entry.baseSetId,
      outcome: null,
      start,
    };
  }
  if (pendingResume) {
    return {
      steps: activeRun.steps,
      running: true,
      intent: activeRun.intent,
      baseSetId: setId,
      outcome: null,
      start,
    };
  }
  return {
    steps: delivered?.steps ?? [],
    running: refreshing,
    intent: delivered?.intent ?? null,
    baseSetId: delivered?.baseSetId ?? null,
    outcome: delivered?.outcome ?? null,
    start,
  };
}
