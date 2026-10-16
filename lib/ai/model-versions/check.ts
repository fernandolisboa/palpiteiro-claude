import {
  MODEL_REGISTRY,
  parseClaudeVersion,
  pinnedModelFor,
  type ModelFamily,
} from "@/lib/ai/models";
import { hasKey } from "@/lib/ai/providers/anthropic/client";
import {
  listApiModels,
  type ApiModelInfo,
} from "@/lib/ai/providers/anthropic/models-catalog";
import { getEnableAutoModelVersions } from "@/lib/db/queries/ai-config";
import {
  adoptModelVersion,
  countCallOutcomes,
  getModelVersionsCheck,
  listModelVersions,
  listVersionsFailedBetween,
  markModelVersionFailed,
  recordFailedVersion,
  REJECTED_BY_ADMIN_REASON,
  setModelVersionsCheck,
  type ModelVersionInput,
  type ModelVersionRow,
} from "@/lib/db/queries/model-versions";
import {
  sendModelVersionsAlert,
  type ModelVersionsAlertEvents,
} from "@/lib/notifications/model-versions-alert";

import { adoptedModel, pricingOf, resetActiveModelMemo } from "./active";
import {
  checkCapabilities,
  isRegression,
  missingPinnedIds,
  pickCandidate,
} from "./candidates";
import { probeModelVersion } from "./probe";
import {
  MODEL_FAMILIES,
  type ModelVersionsCheckSummary,
} from "./types";

// Orquestrador do cron check-model-versions (ADR 0062, PLAN-608 §5 + §11). Uma vez por
// dia: lista os modelos da API, confere se as conferidas seguem lá (S8), rebaixa a
// versão adotada que regrediu em produção (S2), e pra cada família sonda o candidato
// novo e o adota se passar. Avisa por e-mail (S1) o que mudou, inclusive a versão que
// o wrapper do seam reprovou em produção desde a checagem anterior.

const DAY_MS = 24 * 60 * 60 * 1000;
// Prazo da checagem inteira (a rota tem maxDuration 300).
export const CHECK_BUDGET_MS = 240_000;
// N5: um candidato que só falha por erro transitório há 7 dias vira `failed`.
export const TRANSIENT_FAIL_AFTER_MS = 7 * DAY_MS;
// S2: a versão precisa de 24h de uso antes de ser julgada.
const REGRESSION_MIN_AGE_MS = DAY_MS;
const REGRESSION_BASELINE_MS = 7 * DAY_MS;

export type ModelVersionCheckResult =
  | { status: "skipped"; reason: "no_key" }
  | { status: ModelVersionsCheckSummary["status"]; summary: ModelVersionsCheckSummary };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function versionInput(
  candidate: ApiModelInfo,
  family: ModelFamily,
  probeAiCallId: string | null,
): ModelVersionInput {
  const created = Date.parse(candidate.createdAt);
  return {
    id: candidate.id,
    family,
    displayName: candidate.displayName,
    apiCreatedAt: Number.isFinite(created) ? new Date(created) : null,
    capabilities: candidate.capabilities,
    maxTokens: candidate.maxTokens,
    pricing: pricingOf(pinnedModelFor(family)),
    probeAiCallId,
  };
}

// S2: rebaixa as versões adotadas há mais de 24h que regrediram. Devolve as rebaixadas.
// A base é tudo que a FAMÍLIA serviu nos 7 dias antes da adoção (a conferida ou a
// adotada anterior, que já tem row): com uma adotada em uso, a conferida quase não
// roda, e contar só ela deixaria a base vazia.
async function demoteRegressions(
  rows: readonly ModelVersionRow[],
  now: Date,
): Promise<{ id: string; reason: string }[]> {
  const demoted: { id: string; reason: string }[] = [];
  for (const row of rows) {
    if (row.status !== "active" || row.adoptedAt === null) continue;
    if (now.getTime() - row.adoptedAt.getTime() < REGRESSION_MIN_AGE_MS) continue;
    const family = row.family as ModelFamily;
    const familyIds = new Set([
      pinnedModelFor(family).id,
      ...rows.filter((r) => r.family === family && r.id !== row.id).map((r) => r.id),
    ]);
    const adopted = await countCallOutcomes({
      models: [row.id],
      from: row.adoptedAt,
      to: now,
    });
    const baseline = await countCallOutcomes({
      models: [...familyIds],
      from: new Date(row.adoptedAt.getTime() - REGRESSION_BASELINE_MS),
      to: row.adoptedAt,
    });
    if (!isRegression(adopted, baseline)) continue;
    const pct = (n: number, d: number) => (d > 0 ? Math.round((100 * n) / d) : 0);
    const reason = `regressão: ${adopted.bad}/${adopted.total} chamadas ruins (${pct(adopted.bad, adopted.total)}%) contra ${baseline.bad}/${baseline.total} (${pct(baseline.bad, baseline.total)}%) da família nos 7 dias antes`;
    if (await markModelVersionFailed(row.id, reason, now)) {
      demoted.push({ id: row.id, reason });
    }
  }
  return demoted;
}

