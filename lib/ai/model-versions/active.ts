import {
  parseClaudeVersion,
  pinnedModelFor,
  type AIModel,
  type ModelFamily,
  type PinnedModel,
} from "@/lib/ai/models";
import {
  getActiveModelState,
  type ModelVersionRow,
} from "@/lib/db/queries/model-versions";

import { ModelPricingSchema, type ModelPricing } from "./types";

// Versão em uso de cada família (ADR 0062): a `active` de model_versions, ou a
// conferida do registry. SÓ servidor (lê o banco); models.ts continua síncrono e
// sem `db`. Memoizada por instância com TTL de 60s, no padrão de
// lib/ai/engine/analysis-engine-flag.ts: num fan-out, uma query só.
const TTL_MS = 60 * 1000;

type Snapshot = Partial<Record<ModelFamily, AIModel>>;

let memo: { at: number; byFamily: Snapshot } | null = null;
// Leitura em andamento: chamadas concorrentes com o memo frio esperam a MESMA query.
let inFlight: Promise<Snapshot> | null = null;
// Sobe a cada reset: uma leitura que começou antes do reset não grava o memo.
let generation = 0;

// O preço da conferida no formato de model_versions.pricing: o que uma versão nova
// herda na adoção (a Models API não informa preço).
export function pricingOf(model: AIModel): ModelPricing {
  return {
    inputPricePerMTok: model.inputPricePerMTok,
    outputPricePerMTok: model.outputPricePerMTok,
    ...(model.longPromptPricing
      ? { longPromptPricing: { ...model.longPromptPricing } }
      : {}),
  };
}

// A versão `id` da família como AIModel. Herda da conferida tudo que a API não informa
// (provider, ritmo, audiência, rótulo da família); o preço vem de `pricing`.
export function adoptedModel(args: {
  id: string;
  pinned: PinnedModel;
  pricing: ModelPricing;
  priceConfirmed: boolean;
}): AIModel {
  const { longPromptPricing: _pinnedLong, ...base } = args.pinned;
  return {
    ...base,
    id: args.id,
    inputPricePerMTok: args.pricing.inputPricePerMTok,
    outputPricePerMTok: args.pricing.outputPricePerMTok,
    ...(args.pricing.longPromptPricing
      ? { longPromptPricing: args.pricing.longPromptPricing }
      : {}),
    adopted: { priceEstimated: !args.priceConfirmed, pinnedId: args.pinned.id },
  };
}

// Row → AIModel. `null` = row inválida (id fora do formato ou de outra família, preço
// que não passa no Zod): fica a conferida.
export function adoptedModelFromRow(row: ModelVersionRow): AIModel | null {
  const version = parseClaudeVersion(row.id);
  if (version === null || version.family !== row.family) return null;
  const pricing = ModelPricingSchema.safeParse(row.pricing);
  if (!pricing.success) return null;
  return adoptedModel({
    id: row.id,
    pinned: pinnedModelFor(version.family),
    pricing: pricing.data,
    priceConfirmed: row.priceConfirmedAt != null,
  });
}

async function loadSnapshot(): Promise<Snapshot> {
  const state = await getActiveModelState();
  const byFamily: Snapshot = {};
  if (!state.enabled) return byFamily;
  for (const row of state.active) {
    const model = adoptedModelFromRow(row);
    if (model === null) {
      console.warn(
        JSON.stringify({
          scope: "model_versions",
          warning: "row active inválida; usando a conferida",
          id: row.id,
          family: row.family,
        }),
      );
      continue;
    }
    byFamily[model.family] = model;
  }
  return byFamily;
}

/**
 * O modelo que a família usa agora. FAIL-SAFE: erro de leitura, kill switch
 * desligado, nada adotado ou row inválida → a conferida. A falha não é memoizada (a
 * próxima chamada tenta ler de novo).
 */
export async function resolveActiveModel(
  family: ModelFamily,
  now: number = Date.now(),
): Promise<AIModel> {
  const pinned = pinnedModelFor(family);
  if (memo && now - memo.at < TTL_MS) return memo.byFamily[family] ?? pinned;
  try {
    if (!inFlight) {
      const startedAt = generation;
      const load: Promise<Snapshot> = loadSnapshot()
        .then((byFamily) => {
          if (startedAt === generation) memo = { at: now, byFamily };
          return byFamily;
        })
        .finally(() => {
          if (inFlight === load) inFlight = null;
        });
      inFlight = load;
    }
    const byFamily = await inFlight;
    return byFamily[family] ?? pinned;
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "model_versions",
        error: "active_model_read_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return pinned;
  }
}

/** Zera o memo: adoção, falha marcada, ação do admin (mesma instância) e testes. */
export function resetActiveModelMemo(): void {
  memo = null;
  inFlight = null;
  generation += 1;
}
