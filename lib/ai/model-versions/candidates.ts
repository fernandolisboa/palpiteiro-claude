import { MAX_TOKENS_MAX } from "@/lib/ai/generation-params";
import {
  parseClaudeVersion,
  type ClaudeVersion,
  type ModelFamily,
} from "@/lib/ai/models";
import type { ApiModelInfo } from "@/lib/ai/providers/anthropic/models-catalog";

import type { CallOutcomeCounts } from "./types";

// Escolha PURA do candidato de cada família e checagem das capabilities (ADR 0062,
// PLAN-608 §5 + B1/S3/S4). Sem I/O: o cron (check.ts) chama com a listagem da API e
// as rows de model_versions.

function compareVersion(
  a: Pick<ClaudeVersion, "major" | "minor">,
  b: Pick<ClaudeVersion, "major" | "minor">,
): number {
  return a.major !== b.major ? a.major - b.major : a.minor - b.minor;
}

function createdAtMs(m: ApiModelInfo): number {
  const t = Date.parse(m.createdAt);
  return Number.isFinite(t) ? t : -Infinity;
}

/**
 * O candidato da família, ou null:
 *  - só ids no formato estrito (`parseClaudeVersion`: `-preview`, formato antigo e
 *    outras famílias ficam de fora); um major novo (Sonnet 6) entra;
 *  - (major, minor) maior que a conferida E que a versão ativa;
 *  - S3: descarta a versão (família, major, minor) que já tem row em model_versions,
 *    em qualquer status (uma reprovada não é sondada de novo pelo snapshot datado);
 *  - entre os restantes, a maior versão; empate → o alias (sem data) antes do
 *    snapshot; ainda empatado → o `created_at` mais recente.
 */
export function pickCandidate(args: {
  family: ModelFamily;
  apiModels: readonly ApiModelInfo[];
  pinnedId: string;
  activeId: string | null;
  knownIds: readonly string[];
}): ApiModelInfo | null {
  const pinned = parseClaudeVersion(args.pinnedId);
  if (pinned === null) return null;
  const active = args.activeId ? parseClaudeVersion(args.activeId) : null;
  const known = args.knownIds
    .map(parseClaudeVersion)
    .filter((v): v is ClaudeVersion => v !== null && v.family === args.family);

  let best: { model: ApiModelInfo; version: ClaudeVersion } | null = null;
  for (const model of args.apiModels) {
    const version = parseClaudeVersion(model.id);
    if (version === null || version.family !== args.family) continue;
    if (compareVersion(version, pinned) <= 0) continue;
    if (active && compareVersion(version, active) <= 0) continue;
    if (known.some((k) => compareVersion(k, version) === 0)) continue;
    if (best === null || isBetter({ model, version }, best)) {
      best = { model, version };
    }
  }
  return best?.model ?? null;
}

function isBetter(
  a: { model: ApiModelInfo; version: ClaudeVersion },
  b: { model: ApiModelInfo; version: ClaudeVersion },
): boolean {
  const byVersion = compareVersion(a.version, b.version);
  if (byVersion !== 0) return byVersion > 0;
  const aAlias = a.version.snapshot === null;
  const bAlias = b.version.snapshot === null;
  if (aAlias !== bAlias) return aAlias;
  return createdAtMs(a.model) > createdAtMs(b.model);
}

export type CapabilityVerdict =
  | { ok: true }
  // `transient`: a API não informou (tenta de novo amanhã). Senão, reprovação.
  | { ok: false; transient: boolean; reason: string };

/**
 * O app manda `thinking: adaptive`, `output_config.effort` de low a max (inclusive
 * xhigh, que o admin pode escolher) e `max_tokens` até MAX_TOKENS_MAX. Uma versão que
 * não suporte isso daria 400 em produção: reprova antes de sondar (fail-closed, S4).
 * `capabilities` null é transitório, não reprovação.
 */
export function checkCapabilities(model: ApiModelInfo): CapabilityVerdict {
  const caps = model.capabilities;
  if (caps === null || caps === undefined) {
    return {
      ok: false,
      transient: true,
      reason: "a API não informou as capabilities",
    };
  }
  const fail = (reason: string): CapabilityVerdict => ({
    ok: false,
    transient: false,
    reason,
  });
  if (caps.thinking?.types?.adaptive?.supported !== true) {
    return fail("sem thinking adaptive");
  }
  const effort = caps.effort;
  if (effort?.supported !== true) return fail("sem effort");
  for (const level of ["low", "medium", "high", "max"] as const) {
    if (effort[level]?.supported !== true) return fail(`sem effort ${level}`);
  }
  if (effort.xhigh?.supported !== true) return fail("sem effort xhigh");
  if (model.maxTokens === null || model.maxTokens < MAX_TOKENS_MAX) {
    return fail(
      `max_tokens ${model.maxTokens ?? "não informado"} abaixo de ${MAX_TOKENS_MAX}`,
    );
  }
  return { ok: true };
}

/**
 * As conferidas que sumiram da listagem (S8): o id exato ou um snapshot datado dele
 * contam como presentes.
 */
export function missingPinnedIds(
  pinnedIds: readonly string[],
  apiModels: readonly ApiModelInfo[],
): string[] {
  return pinnedIds.filter(
    (pinned) =>
      !apiModels.some(
        (m) =>
          m.id === pinned ||
          (m.id.startsWith(`${pinned}-`) && /^\d{8}$/.test(m.id.slice(pinned.length + 1))),
      ),
  );
}

export const REGRESSION_MIN_CALLS = 10;
export const REGRESSION_MIN_DELTA = 0.15;

/**
 * Regressão em produção (S2): a taxa de chamadas ruins da versão adotada desde a
 * adoção, contra a da conferida nos 7 dias anteriores. Com pelo menos 10 chamadas
 * da adotada, regride quando a taxa é ≥ 2× a da conferida E ≥ ela + 15pp.
 */
export function isRegression(
  adopted: CallOutcomeCounts,
  baseline: CallOutcomeCounts,
): boolean {
  if (adopted.total < REGRESSION_MIN_CALLS) return false;
  const rate = adopted.bad / adopted.total;
  const base = baseline.total > 0 ? baseline.bad / baseline.total : 0;
  return rate >= Math.max(2 * base, base + REGRESSION_MIN_DELTA);
}
