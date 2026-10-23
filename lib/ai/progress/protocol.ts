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
};

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
  if (msg.t === "step") {
    if (
      typeof msg.id !== "string" ||
      typeof msg.label !== "string" ||
      !STATUSES.includes(msg.status as StepStatus)
    ) {
      return null;
    }
    return {
      t: "step",
      id: msg.id,
      status: msg.status as StepStatus,
      label: msg.label,
    };
  }
  if (msg.t === "result") {
    const outcome = toOutcome(msg.outcome);
    return outcome ? { t: "result", outcome } : null;
  }
  return null;
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
