import { aiCalls } from "@/db/schema";
import { db } from "@/lib/db";
import { extractDbCause } from "@/lib/db/pg-error";
import { persistAiCallError } from "@/lib/ai/ai-call-logging";
import { calculateCost } from "@/lib/ai/cost";
import { MODEL_REGISTRY, isAIProvider, type AIModelId } from "@/lib/ai/models";
import { getProviderForModel } from "@/lib/ai/providers";
import type { AnalysisRequest } from "@/lib/ai/providers/types";

import { NewsUnavailableError } from "./types";

import { ALLOWED_DOMAINS } from "./allowed-domains";
import type {
  NewsAuditContext,
  NewsFetchOutcome,
  NewsMatchContext,
  NewsResult,
} from "./types";

// Provider de notícias via web search NATIVA da Claude (ADR 0032 / #377). Roda ANTES da
// síntese, como uma chamada de LLM PRÓPRIA pelo seam AIProvider (ADR 0027) — espelha o
// padrão "fetch-then-feed" da AbsencesProvider (ADR 0026), e loga seu PRÓPRIO ai_call.
// NÃO importa @anthropic-ai/sdk: tudo passa pelo seam (predict.ts é a única porta).
//
// FIREWALL (ADR 0030/0032): captura SÓ {title,url} REAIS dos blocos
// `web_search_tool_result` — nunca a prosa do modelo. Como é tool output (não texto
// gerado), uma fonte não pode carregar afirmação de valor por construção.

// Versão do "cartucho" de notícias (ADR 0017) — grava em ai_calls.promptVersion.
const NEWS_PROMPT_VERSION = "news_v1";

// Default Haiku: econômico, temperature-mode (web_search_20250305 básica). NÃO admin-
// gated. maxTokens enxuto — a busca devolve poucos resultados; não geramos prosa longa.
const NEWS_MODEL_ID: AIModelId = "claude-haiku-4-5";
const NEWS_MAX_TOKENS = 4096;
// max_uses:1 — 1 busca por run (ADR 0032 §4: teto ≈ 20/dia pelo cap de 20 runs).
const NEWS_MAX_SEARCH_USES = 1;
const MAX_RESULTS = 10;

const SYSTEM_PROMPT = `Você é um assistente de PESQUISA de notícias de futebol. Sua única função é BUSCAR, com a ferramenta de web search, notícias FACTUAIS e recentes sobre a partida indicada (desfalques de última hora, troca de técnico, contexto de lesão/motivação, escalação provável).

REGRAS:
- Use a ferramenta de web search. NÃO responda de memória.
- NUNCA invente uma notícia ou uma fonte. Só vale o que a busca retornar de verdade.
- Não emita opinião de aposta, palpite, odd, edge ou valor — só os fatos noticiados.
- Pode resumir brevemente, mas o que importa são as fontes reais encontradas.`;

function buildUserMessage(ctx: NewsMatchContext): string {
  return [
    "Busque notícias recentes e factuais sobre esta partida de futebol:",
    `- Competição: ${ctx.league}`,
    `- Mandante: ${ctx.homeTeam}`,
    `- Visitante: ${ctx.awayTeam}`,
    `- Data (UTC): ${ctx.kickoffAt}`,
    "",
    "Foque em desfalques confirmados, troca de técnico, lesões, suspensões e contexto relevante das duas equipes. Use a web search; não invente.",
  ].join("\n");
}

// Anda atrás dos blocos `web_search_tool_result` nos contentBlocks crus da resposta e
// extrai SÓ os {title, url} reais (ADR 0032 §2). Na server tool da Claude:
//   - sucesso: block.content é uma LISTA de web_search_result ({title,url,...})
//   - erro:    block.content é um OBJETO { error_code } (HTTP 200, não cobrado)
// Dropa qualquer item sem title NÃO-VAZIO E url http(s) válida (nunca inventa); dedup
// por url.
function extractSources(contentBlocks: unknown[] | undefined): NewsResult[] {
  if (!Array.isArray(contentBlocks)) return [];
  const out: NewsResult[] = [];
  const seen = new Set<string>();
  for (const block of contentBlocks) {
    if (
      !block ||
      typeof block !== "object" ||
      (block as { type?: unknown }).type !== "web_search_tool_result"
    ) {
      continue;
    }
    const content = (block as { content?: unknown }).content;
    // Erro = objeto ({error_code}); só LISTA é sucesso. Branch ANTES de iterar.
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const title = (item as { title?: unknown }).title;
      const url = (item as { url?: unknown }).url;
      if (typeof title !== "string" || title.trim() === "") continue;
      if (typeof url !== "string") continue;
      const cleanUrl = url.trim();
      // Só http(s): a url vira <a href> na UI, então dropamos esquemas perigosos/
      // estranhos (javascript:, data:, mailto:, //protocol-relative, …). Espelha o
      // urlSchema do avatar em app/actions/profile.ts (report 01 achado #5). Cobre
      // também a url vazia (trim === "" não casa o regex).
      if (!/^https?:\/\//i.test(cleanUrl)) continue;
      if (seen.has(cleanUrl)) continue;
      seen.add(cleanUrl);
      out.push({ title: title.trim(), url: cleanUrl });
      if (out.length >= MAX_RESULTS) return out;
    }
  }
  return out;
}

