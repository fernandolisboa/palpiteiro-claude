// Protocolo do progresso do "Analisar com IA" / "Gerar só o palpite" (ADR 0064): uma
// linha JSON por mensagem (NDJSON), do servidor pro HERO. Módulo PURO, importado pelos
// dois lados (sem node:*, sem DB).

import type { PalpiteHeroResult } from "@/app/actions/predictions";

export type StepStatus = "active" | "done" | "failed" | "skipped";

// Uma etapa que DE FATO rodou no servidor. `label` é a frase pronta pro estado atual
// (o servidor escreve a copy; o cliente só desenha). Nunca carrega odd, edge, stake ou
// nome de casa (ADR 0030 §3, no-bookmaker).
export type ProgressEvent = {
  t: "step";
  id: string;
  status: StepStatus;
  label: string;
  // O que a etapa encontrou (ADR 0065), em frases curtas montadas pelo código: o "Ver
  // raciocínio" mostra. Mesmas regras da `label`.
  detail?: string[];
};

// Uma etapa terminada, como fica gravada com o palpite (headline.reasoning) e como o
// "Ver raciocínio" desenha.
export type ReasoningStep = {
  id: string;
  status: Exclude<StepStatus, "active">;
  label: string;
  detail?: string[];
};

export const MAX_DETAIL_LINES = 12;
const MAX_TEXT_CHARS = 240;
const MAX_REASONING_STEPS = 40;

// O que o HERO precisa do fim do run. O palpite em si chega pelas props do servidor
// depois do refresh; aqui só os avisos.
export type HeroRunOutcome =
  | {
      ok: true;
      // true = run completo (limpa o "Contexto extra"); false = só o palpite.
      analysis: boolean;
      palpiteError?: string;
      contextNotice?: string;
    }
  | { ok: false; error: string };

export type StreamMessage =
  | ProgressEvent
  // Primeira linha: o id do run, o mesmo do marcador que a página relê (RunSnapshot).
  | { t: "run"; id: string }
  | { t: "result"; outcome: HeroRunOutcome }
  // Batida pra conexão não parecer ociosa durante uma chamada longa de LLM.
  | { t: "ping" };

export function encodeStreamMessage(msg: StreamMessage): string {
  return `${JSON.stringify(msg)}\n`;
}

const STATUSES: readonly StepStatus[] = ["active", "done", "failed", "skipped"];

// Lê uma linha do stream; linha que não é do protocolo vira null (ignorada).
export function parseStreamLine(line: string): StreamMessage | null {
  if (line.trim() === "") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const msg = raw as Record<string, unknown>;
  if (msg.t === "ping") return { t: "ping" };
  if (msg.t === "run") {
    return typeof msg.id === "string" && msg.id !== "" ? { t: "run", id: msg.id } : null;
  }
  if (msg.t === "step") {
    const step = toStep(msg);
    return step ? { t: "step", ...step } : null;
  }
  if (msg.t === "result") {
    const outcome = toOutcome(msg.outcome);
    return outcome ? { t: "result", outcome } : null;
  }
  return null;
}

// Run em voo de um jogo, guardado fora da conexão (KV, por pessoa e jogo): quem sai da
// página e volta (outra navegação, F5, outra aba) acompanha o mesmo run, que segue no
// servidor. `done` fica pouco tempo, só pra quem acompanha ver o desfecho.
export type RunIntent = "analysis" | "palpite";

export type RunStepSnapshot = Omit<ProgressEvent, "t">;

export type RunSnapshot = {
  runId: string;
  intent: RunIntent;
  live: boolean;
  status: "running" | "done";
  steps: RunStepSnapshot[];
  outcome: HeroRunOutcome | null;
};

export function parseRunSnapshot(raw: unknown): RunSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.runId !== "string" ||
    r.runId === "" ||
    (r.intent !== "analysis" && r.intent !== "palpite") ||
    (r.status !== "running" && r.status !== "done") ||
    !Array.isArray(r.steps)
  ) {
    return null;
  }
  const steps = r.steps
    .slice(0, MAX_REASONING_STEPS)
    .map((item) =>
      typeof item === "object" && item !== null
        ? toStep(item as Record<string, unknown>)
        : null,
    )
    .filter((step): step is RunStepSnapshot => step !== null);
  return {
    runId: r.runId,
    intent: r.intent,
    live: r.live === true,
    status: r.status,
    steps,
    outcome: toOutcome(r.outcome),
  };
}

function toStep(raw: Record<string, unknown>): RunStepSnapshot | null {
  if (
    typeof raw.id !== "string" ||
    typeof raw.label !== "string" ||
    !STATUSES.includes(raw.status as StepStatus)
  ) {
    return null;
  }
  const detail = toDetail(raw.detail);
  return {
    id: raw.id,
    status: raw.status as StepStatus,
    label: raw.label,
    ...(detail ? { detail } : {}),
  };
}

function toDetail(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const lines = raw
    .filter((l): l is string => typeof l === "string" && l !== "")
    .slice(0, MAX_DETAIL_LINES)
    .map((l) => l.slice(0, MAX_TEXT_CHARS));
  return lines.length > 0 ? lines : null;
}

const TERMINAL: readonly ReasoningStep["status"][] = ["done", "failed", "skipped"];

// Lê o raciocínio gravado (jsonb, sem schema no banco): o que não tiver a forma cai
// fora, e um raciocínio vazio vira null (sem botão).
export function parseReasoning(raw: unknown): ReasoningStep[] | null {
  if (!Array.isArray(raw)) return null;
  const steps: ReasoningStep[] = [];
  for (const item of raw.slice(0, MAX_REASONING_STEPS)) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (
      typeof r.id !== "string" ||
      typeof r.label !== "string" ||
      r.label === "" ||
      !TERMINAL.includes(r.status as ReasoningStep["status"])
    ) {
      continue;
    }
    const detail = toDetail(r.detail);
    steps.push({
      id: r.id,
      status: r.status as ReasoningStep["status"],
      label: r.label.slice(0, MAX_TEXT_CHARS),
      ...(detail ? { detail } : {}),
    });
  }
  return steps.length > 0 ? steps : null;
}

function toOutcome(raw: unknown): HeroRunOutcome | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.ok === false && typeof o.error === "string") {
    return { ok: false, error: o.error };
  }
  if (o.ok !== true || typeof o.analysis !== "boolean") return null;
  return {
    ok: true,
    analysis: o.analysis,
    ...(typeof o.palpiteError === "string" ? { palpiteError: o.palpiteError } : {}),
    ...(typeof o.contextNotice === "string" ? { contextNotice: o.contextNotice } : {}),
  };
}

// Resultado da action → o que o HERO usa (a mesma forma pelos dois caminhos: stream ou
// a server action de reserva). A view do painel fica de fora: a página relê do banco.
export function toHeroRunOutcome(result: PalpiteHeroResult): HeroRunOutcome {
  if (!result.ok) return { ok: false, error: result.error };
  const contextNotice = "contextNotice" in result ? result.contextNotice : undefined;
  return {
    ok: true,
    analysis: "view" in result,
    ...(result.palpiteError === undefined ? {} : { palpiteError: result.palpiteError }),
    ...(contextNotice === undefined ? {} : { contextNotice }),
  };
}
