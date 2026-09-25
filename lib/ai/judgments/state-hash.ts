import { createHash } from "node:crypto";

import type { JudgmentState } from "./types";

// JSON canônico: chaves de objeto em ordem lexicográfica, recursivo. Mesma
// estrutura → mesma string, independente da ordem de inserção das chaves.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// sha256 do JSON canônico de qualquer valor JSON-serializável.
export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

// Hash estável do `state` enviado ao JEV (sha256 do JSON canônico). Identifica
// "a mesma pergunta sobre o mesmo jogo": o predict reusa as respostas de uma
// predição recente com o mesmo hash em vez de chamar o JEV de novo (ADR 0041 §1).
export function judgmentStateHash(state: JudgmentState): string {
  return canonicalHash(state);
}