export async function getNewsByMatchViaWebSearch(
  ctx: NewsMatchContext,
  // userId/matchId só pra logar o ai_call de auditoria (mesma fronteira do generatePalpites).
  audit: NewsAuditContext,
): Promise<NewsFetchOutcome> {
  const model = MODEL_REGISTRY[NEWS_MODEL_ID];
  const provider = getProviderForModel(model);
  const providerKey = provider.providerKey;
  // News só roteia pra Anthropic (Haiku do registry). Narrow pro AIProviderKey fechado
  // (persistAiCallError exige); um provider desconhecido aqui é bug de config — throw.
  if (!isAIProvider(providerKey)) {
    throw new NewsUnavailableError(
      `unknown AI provider '${providerKey}' for news model ${model.id}`,
      { provider: providerKey, model: model.id },
    );
  }

  // Key-gated/inerte (mirror SportMonks/#227): sem chave Anthropic → unavailable:true,
  // ZERO gasto. Loga um provider_error de auditoria (não throw) e devolve [].
  const analysisRequest: AnalysisRequest = {
    model,
    system: SYSTEM_PROMPT,
    userMessage: buildUserMessage(ctx),
    // tool/toolName são REQUIRED no shape mas IGNORADOS no modo server-tool (sem submit
    // forçado). Passamos placeholders válidos; o adapter monta a web search tool.
    tool: { name: "news_noop", inputSchema: { type: "object" } },
    toolName: "news_noop",
    maxTokens: NEWS_MAX_TOKENS,
    temperature: model.temperature,
    serverTool: {
      kind: "web_search",
      allowedDomains: [...ALLOWED_DOMAINS],
      maxUses: NEWS_MAX_SEARCH_USES,
    },
  };

  if (!provider.hasKey()) {
    const noKeyMsg = `${providerKey} provider has no API key configured (news unavailable)`;
    await persistAiCallError({
      userId: audit.userId,
      matchId: audit.matchId,
      provider: providerKey,
      model: model.id,
      inputPayload: analysisRequest as unknown as Record<string, unknown>,
      outputPayload: { error: noKeyMsg },
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      status: "provider_error",
      errorMessage: noKeyMsg,
      promptVersion: NEWS_PROMPT_VERSION,
    });
    return { results: [], aiCall: null, unavailable: true };
  }

  const result = await provider.runAnalysis(analysisRequest);

  // Erro do provider → loga (auditado) e degrada gracioso (results:[], unavailable:false).
  // NUNCA throw: o palpite embarca sem notícias (mirror absences).
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
      promptVersion: NEWS_PROMPT_VERSION,
    });
    return { results: [], aiCall: null, unavailable: false };
  }

  const sources = extractSources(result.contentBlocks);

  // Loga o ai_call (status ok). costUsd = SÓ tokens (calculateCost keya o registry); a
  // taxa de ~$0,01/busca da web search NÃO entra aqui — é metered out-of-band (ADR 0032
  // §4 / CLAUDE.md). Swallow do insert que falha (mirror generatePalpites 12a): o
  // resultado SOBREVIVE à falha do log de auditoria.
  const cost = calculateCost({
    model: model.id,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  });
  let aiCallId: string | null = null;
  try {
    const [row] = await db
      .insert(aiCalls)
      .values({
        userId: audit.userId,
        matchId: audit.matchId,
        provider: providerKey,
        model: model.id,
        promptVersion: NEWS_PROMPT_VERSION,
        inputPayload: result.inputPayload,
        outputPayload: result.outputPayload,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        latencyMs: result.latencyMs,
        costUsd: cost.toFixed(6),
        status: "ok",
        errorMessage: null,
      })
      .returning({ id: aiCalls.id });
    aiCallId = row.id;
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "getNewsByMatchViaWebSearch",
        matchId: audit.matchId,
        error: "news_ai_call_insert_failed",
        ...extractDbCause(err),
      }),
    );
  }

  return {
    results: sources,
    aiCall: aiCallId ? { id: aiCallId } : null,
    unavailable: false,
  };
}
