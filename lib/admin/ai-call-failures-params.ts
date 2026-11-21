import { z } from "zod";

import type { AiCallStatus } from "@/lib/ai/providers/types";

// Query string de /admin/ia/falhas (#669): `?dias=1|7|30&jogo=<uuid>`. Puro.

export const AI_CALL_FAILURES_PATH = "/admin/ia/falhas";

/** Janelas da tela, em dias. */
export const AI_CALL_FAILURE_WINDOWS = [1, 7, 30] as const;
export type AiCallFailureWindow = (typeof AI_CALL_FAILURE_WINDOWS)[number];
export const DEFAULT_FAILURE_WINDOW: AiCallFailureWindow = 7;

export type AiCallFailuresParams = {
  days: AiCallFailureWindow;
  matchId: string | null;
};

type RawParam = string | string[] | undefined;

function first(v: RawParam): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * `dias` fora da lista → 7. `jogo` só uuid válido: `matches.id` é uuid, e um texto
 * qualquer derrubaria a query no Postgres ("invalid input syntax for type uuid").
 */
export function parseAiCallFailuresParams(raw: {
  dias?: RawParam;
  jogo?: RawParam;
}): AiCallFailuresParams {
  const dias = Number(first(raw.dias));
  const days =
    AI_CALL_FAILURE_WINDOWS.find((w) => w === dias) ?? DEFAULT_FAILURE_WINDOW;
  const jogo = first(raw.jogo)?.trim();
  const matchId = jogo && z.uuid().safeParse(jogo).success ? jogo : null;
  return { days, matchId };
}

/** Link da tela com estes parâmetros; os defaults ficam fora da URL. */
export function failuresHref(params: AiCallFailuresParams): string {
  const qs = new URLSearchParams();
  if (params.days !== DEFAULT_FAILURE_WINDOW)
    qs.set("dias", String(params.days));
  if (params.matchId) qs.set("jogo", params.matchId);
  const s = qs.toString();
  return s ? `${AI_CALL_FAILURES_PATH}?${s}` : AI_CALL_FAILURES_PATH;
}

/** Rótulo PT de cada status de `ai_calls` (o enum cru vai no `title`). */
export const AI_CALL_STATUS_LABEL: Record<AiCallStatus, string> = {
  ok: "ok",
  invalid_output: "saída reprovada",
  tool_missing: "sem a ferramenta",
  provider_error: "erro do provedor",
  timeout: "tempo esgotado",
  rate_limited: "limite do provedor",
  fidelity_divergence: "divergência factual",
};

export const ERROR_PREVIEW_CHARS = 140;

/** Começo do erro pra linha da lista; o texto inteiro fica no corpo do <details>. */
export function errorPreview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= ERROR_PREVIEW_CHARS
    ? flat
    : `${flat.slice(0, ERROR_PREVIEW_CHARS - 1)}…`;
}