/**
 * Roda a checagem. Nunca lança por erro de uma família (vira `error` no resumo); a
 * listagem que falha devolve `listing_failed`. O e-mail que falha vira `emailError`.
 */
export async function runModelVersionCheck(
  now: Date = new Date(),
): Promise<ModelVersionCheckResult> {
  if (!hasKey()) return { status: "skipped", reason: "no_key" };
  const deadlineAt = Date.now() + CHECK_BUDGET_MS;

  const previousCheck = await getModelVersionsCheck().catch(() => null);
  const previous = previousCheck?.summary ?? null;
  const previousCheckedAt = previousCheck?.checkedAt ?? null;

  let apiModels: ApiModelInfo[];
  try {
    apiModels = await listApiModels();
  } catch (err) {
    const summary: ModelVersionsCheckSummary = {
      status: "listing_failed",
      adopted: [],
      failed: [],
      // Mantém a contagem de dias do N5: a listagem fora não zera nem avança nada.
      transient: previous?.transient ?? [],
      pinnedMissing: previous?.pinnedMissing ?? [],
      error: `listagem da API falhou: ${message(err)}`,
    };
    // As marcadas pelo wrapper desde a última checagem saem no e-mail mesmo assim:
    // o checkedAt avança, e a próxima não as veria.
    const events: ModelVersionsAlertEvents = { adopted: [], failed: [], pinnedMissing: [] };
    await addSeamFailures(events, previousCheckedAt, now).catch((e: unknown) => {
      summary.error = `${summary.error}; falhas do seam: ${message(e)}`.slice(0, 2000);
    });
    await sendAlert(events, summary);
    await setModelVersionsCheck(summary, now);
    return { status: summary.status, summary };
  }

  // S8: conferida fora da listagem. Avisa por e-mail só quando é novidade.
  const pinnedMissing = missingPinnedIds(Object.keys(MODEL_REGISTRY), apiModels);
  const newlyMissing = pinnedMissing.filter(
    (id) => !(previous?.pinnedMissing ?? []).includes(id),
  );

  const summary: ModelVersionsCheckSummary = {
    status: "ok",
    adopted: [],
    failed: [],
    transient: [],
    pinnedMissing,
  };
  const events: ModelVersionsAlertEvents = {
    adopted: [],
    failed: [],
    pinnedMissing: newlyMissing,
  };
  const errors: string[] = [];
  const evaluated = new Set<ModelFamily>();

  if (!(await getEnableAutoModelVersions())) {
    summary.status = "disabled";
  } else {
    let rows = await listModelVersions();
    try {
      const demoted = await demoteRegressions(rows, now);
      if (demoted.length > 0) {
        resetActiveModelMemo();
        summary.failed.push(...demoted);
        events.failed.push(...demoted);
        rows = await listModelVersions();
      }
    } catch (err) {
      errors.push(`regressão: ${message(err)}`);
    }

    for (const family of MODEL_FAMILIES) {
      if (Date.now() >= deadlineAt) {
        errors.push(`prazo esgotado antes de ${family}`);
        break;
      }
      try {
        await checkFamily({ family, apiModels, rows, now, deadlineAt, previous, summary, events });
        evaluated.add(family);
      } catch (err) {
        errors.push(`${family}: ${message(err)}`);
      }
    }
  }
  carryOverTransient(previous, evaluated, summary);

  try {
    await addSeamFailures(events, previousCheckedAt, now);
  } catch (err) {
    errors.push(`falhas do seam: ${message(err)}`);
  }

  if (errors.length > 0) summary.error = errors.join("; ").slice(0, 2000);

  await sendAlert(events, summary);
  await setModelVersionsCheck(summary, now);
  return { status: summary.status, summary };
}

async function sendAlert(
  events: ModelVersionsAlertEvents,
  summary: ModelVersionsCheckSummary,
): Promise<void> {
  try {
    await sendModelVersionsAlert(events);
  } catch (err) {
    summary.emailError = message(err).slice(0, 500);
    console.error(
      JSON.stringify({
        scope: "model_versions",
        error: "alert_email_failed",
        message: summary.emailError,
      }),
    );
  }
}

/**
 * ADR 0062 §9: a versão que o wrapper do seam marcou `failed` em produção (rejeição
 * com a conferida passando) entre a checagem anterior e esta entra no e-mail. Janela
 * (checkedAt anterior, now]: o que esta checagem marca tem updatedAt = now e já está
 * em `events`; o que for marcado depois de `now` fica pra próxima. A rejeição do admin
 * fica de fora (foi ele quem fez).
 */
