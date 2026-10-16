// Versões adotadas no seam (ADR 0062, PLAN-608 §2.2). Os call sites seguem pedindo a
// CONFERIDA da família (preferência > default > UTILITY_MODEL_ID); aqui ela é trocada
// pela versão `active` da família, com fallback pra conferida. Assim nenhuma das portas
// de LLM esquece a troca, e o fallback mora num lugar só. Quem loga ai_calls, custo e
// modelVersion lê `result.servedModel` (PR A).

import {
  isAIModelId,
  pinnedModelFor,
  type AIModel,
} from "@/lib/ai/models";
import {
  resetActiveModelMemo,
  resolveActiveModel,
} from "@/lib/ai/model-versions/active";
import { markModelVersionFailed } from "@/lib/db/queries/model-versions";

import { isOverloadedError } from "./anthropic/errors";
import type {
  AIProvider,
  AnalysisErr,
  AnalysisRequest,
  AnalysisResult,
} from "./types";

function isPinnedRequest(model: AIModel): boolean {
  return (
    model.provider === "anthropic" &&
    isAIModelId(model.id) &&
    pinnedModelFor(model.family).id === model.id
  );
}

function usedTokens(r: AnalysisResult): boolean {
  return r.usage.inputTokens > 0 || r.usage.outputTokens > 0;
}

// Motivo gravado em model_versions.failure_reason quando a conferida passou e a
// adotada não.
function failureReason(r: AnalysisErr): string {
  const kind =
    r.rejection === "not_found"
      ? "a API não atende a versão (404/403)"
      : "a API recusou o pedido (400)";
  return `${kind}, e a conferida passou: ${r.message}`.slice(0, 500);
}

// Marca a versão como falha e zera o memo. NUNCA lança: o resultado da análise (que
// já veio da conferida) não pode cair por causa do update de auditoria.
async function markFailed(model: AIModel, r1: AnalysisErr): Promise<void> {
  try {
    await markModelVersionFailed(model.id, failureReason(r1));
    resetActiveModelMemo();
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "model_versions",
        error: "mark_failed_failed",
        model: model.id,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/**
 * Embrulha o provider Anthropic:
 *  1. repassa direto o que não for a conferida de uma família;
 *  2. chama na versão adotada (se houver uma diferente da conferida);
 *  3. devolve como está o sucesso, a falha que gastou tokens (refazer perderia o custo
 *     de um pause_turn) e a falha sem rejeição (timeout, 429, 5xx: a conferida
 *     sofreria igual);
 *  4. rejeição (400/403/404) ou 529 sem tokens → refaz na conferida, com o mesmo prazo;
 *  5. marca a adotada como `failed` SÓ se foi rejeição e a conferida passou com o
 *     MESMO pedido. `rejection` é uma pista, não prova: um 400 pode ser crédito
 *     esgotado ou prompt grande demais, e um 403 pode ser permissão da conta. Se a
 *     conferida também falha, devolve essa falha e não marca nada. 529 nunca marca.
 *     A marcação sai no e-mail da próxima checagem do cron (ADR 0062 §9).
 */
export function withAdoptedVersions(provider: AIProvider): AIProvider {
  return {
    providerKey: provider.providerKey,
    hasKey: () => provider.hasKey(),
    async runAnalysis(request: AnalysisRequest): Promise<AnalysisResult> {
      if (!isPinnedRequest(request.model)) return provider.runAnalysis(request);
      const active = await resolveActiveModel(request.model.family);
      if (active.id === request.model.id) return provider.runAnalysis(request);

      const r1 = await provider.runAnalysis({ ...request, model: active });
      if (r1.ok || usedTokens(r1)) return r1;
      const overloaded = isOverloadedError(r1.cause);
      if (!r1.rejection && !overloaded) return r1;

      const r2 = await provider.runAnalysis(request);
      if (r1.rejection && r2.ok) await markFailed(active, r1);
      return {
        ...r2,
        outputPayload: {
          ...r2.outputPayload,
          adoptedFallback: {
            model: active.id,
            status: r1.status,
            ...(r1.rejection ? { rejection: r1.rejection } : {}),
            ...(overloaded ? { overloaded: true } : {}),
            error: r1.message,
          },
        },
      };
    },
  };
}
