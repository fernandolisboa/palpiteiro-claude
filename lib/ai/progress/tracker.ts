// Agrega as etapas do run antes de mandar pro cliente (ADR 0064). Puro, sem I/O.
//
// Uma mesma etapa roda várias vezes num run: no fan-out cada mercado lê os dados e as
// odds (do cache, depois do 1º), e no paralelo essas leituras se sobrepõem. O cliente
// vê UMA linha por etapa: "active" quando a 1ª instância começa e o fim quando a última
// em voo termina. O fim é o melhor desfecho da janela (done > skipped > failed): um
// mercado que falhou nas odds não pinta a etapa de falha se os outros leram. Depois de
// "done", uma releitura não reabre a linha; depois de falha ou pulo, uma nova tentativa
// reabre.
//
// Cada etapa junta também o que encontrou (`detail`, ADR 0065): linhas curtas que o
// "Ver raciocínio" mostra. As instâncias somam linhas (sem repetir), inclusive depois de
// "done": o mercado seguinte que leu preços acrescenta o nome dele à mesma linha.

import {
  MAX_DETAIL_LINES,
  type ProgressEvent,
  type ReasoningStep,
  type StepStatus,
} from "./protocol";

type Terminal = Exclude<StepStatus, "active">;

const RANK: Record<Terminal, number> = { failed: 0, skipped: 1, done: 2 };

type StepState = {
  running: number;
  shown: StepStatus | null;
  label: string;
  best: { status: Terminal; label: string } | null;
  detail: string[];
};

export type ProgressTracker = {
  start(id: string, label: string): void;
  end(id: string, status: Terminal, label: string): void;
  // Etapa instantânea (já aconteceu): vira uma linha terminal direto.
  note(id: string, status: Terminal, label: string): void;
  // Acrescenta o que a etapa encontrou. Numa etapa já terminada, reenvia a linha.
  detail(id: string, lines: readonly string[]): void;
  // As etapas terminadas, na ordem em que começaram (o raciocínio gravado com o palpite).
  // `assumeDone` conta como pronta a etapa que termina junto com a gravação.
  snapshot(assumeDone?: { id: string; label: string }): ReasoningStep[];
};

export function createProgressTracker(
  send: (event: ProgressEvent) => void,
): ProgressTracker {
  const steps = new Map<string, StepState>();
  const stateOf = (id: string): StepState => {
    let s = steps.get(id);
    if (!s) {
      s = { running: 0, shown: null, label: "", best: null, detail: [] };
      steps.set(id, s);
    }
    return s;
  };
  const emit = (id: string, s: StepState, status: StepStatus, label: string) => {
    s.shown = status;
    s.label = label;
    send({
      t: "step",
      id,
      status,
      label,
      ...(s.detail.length > 0 ? { detail: [...s.detail] } : {}),
    });
  };

  return {
    start(id, label) {
      const s = stateOf(id);
      s.running += 1;
      if (s.shown === "done") return;
      if (s.running === 1) {
        s.best = null;
        if (s.shown !== "active") emit(id, s, "active", label);
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
      if (s.running === 0) emit(id, s, s.best.status, s.best.label);
    },
    note(id, status, label) {
      const s = stateOf(id);
      if (s.shown === "done" || s.running > 0) return;
      emit(id, s, status, label);
    },
    detail(id, lines) {
      const s = stateOf(id);
      let added = false;
      for (const line of lines) {
        if (s.detail.length >= MAX_DETAIL_LINES) break;
        if (line === "" || s.detail.includes(line)) continue;
        s.detail.push(line);
        added = true;
      }
      if (added && s.shown !== null && s.shown !== "active") {
        emit(id, s, s.shown, s.label);
      }
    },
    snapshot(assumeDone) {
      const out: ReasoningStep[] = [];
      for (const [id, s] of steps) {
        const closing = assumeDone?.id === id && s.shown === "active";
        if (!closing && (s.shown === null || s.shown === "active")) continue;
        out.push({
          id,
          status: closing ? "done" : (s.shown as Terminal),
          label: closing ? assumeDone.label : s.label,
          ...(s.detail.length > 0 ? { detail: [...s.detail] } : {}),
        });
      }
      return out;
    },
  };
}
