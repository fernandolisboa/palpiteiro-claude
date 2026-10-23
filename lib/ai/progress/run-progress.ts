// Progresso do run em tempo real (ADR 0064). A rota de streaming abre um contexto com
// `withRunProgress`; o pipeline (fan-out, predict, JEV, narração, síntese) marca as
// etapas com `trackStep`/`beginStep` sem receber nada por parâmetro. Fora desse
// contexto (server action de reserva, cron, scripts, testes) tudo vira no-op.
//
// Nunca lança e nunca muda o resultado do que envolve: progresso é só aviso.

import { AsyncLocalStorage } from "node:async_hooks";

import type { ProgressEvent } from "./protocol";
import type { StepSpec } from "./steps";
import { createProgressTracker, type ProgressTracker } from "./tracker";

type Terminal = "done" | "failed" | "skipped";

type Run = {
  tracker: ProgressTracker;
  marketLabels: Map<string, string>;
};

type Store = {
  run: Run;
  // Etapas abertas pelo escopo atual (um mercado do fan-out): se ele lança, as que
  // ficaram abertas fecham como falha em vez de girar até o fim do run.
  scope: Set<OpenStep> | null;
};

type OpenStep = { spec: StepSpec; closed: boolean };

const storage = new AsyncLocalStorage<Store>();

export function withRunProgress<T>(
  send: (event: ProgressEvent) => void,
  fn: () => Promise<T>,
): Promise<T> {
  const safeSend = (event: ProgressEvent) => {
    try {
      send(event);
    } catch {
      // Cliente foi embora: o run segue.
    }
  };
  const run: Run = {
    tracker: createProgressTracker(safeSend),
    marketLabels: new Map(),
  };
  return storage.run({ run, scope: null }, fn);
}

// Rótulos dos mercados do run (do catálogo do servidor), pra as frases citarem o
// mercado pelo nome.
export function setProgressMarketLabels(
  markets: readonly { key: string; label: string }[],
): void {
  const store = storage.getStore();
  if (!store) return;
  for (const m of markets) store.run.marketLabels.set(m.key, m.label);
}

export function progressMarketLabel(marketKey: string): string | null {
  return storage.getStore()?.run.marketLabels.get(marketKey) ?? null;
}

export function isTrackingProgress(): boolean {
  return storage.getStore() !== undefined;
}

// Um trecho com começo e fim (o bloco de odds do predict, por exemplo). O handle fecha
// uma vez só; o que ficar aberto fecha com o escopo.
export type StepHandle = {
  done(label?: string): void;
  fail(label?: string): void;
  skip(label?: string): void;
};

const NOOP_HANDLE: StepHandle = { done() {}, fail() {}, skip() {} };

export function beginStep(spec: StepSpec): StepHandle {
  const store = storage.getStore();
  if (!store) return NOOP_HANDLE;
  const open: OpenStep = { spec, closed: false };
  store.scope?.add(open);
  store.run.tracker.start(spec.id, spec.active);
  const close = (status: Terminal, label: string) => {
    if (open.closed) return;
    open.closed = true;
    store.scope?.delete(open);
    store.run.tracker.end(spec.id, status, label);
  };
  return {
    done: (label) => close("done", label ?? spec.done),
    fail: (label) => close("failed", label ?? spec.failed),
    skip: (label) => close("skipped", label ?? spec.skipped ?? spec.failed),
  };
}

// Desfecho que depende do valor devolvido (JEV reaproveitado, modelo de reserva…).
export type StepVerdict = { status: Terminal; label?: string } | void;

export async function trackStep<T>(
  spec: StepSpec,
  fn: () => Promise<T>,
  verdict?: (value: T) => StepVerdict,
): Promise<T> {
  const step = beginStep(spec);
  let value: T;
  try {
    value = await fn();
  } catch (err) {
    step.fail();
    throw err;
  }
  let outcome: StepVerdict;
  try {
    outcome = verdict?.(value);
  } catch {
    outcome = undefined;
  }
  if (!outcome || outcome.status === "done") step.done(outcome?.label);
  else if (outcome.status === "failed") step.fail(outcome.label);
  else step.skip(outcome.label);
  return value;
}

// Etapa que já aconteceu (sem espera a mostrar).
export function noteStep(
  spec: StepSpec,
  status: Terminal = "done",
  label?: string,
): void {
  const store = storage.getStore();
  if (!store) return;
  const text =
    label ??
    (status === "done"
      ? spec.done
      : status === "failed"
        ? spec.failed
        : (spec.skipped ?? spec.failed));
  store.run.tracker.note(spec.id, status, text);
}

// Escopo de um mercado: as etapas que ele abriu e não fechou viram falha se ele lança.
export async function progressScope<T>(fn: () => Promise<T>): Promise<T> {
  const store = storage.getStore();
  if (!store) return fn();
  const scope = new Set<OpenStep>();
  const closeOpen = (status: "done" | "failed") => {
    for (const open of [...scope]) {
      if (open.closed) continue;
      open.closed = true;
      store.run.tracker.end(
        open.spec.id,
        status,
        status === "done" ? open.spec.done : open.spec.failed,
      );
    }
  };
  try {
    const value = await storage.run({ run: store.run, scope }, fn);
    closeOpen("done");
    return value;
  } catch (err) {
    closeOpen("failed");
    throw err;
  }
}
