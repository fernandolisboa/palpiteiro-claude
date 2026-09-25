// Quota extraction and structured logging shared by all HTTP providers.
//
// Each provider declares which response headers carry which quota counter
// (daily/perMinute/monthly). `extractQuota` reads them as numbers. `logCall`
// emits a single structured log line per attempt; `evaluateQuotaLevel` flags
// WARN at <20% remaining and ERROR at <5%.

export type QuotaHeaderMapping = {
  daily?: string;
  dailyLimit?: string | number;
  perMinute?: string;
  monthly?: string;
  monthlyLimit?: string | number;
  monthlyUsed?: string;
};

export type ExtractedQuota = {
  dailyRemaining: number | null;
  dailyLimit: number | null;
  perMinuteRemaining: number | null;
  monthlyRemaining: number | null;
  monthlyUsed: number | null;
  monthlyLimit: number | null;
};

export type QuotaLevel = "ok" | "warn" | "error";

const WARN_RATIO = 0.20;
const ERROR_RATIO = 0.05;

function toInt(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function resolveLimit(
  headers: Headers,
  spec: string | number | undefined,
): number | null {
  if (spec === undefined) return null;
  if (typeof spec === "number") return spec;
  return toInt(headers.get(spec));
}

export function extractQuota(
  headers: Headers,
  mapping: QuotaHeaderMapping,
): ExtractedQuota {
  return {
    dailyRemaining: mapping.daily ? toInt(headers.get(mapping.daily)) : null,
    dailyLimit: resolveLimit(headers, mapping.dailyLimit),
    perMinuteRemaining: mapping.perMinute
      ? toInt(headers.get(mapping.perMinute))
      : null,
    monthlyRemaining: mapping.monthly
      ? toInt(headers.get(mapping.monthly))
      : null,
    monthlyUsed: mapping.monthlyUsed
      ? toInt(headers.get(mapping.monthlyUsed))
      : null,
    monthlyLimit: resolveLimit(headers, mapping.monthlyLimit),
  };
}

// Última quota vista por provider (atualizada a cada call não-cache-hit em logCall).
// Permite a um caller (ex.: o cron de CLV, #180) ler o crédito mensal restante após
// seus fetches SEM mudar a assinatura de cada função de provider — a quota já flui
// por aqui. Process-memory (reseta no cold start); é telemetria de run, não estado.
// `observedAt` = quando o header foi lido: um run sem fetch real (tudo cache-hit) pode
// devolver a quota de uma invocação anterior da mesma lambda quente, e quem a persiste
// (provider_quota, #509) precisa do instante real da leitura, não do fim do run.
export type ObservedQuota = ExtractedQuota & { observedAt: Date };

const lastQuotaByProvider = new Map<string, ObservedQuota>();

export function getLastQuota(provider: string): ObservedQuota | null {
  return lastQuotaByProvider.get(provider) ?? null;
}

export function evaluateQuotaLevel(quota: ExtractedQuota): QuotaLevel {
  const ratios: number[] = [];
  if (quota.dailyRemaining !== null && quota.dailyLimit) {
    ratios.push(quota.dailyRemaining / quota.dailyLimit);
  }
  if (quota.monthlyRemaining !== null && quota.monthlyLimit) {
    ratios.push(quota.monthlyRemaining / quota.monthlyLimit);
  }
  if (ratios.length === 0) return "ok";
  const min = Math.min(...ratios);
  if (min < ERROR_RATIO) return "error";
  if (min < WARN_RATIO) return "warn";
  return "ok";
}

export type CallLogFields = {
  provider: string;
  endpoint: string;
  cache_hit: boolean;
  latency_ms: number;
  status_code: number | null;
  attempt: number;
  quota?: ExtractedQuota;
  error?: string;
};

export function logCall(fields: CallLogFields): void {
  const { quota, ...rest } = fields;
  const base: Record<string, unknown> = {
    provider: rest.provider,
    endpoint: rest.endpoint,
    cache_hit: rest.cache_hit,
    latency_ms: rest.latency_ms,
    status_code: rest.status_code,
    attempt: rest.attempt,
  };
  if (rest.error !== undefined) base.error = rest.error;

  // Cache hits never expose quota (the request was not sent).
  if (!fields.cache_hit && quota) {
    lastQuotaByProvider.set(fields.provider, {
      ...quota,
      observedAt: new Date(),
    });
    base.quota_daily_remaining = quota.dailyRemaining;
    base.quota_daily_limit = quota.dailyLimit;
    base.quota_perminute_remaining = quota.perMinuteRemaining;
    base.quota_monthly_remaining = quota.monthlyRemaining;
    base.quota_monthly_used = quota.monthlyUsed;
    base.quota_monthly_limit = quota.monthlyLimit;
  }

  const level = !fields.cache_hit && quota ? evaluateQuotaLevel(quota) : "ok";
  const line = JSON.stringify({ ...base, level });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}
