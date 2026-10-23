// Agrega as etapas do run antes de mandar pro cliente (ADR 0064). Puro, sem I/O.
//
// Uma mesma etapa roda várias vezes num run: no fan-out cada mercado lê os dados e as
// odds (do cache, depois do 1º), e no paralelo essas leituras se sobrepõem. O cliente
// vê UMA linha por etapa: "active" quando a 1ª instância começa e o fim quando a última
// em voo termina. O fim é o melhor desfecho da janela (done > skipped > failed): um
// mercado que falhou nas odds não pinta a etapa de falha se os outros leram. Depois de
// "done", uma releitura não reabre a linha; depois de falha ou pulo, uma nova tentativa
// reabre.

import type { ProgressEvent, StepStatus } from "./protocol";

type Terminal = Exclude<StepStatus, "active">;

const RANK: Record<Terminal, number> = { failed: 0, skipped: 1, done: 2 };

type StepState = {
  running: number;
  shown: StepStatus | null;
  best: { status: Terminal; label: string } | null;
};

export type ProgressTracker = {
  start(id: string, label: string): void;
  end(id: string, status: Terminal, label: string): void;
  // Etapa instantânea (já aconteceu): vira uma linha terminal direto.
  note(id: string, status: Terminal, label: string): void;
};

export function createProgressTracker(
  send: (event: ProgressEvent) => void,
): ProgressTracker {
  const steps = new Map<string, StepState>();
  const stateOf = (id: string): StepState => {
    let s = steps.get(id);
    if (!s) {
      s = { running: 0, shown: null, best: null };
      steps.set(id, s);
    }
    return s;
  };
  const emit = (id: string, status: StepStatus, label: string) => {
    send({ t: "step", id, status, label });
  };

  return {
    start(id, label) {
      const s = stateOf(id);
      s.running += 1;
      if (s.shown === "done") return;
      if (s.running === 1) {
        s.best = null;
        if (s.shown !== "active") {
          s.shown = "active";
          emit(id, "active", label);
        }
      }
    },
    end(id, status, label) {
      const s = stateOf(id);
      if (s.running === 0) return;
      s.running -= 1;
      if (s.shown === "done") return;
      if (!s.best || RANK[status] > RANK[s.best.status]) {
        s.best = { status, label };
      }
      if (s.running === 0) {
        s.shown = s.best.status;
        emit(id, s.best.status, s.best.label);
      }
    },
    note(id, status, label) {
      const s = stateOf(id);
      if (s.shown === "done" || s.running > 0) return;
      s.shown = status;
      emit(id, status, label);
    },
  };
}
