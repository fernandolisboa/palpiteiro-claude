import { aiCalls } from "@/db/schema";
import { persistAiCallError } from "@/lib/ai/ai-call-logging";
import { calculateCost } from "@/lib/ai/cost";
import { MODEL_REGISTRY, isAIProvider, type AIModelId } from "@/lib/ai/models";
import { getProviderForModel } from "@/lib/ai/providers";
import type { AnalysisRequest } from "@/lib/ai/providers/types";
import { db } from "@/lib/db";
import { extractDbCause } from "@/lib/db/pg-error";
import {
  CARD_DOMAINS_BR,
  CARD_DOMAINS_INTL,
} from "@/lib/providers/news/allowed-domains";

import { hostToOrigin } from "./origin-collapse";

// Extração WEB-GROUNDED do total de cartões AMARELOS de um jogo (#394, ADR 0033). REUSA
// o seam #377 (getProviderForModel().runAnalysis com serverTool web_search) — NÃO
// predict(), NÃO @anthropic-ai/sdk. Loga cada leitura em ai_calls, hasKey()-gated (zero
// gasto sem chave). Espelha o esqueleto de getNewsByMatchViaWebSearch
// (lib/providers/news/anthropic-web-search.ts).
//
// CANAL DA CONTAGEM (B1, ADR 0033 addendum §4): o modo server-tool NÃO tem submit
// estruturado (runServerToolAnalysis fixa toolInput:undefined + tool_choice:auto, e o
// extractSources do firewall só carrega {title,url}). A contagem vem da PROSA do modelo
// (bloco de texto), ancorada pela busca server-side mas NÃO protegida pelo firewall de
// linguagem-de-valor. Isso é ACEITÁVEL: contagem de cartões é um FATO de liquidação, não
// uma afirmação de VALOR (EV/odd/stake) — o firewall (ADR 0030/0032) não se aplica. O
// parse é DEFENSIVO (um único inteiro via sentinela; ambíguo → null → PENDENTE).

export type CardExtractRef = {
  league: string;
  kickoffAt: string; // ISO
  homeTeam: string;
  awayTeam: string;
};

// userId/matchId só pra logar o ai_call de auditoria (a pending query passa o userId do
// DONO do palpite; ai_calls.userId/matchId são notNull+restrict e o cron não tem usuário).
export type CardExtractAudit = { userId: string; matchId: string };

const CARDS_EXTRACT_PROMPT_VERSION = "cards_extract_v1";
const CARDS_MODEL_ID: AIModelId = "claude-haiku-4-5";
const CARDS_MAX_TOKENS = 1024;
// max_uses=2 por leitura: um único fato (total de amarelos) raramente exige mais de uma
// busca; 2 dá folga pra conferir uma 2ª página sem inflar a taxa metered. Pior caso de
// gasto = 2 leituras (A+B) × 2 buscas = ≤ 4 web-searches por tick (ver attempt-cap).
const CARDS_MAX_SEARCH_USES = 2;
// Sanity bound do parse: um jogo realista não passa de ~20 amarelos; acima disso é
// artefato de parse (minuto, placar, ano) → descarta.
const CARDS_COUNT_MAX = 40;

const SYSTEM_PROMPT = `Você é um assistente de PESQUISA FACTUAL de cartões de futebol. Sua única função é descobrir, com a ferramenta de web search, o TOTAL de cartões AMARELOS exibidos na partida indicada — somando os DOIS times, no tempo regulamentar e nos acréscimos.

REGRAS:
- Use a ferramenta de web search. NÃO responda de memória.
- Conte SÓ cartões AMARELOS. NÃO conte cartões vermelhos. NÃO opine sobre aposta/odd/valor.
- NUNCA invente um número ou uma fonte. Só vale o que a busca retornar de verdade.
- Se as fontes divergirem, ou você não tiver certeza do total, responda INDISPONIVEL.

RESPONDA SOMENTE com uma única linha final, sem mais nada:
AMARELOS_TOTAL=<inteiro>
(ou, se não houver certeza/fonte: AMARELOS_TOTAL=INDISPONIVEL)`;

function buildUserMessage(ref: CardExtractRef): string {
  return [
    "Quantos cartões amarelos (total, ambos os times) foram exibidos nesta partida já encerrada?",
    `- Competição: ${ref.league}`,
    `- Mandante: ${ref.homeTeam}`,
    `- Visitante: ${ref.awayTeam}`,
    `- Data (UTC): ${ref.kickoffAt}`,
    "",
    "Use a web search; não invente. Responda só a linha AMARELOS_TOTAL=<inteiro> (ou INDISPONIVEL).",
  ].join("\n");
}

