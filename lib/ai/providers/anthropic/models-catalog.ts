// Catálogo de modelos da API Anthropic (GET /v1/models) pro aviso de
// /admin/settings "modelos disponíveis na API ainda sem cadastro" (#524).
//
// Por que mora AQUI e não passa por predict.ts: a regra do CLAUDE.md ("toda chamada
// de LLM passa por lib/ai/predict.ts", que loga em ai_calls) é sobre INFERÊNCIA —
// chamada paga, com tokens e custo. Listar modelos é metadado: grátis, sem tokens,
// nada a auditar em ai_calls. Continua dentro do módulo do provider Anthropic
// (lib/ai/providers/anthropic/), que é o único lugar autorizado a usar o SDK.
//
// O registry (lib/ai/models.ts) segue curado à mão porque a Models API NÃO devolve
// pricing: isto só AVISA que existe id novo; cadastrar é decisão humana.

import { getAnthropicClient } from "@/lib/ai/anthropic";

import { hasKey } from "./client";

export type ApiModelInfo = {
  id: string;
  displayName: string;
  // RFC 3339, como a API devolve.
  createdAt: string;
};

// Um id da API conta como cadastrado quando é IGUAL a um id do registry ou é o
// SNAPSHOT DATADO de um alias do registry (`claude-haiku-4-5` cobre
// `claude-haiku-4-5-20251001`). Sem isso o aviso acusaria o próprio Haiku.
function isRegistered(apiId: string, registryIds: readonly string[]): boolean {
  return registryIds.some(
    (r) =>
      apiId === r ||
      (apiId.startsWith(`${r}-`) && /^\d{8}$/.test(apiId.slice(r.length + 1))),
  );
}

// Diff PURO: ids `claude-*` da API que não estão no registry. Corta os LEGADOS —
// modelos lançados antes do modelo cadastrado mais antigo que a API ainda lista
// (hoje o Sonnet 4.5) — porque o aviso serve pra notar modelo NOVO, e a API lista
// toda a família antiga (3.x, 4.0, …) que nunca vai ser cadastrada. Sem nenhum
// cadastrado na lista da API não há referência: nada é cortado. Mantém a ordem da
// API (mais novo primeiro) e deduplica.
export function unregisteredApiModels(
  apiModels: readonly ApiModelInfo[],
  registryIds: readonly string[],
): ApiModelInfo[] {
  const claude = apiModels.filter((m) => m.id.startsWith("claude-"));
  const registeredTimes = claude
    .filter((m) => isRegistered(m.id, registryIds))
    .map((m) => Date.parse(m.createdAt))
    .filter((t) => Number.isFinite(t));
  const cutoff =
    registeredTimes.length > 0 ? Math.min(...registeredTimes) : -Infinity;

  const seen = new Set<string>();
  return claude.filter((m) => {
    if (seen.has(m.id) || isRegistered(m.id, registryIds)) return false;
    seen.add(m.id);
    const created = Date.parse(m.createdAt);
    // createdAt inválido não é cortado: na dúvida, avisa.
    return !Number.isFinite(created) || created >= cutoff;
  });
}

// Cache em memória por instância: 1h pro sucesso, 5min pra falha (não martela a
// API a cada load da página quando ela está fora, mas se recupera logo).
const SUCCESS_TTL_MS = 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
// Opções de CADA request da listagem (#524 review): 5s e sem retry — o aviso é
// informativo e não pode segurar a página nos 60s × 3 tentativas do client.
export const LIST_REQUEST_OPTIONS = { timeout: 5_000, maxRetries: 0 } as const;
let cache: { value: ApiModelInfo[]; expiresAt: number } | undefined;
// Listagem em andamento: loads concorrentes com o cache frio esperam a MESMA
// chamada em vez de abrir uma cada.
let inFlight: Promise<ApiModelInfo[]> | undefined;

// Lista os modelos da API. FALHA EM SILÊNCIO: sem ANTHROPIC_API_KEY ou com erro
// (rede, timeout, 4xx/5xx), devolve [] e o aviso some. É informativo; nunca derruba
// a página (que ainda o renderiza dentro de um <Suspense>, fora do caminho crítico).
export async function listApiModels(): Promise<ApiModelInfo[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  if (!hasKey()) return [];
  if (!inFlight) {
    inFlight = fetchApiModels().finally(() => {
      inFlight = undefined;
    });
  }
  return inFlight;
}

async function fetchApiModels(): Promise<ApiModelInfo[]> {
  try {
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
      });
    }
    cache = { value: models, expiresAt: Date.now() + SUCCESS_TTL_MS };
    return models;
  } catch (err) {
    console.warn(
      JSON.stringify({
        scope: "anthropic-models-catalog",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    cache = { value: [], expiresAt: Date.now() + FAILURE_TTL_MS };
    return [];
  }
}

// Só pros testes: zera o cache do módulo entre casos.
export function resetApiModelsCacheForTests(): void {
  cache = undefined;
  inFlight = undefined;
}