async function addSeamFailures(
  events: ModelVersionsAlertEvents,
  previousCheckedAt: Date | null,
  now: Date,
): Promise<void> {
  if (previousCheckedAt === null) return;
  const reported = new Set(events.failed.map((f) => f.id));
  const rows = await listVersionsFailedBetween(previousCheckedAt, now);
  for (const row of rows) {
    if (reported.has(row.id) || row.failureReason === REJECTED_BY_ADMIN_REASON) continue;
    events.failed.push({ id: row.id, reason: row.failureReason ?? "reprovada" });
  }
}

// N5: a chave do transitório é a versão (família, major, minor), não o id: o alias e
// o snapshot datado da mesma versão contam os mesmos dias.
function sameVersion(a: string, b: string): boolean {
  const va = parseClaudeVersion(a);
  const vb = parseClaudeVersion(b);
  return (
    va !== null &&
    vb !== null &&
    va.family === vb.family &&
    va.major === vb.major &&
    va.minor === vb.minor
  );
}

/**
 * N5: o transitório da checagem anterior cuja família NÃO foi avaliada nesta (flag
 * desligada, prazo esgotado, erro no meio) segue no resumo com o `since` original,
 * senão a contagem de 7 dias recomeçaria pra sempre. Família avaliada já decidiu o
 * próprio transitório (manteve, adotou, reprovou ou o candidato mudou).
 */
function carryOverTransient(
  previous: ModelVersionsCheckSummary | null,
  evaluated: ReadonlySet<ModelFamily>,
  summary: ModelVersionsCheckSummary,
): void {
  for (const t of previous?.transient ?? []) {
    if (evaluated.has(t.family)) continue;
    if (summary.transient.some((s) => sameVersion(s.id, t.id))) continue;
    summary.transient.push(t);
  }
}

async function checkFamily(args: {
  family: ModelFamily;
  apiModels: ApiModelInfo[];
  rows: ModelVersionRow[];
  now: Date;
  deadlineAt: number;
  previous: ModelVersionsCheckSummary | null;
  summary: ModelVersionsCheckSummary;
  events: ModelVersionsAlertEvents;
}): Promise<void> {
  const { family, now, summary, events } = args;
  const pinned = pinnedModelFor(family);
  const active = args.rows.find((r) => r.family === family && r.status === "active");
  const candidate = pickCandidate({
    family,
    apiModels: args.apiModels,
    pinnedId: pinned.id,
    activeId: active?.id ?? null,
    knownIds: args.rows.map((r) => r.id),
  });
  if (candidate === null) return;

  const fail = async (reason: string, probeAiCallId: string | null) => {
    await recordFailedVersion(
      { ...versionInput(candidate, family, probeAiCallId), reason },
      now,
    );
    summary.failed.push({ id: candidate.id, reason });
    events.failed.push({ id: candidate.id, reason });
  };
  // N5: erro transitório conta os dias desde a primeira vez (carregado no resumo).
  const transient = async (reason: string, probeAiCallId: string | null) => {
    const prev = args.previous?.transient.find((t) => sameVersion(t.id, candidate.id));
    const since = prev?.since ?? now.toISOString();
    const elapsed = now.getTime() - Date.parse(since);
    if (Number.isFinite(elapsed) && elapsed >= TRANSIENT_FAIL_AFTER_MS) {
      await fail(`transitório persistente (7 dias): ${reason}`, probeAiCallId);
      return;
    }
    summary.transient.push({ id: candidate.id, family, since, reason });
  };

  const caps = checkCapabilities(candidate);
  if (!caps.ok) {
    if (caps.transient) await transient(caps.reason, null);
    else await fail(`capabilities: ${caps.reason}`, null);
    return;
  }

  const model = adoptedModel({
    id: candidate.id,
    pinned,
    pricing: pricingOf(pinned),
    priceConfirmed: false,
  });
  const probe = await probeModelVersion(model, args.deadlineAt);
  if (probe.kind === "fail") {
    await fail(`sondagem: ${probe.reason}`, probe.aiCallId);
    return;
  }
  if (probe.kind === "transient") {
    await transient(`sondagem: ${probe.reason}`, probe.aiCallId);
    return;
  }
  await adoptModelVersion(versionInput(candidate, family, probe.aiCallId), now);
  resetActiveModelMemo();
  summary.adopted.push(candidate.id);
  events.adopted.push({
    id: candidate.id,
    pinnedId: pinned.id,
    inputPricePerMTok: pinned.inputPricePerMTok,
    outputPricePerMTok: pinned.outputPricePerMTok,
  });
}