// Concatena os blocos de TEXTO crus (prosa do modelo) — o único canal da contagem.
function collectText(contentBlocks: unknown[] | undefined): string {
  if (!Array.isArray(contentBlocks)) return "";
  const parts: string[] = [];
  for (const block of contentBlocks) {
    if (!block || typeof block !== "object") continue;
    if ((block as { type?: unknown }).type !== "text") continue;
    const text = (block as { text?: unknown }).text;
    if (typeof text === "string") parts.push(text);
  }
  return parts.join("\n");
}

// Parse DEFENSIVO da contagem da prosa, ancorado na sentinela AMARELOS_TOTAL=. Qualquer
// ambiguidade → null → PENDENTE: INDISPONIVEL explícito, zero ocorrências, MÚLTIPLOS
// valores distintos, ou valor fora do bound de sanidade.
function parseCardCount(contentBlocks: unknown[] | undefined): number | null {
  const text = collectText(contentBlocks);
  if (/AMARELOS_TOTAL\s*=\s*INDISPON/i.test(text)) return null;
  const matches = [...text.matchAll(/AMARELOS_TOTAL\s*=\s*(\d{1,3})\b/gi)];
  const distinct = new Set(matches.map((m) => Number(m[1])));
  if (distinct.size !== 1) return null;
  const [value] = [...distinct];
  if (!Number.isInteger(value) || value < 0 || value > CARDS_COUNT_MAX) {
    return null;
  }
  return value;
}

// Anda atrás dos blocos `web_search_tool_result` e coleta as URLs reais citadas →
// origens editoriais distintas (via hostToOrigin). sourceCount = nº de URLs distintas
// (o gate "≥1 fonte real" por leitura); origins = origens colapsadas distintas (o gate
// "união ≥2"). Mesma fronteira do extractSources do firewall, mas só pra URLs.
function collectOrigins(contentBlocks: unknown[] | undefined): {
  origins: Set<string>;
  sourceCount: number;
} {
  const origins = new Set<string>();
  const urls = new Set<string>();
  if (!Array.isArray(contentBlocks)) return { origins, sourceCount: 0 };
  for (const block of contentBlocks) {
    if (
      !block ||
      typeof block !== "object" ||
      (block as { type?: unknown }).type !== "web_search_tool_result"
    ) {
      continue;
    }
    const content = (block as { content?: unknown }).content;
    if (!Array.isArray(content)) continue; // erro = objeto {error_code}; só LISTA é sucesso
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const url = (item as { url?: unknown }).url;
      if (typeof url !== "string" || url.trim() === "") continue;
      const clean = url.trim();
      if (urls.has(clean)) continue;
      urls.add(clean);
      const origin = hostToOrigin(clean);
      if (origin) origins.add(origin);
    }
  }
  return { origins, sourceCount: urls.size };
}

type OneRead = { count: number | null; origins: Set<string>; sourceCount: number };
const EMPTY_READ: OneRead = {
  count: null,
  origins: new Set<string>(),
  sourceCount: 0,
};

