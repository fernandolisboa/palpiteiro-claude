// Catálogo de modelos da API Anthropic (GET /v1/models) pro cron
// check-model-versions (ADR 0062), que acha versões novas de Haiku, Sonnet e Opus.
//
// Por que mora AQUI e não passa por predict.ts: a regra do CLAUDE.md ("toda chamada
// de LLM passa por lib/ai/predict.ts", que loga em ai_calls) é sobre INFERÊNCIA —
// chamada paga, com tokens e custo. Listar modelos é metadado: grátis, sem tokens,
// nada a auditar em ai_calls. Continua dentro do módulo do provider Anthropic
// (lib/ai/providers/anthropic/), que é o único lugar autorizado a usar o SDK.
//
// A Models API NÃO devolve pricing: uma versão adotada herda o preço da conferida da
// família até o admin confirmar o oficial.

import type Anthropic from "@anthropic-ai/sdk";

import { getAnthropicClient } from "@/lib/ai/anthropic";

export type ApiModelCapabilities = Anthropic.ModelCapabilities;

export type ApiModelInfo = {
  id: string;
  displayName: string;
  // RFC 3339, como a API devolve.
  createdAt: string;
  // `null` quando a API não informa (o cron trata como transitório).
  capabilities: ApiModelCapabilities | null;
  // Teto de `max_tokens` do modelo; `null` = não informado.
  maxTokens: number | null;
};

// Opções de CADA request da listagem: 10s e 2 retries. Quem chama é o cron (sem
// usuário esperando), mas um travamento não pode comer o prazo da sondagem.
export const LIST_REQUEST_OPTIONS = { timeout: 10_000, maxRetries: 2 } as const;

/**
 * Lista os modelos da API, sem cache. LANÇA em qualquer erro (sem chave, rede,
 * 4xx/5xx): o cron grava a falha no resumo e responde 500, em vez de concluir que
 * não há versão nova.
 */
export async function listApiModels(): Promise<ApiModelInfo[]> {
  const models: ApiModelInfo[] = [];
  // O SDK pagina sozinho no for-await; as páginas seguintes reusam as opções.
  for await (const m of getAnthropicClient().models.list(
    { limit: 100 },
    LIST_REQUEST_OPTIONS,
  )) {
    models.push({
      id: m.id,
      displayName: m.display_name,
      createdAt: m.created_at,
      capabilities: m.capabilities ?? null,
      maxTokens: m.max_tokens ?? null,
    });
  }
  return models;
}