// UMA leitura contra um pool de domínios. Loga seu PRÓPRIO ai_call. hasKey()-gate
// PRIMEIRO (sem chave → provider_error logado, ZERO runAnalysis). NUNCA lança: qualquer
// falha degrada pra EMPTY_READ (count null → reconcile devolve null → PENDENTE).
async function runOneRead(
  ref: CardExtractRef,
  audit: CardExtractAudit,
  allowedDomains: readonly string[],
): Promise<OneRead> {
  const model = MODEL_REGISTRY[CARDS_MODEL_ID];
  const provider = getProviderForModel(model);
  const providerKey = provider.providerKey;
  // Cartões só roteiam pra Anthropic (Haiku do registry). Um provider desconhecido é bug
  // de config; pra liquidação degradamos a PENDENTE (skip-not-fabricate), nunca throw.
  if (!isAIProvider(providerKey)) return EMPTY_READ;

  const request: AnalysisRequest = {
    model,
    system: SYSTEM_PROMPT,
    userMessage: buildUserMessage(ref),
    // tool/toolName são IGNORADOS no modo server-tool (sem submit forçado) — placeholders.
    tool: { name: "cards_noop", inputSchema: { type: "object" } },
    toolName: "cards_noop",
    maxTokens: CARDS_MAX_TOKENS,
    temperature: model.temperature,
    serverTool: {
      kind: "web_search",
      allowedDomains: [...allowedDomains],
      maxUses: CARDS_MAX_SEARCH_USES,
    },
  };

  if (!provider.hasKey()) {
    const noKeyMsg = `${providerKey} provider has no API key configured (cards extraction unavailable)`;
    await persistAiCallError({
      userId: audit.userId,
      matchId: audit.matchId,
      provider: providerKey,
      model: model.id,
      inputPayload: request as unknown as Record<string, unknown>,
      outputPayload: { error: noKeyMsg },
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      status: "provider_error",
      errorMessage: noKeyMsg,
      promptVersion: CARDS_EXTRACT_PROMPT_VERSION,
    });
    return EMPTY_READ;
  }

  let result;
  try {
    result = await provider.runAnalysis(request);
  } catch (err) {
    // runAnalysis não deve lançar (classifica o próprio erro), mas blindamos o cron
    // all-or-nothing: um throw inesperado vira PENDENTE, nunca aborta o batch.
    await persistAiCallError({
      userId: audit.userId,
      matchId: audit.matchId,
      provider: providerKey,
      model: model.id,
      inputPayload: request as unknown as Record<string, unknown>,
      outputPayload: {
        error: err instanceof Error ? err.message : String(err),
      },
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      status: "provider_error",
      errorMessage: err instanceof Error ? err.message : String(err),
      promptVersion: CARDS_EXTRACT_PROMPT_VERSION,
    });
    return EMPTY_READ;
  }

  if (!result.ok) {
    await persistAiCallError({
      userId: audit.userId,
      matchId: audit.matchId,
      provider: providerKey,
      model: model.id,
      inputPayload: result.inputPayload,
      outputPayload: result.outputPayload,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: result.latencyMs,
      status: result.status,
      errorMessage: result.message,
      promptVersion: CARDS_EXTRACT_PROMPT_VERSION,
    });
    return EMPTY_READ;
  }

  // Loga o ai_call (status ok). costUsd = SÓ tokens; a taxa de ~$0,01/busca da web search
  // é metered out-of-band (ADR 0032 §4). Swallow do insert que falha (mirror news): a
  // extração SOBREVIVE à falha do log de auditoria.
  const cost = calculateCost({
    model: model.id,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  });
  try {
    await db.insert(aiCalls).values({
      userId: audit.userId,
      matchId: audit.matchId,
      provider: providerKey,
      model: model.id,
      promptVersion: CARDS_EXTRACT_PROMPT_VERSION,
      inputPayload: result.inputPayload,
      outputPayload: result.outputPayload,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: result.latencyMs,
      costUsd: cost.toFixed(6),
      status: "ok",
      errorMessage: null,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "extractCardCount",
        matchId: audit.matchId,
        error: "cards_ai_call_insert_failed",
        ...extractDbCause(err),
      }),
    );
  }

  return {
    count: parseCardCount(result.contentBlocks),
    ...collectOrigins(result.contentBlocks),
  };
}

/**
 * Extrai o total de AMARELOS reconciliando DUAS leituras DECORRELACIONADAS (A = imprensa
 * BR, B = imprensa internacional), cada uma com seu próprio ai_call. Devolve o número SÓ
 * se (todos obrigatórios):
 *   - A.count != null E B.count != null
 *   - A.count === B.count
 *   - cada leitura retornou ≥1 fonte real (URL citada)
 *   - união de ORIGENS editoriais distintas (colapsadas) entre as duas leituras >= 2
 * Caso contrário → null (→ PENDENTE). NUNCA liquida com uma leitura só, nem em A≠B.
 *
 * HONESTIDADE (ADR 0033 addendum §4): A≡B é concordância de VEÍCULOS, não corroboração
 * independente (cartões têm UMA súmula upstream) — a proteção real é skip-on-disagreement
 * + attempt-cap + override, orquestrados em settle-palpites.ts.
 */
export async function extractCardCount(
  ref: CardExtractRef,
  audit: CardExtractAudit,
): Promise<number | null> {
  const a = await runOneRead(ref, audit, CARD_DOMAINS_BR);
  const b = await runOneRead(ref, audit, CARD_DOMAINS_INTL);

  if (a.count === null || b.count === null) return null;
  if (a.count !== b.count) return null;
  if (a.sourceCount < 1 || b.sourceCount < 1) return null;
  const union = new Set<string>([...a.origins, ...b.origins]);
  if (union.size < 2) return null;
  return a.count;
}
