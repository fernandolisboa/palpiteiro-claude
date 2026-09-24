"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { notAnalyzableMessage } from "./not-analyzable";
import { auth } from "@/auth";
import {
  MAX_ADDITIONAL_FETCHES,
  MAX_FANOUT_MARKETS,
  capCandidates,
  runFanOut,
  type FanOutMarket,
} from "@/lib/ai/best-bet";
import { getCartridge } from "@/lib/ai/markets/registry";
import { isModelAllowedForAudience, type AIModelId } from "@/lib/ai/models";
import { generatePalpites } from "@/lib/ai/palpites";
import { summarizeAnalysesForSynthesis } from "@/lib/ai/palpites/synthesis-input";
import { PredictError, predict } from "@/lib/ai/predict";
import { isEmailAllowed } from "@/lib/auth/whitelist";
import {
  getEnableBestBetFanOut,
  getEnableOverUnderExtraLines,
} from "@/lib/db/queries/ai-config";
import { extractDbCause } from "@/lib/db/pg-error";
import {
  marketsForAudience,
  marketsForLeague,
} from "@/lib/db/queries/market-catalog";
import { getMatchById } from "@/lib/db/queries/matches";
import {
  getAiCallById,
  getLatestPredictionForPin,
} from "@/lib/db/queries/predictions";
import { getUserAccessState } from "@/lib/db/queries/users";
import { getDescriptor } from "@/lib/odds/market-descriptor";
import { ensureOddsSnapshotsFresh } from "@/lib/odds/fetch-and-snapshot";
import { checkAnalysisRateLimit, type RateLimitResult } from "@/lib/rate-limit";
import { getRequestTimeZone } from "@/lib/server/request-timezone";
import { toAnalysisView } from "@/lib/view/analysis";
import { ExactScoreParamsSchema } from "@/lib/ai/palpites/cartridges/cartridge";
import { toBestBetView } from "@/lib/view/best-bet";
import { toGradeMyBetView } from "@/lib/view/grade-my-bet";
import { GradeMyBetInputSchema } from "@/lib/view/grade-my-bet-input";
import {
  toDimensionViews,
  toPalpiteHeadlineView,
  type PalpiteHeadlineView,
} from "@/lib/view/palpites-headline";
import type {
  AnalysisView,
  BestBetView,
  GradeMyBetView,
} from "@/lib/view/types";

export type AnalyzeMatchResult =
  | { ok: true; view: AnalysisView }
  | { ok: false; error: string };

function friendlyMessage(err: PredictError): string {
  // PredictError.context contém detalhes técnicos; aqui mapeamos mensagens
  // conhecidas pra UI sem vazar implementação.
  const msg = err.message.toLowerCase();
  if (msg.includes("match not found")) {
    return "Jogo não encontrado.";
  }
  if (msg.includes("match is not analyzable")) {
    // Race: o status pode ter virado live/postponed — OU o jogo apitou e o enum
    // segue stale `scheduled` (#385) — entre o guard da action e o gate de
    // predict(). Usa o `status` + `kickoffMs` anexados ao context (predict.ts) pra
    // escolher a copy certa (em-andamento p/ scheduled-já-apitado, não "encerrado").
    const status =
      typeof err.context.status === "string" ? err.context.status : "";
    const kickoffAt =
      typeof err.context.kickoffMs === "number"
        ? new Date(err.context.kickoffMs)
        : undefined;
    return (
      notAnalyzableMessage(status, kickoffAt) ??
      "Este jogo já foi encerrado ou cancelado."
    );
  }
  if (msg.includes("no matching odds")) {
    return "Sem odds publicadas para este jogo no momento.";
  }
  if (msg.includes("no over/under 2.5 odds")) {
    return "Nenhum bookmaker oferece over/under 2.5 para este jogo.";
  }
  // Mercado *additional* (btts) sem snapshot fresco = o pre-warm por evento não
  // achou book ofertando o mercado pra este jogo (degradou sem escrever).
  if (msg.includes("sem snapshot fresco")) {
    return "Nenhum bookmaker oferece este mercado para o jogo no momento.";
  }
  if (msg.includes("fixture not found in provider")) {
    return "Dados do jogo indisponíveis no provider esportivo.";
  }
  if (msg.includes("standings row missing")) {
    return "Dados de classificação indisponíveis pra esta análise.";
  }
  if (msg.includes("zod validation")) {
    return "A resposta do modelo não passou na validação. Nenhum custo cobrado.";
  }
  return "Falha temporária ao gerar análise. Tente novamente.";
}

export async function analyzeMatch(
  _prev: AnalyzeMatchResult | null,
  formData: FormData,
): Promise<AnalyzeMatchResult> {
  const matchId = String(formData.get("matchId") ?? "");
  if (!matchId) {
    return { ok: false, error: "matchId ausente" };
  }
  if (!z.uuid().safeParse(matchId).success) {
    return { ok: false, error: "Identificador de jogo inválido." };
  }
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Faça login para analisar." };
  }
  // Guarda load-bearing de custo/abuso (#264, ADR 0023): leitura DIRETA do DB de
  // `allowed` ANTES de qualquer chamada paga ao Anthropic — independente da
  // frescura do JWT (que pode estar stale). `null` = row sumiu (reset +
  // claim-admin com cookie velho): recusa a sessão órfã antes do custo (senão a
  // FK ai_calls_user_id_users_id_fk estoura pós-gasto).
  const access = await getUserAccessState(session.user.id);
  if (!access) {
    return { ok: false, error: "Sua sessão expirou. Faça login novamente." };
  }
  // Compõe com o floor do env ANTES de decidir (ADR 0023 §3/§6, mesma semântica
  // de `isSignInAllowed`): um e-mail no floor do env é
  // permitido MESMO com `allowed=false` no DB. Um read cru de `allowed` trancaria
  // o dono/admin do floor (cuja row pode ser `allowed=false`) do próprio app — o
  // auto-lockout que a §6 promete impossível. Bloqueio só morde quem NÃO está no
  // floor e tem `allowed=false`.
  if (!access.allowed && !isEmailAllowed(session.user.email)) {
    return {
      ok: false,
      error: "Seu acesso está bloqueado. Fale com o administrador.",
    };
  }
  // Teto diário por usuário (Upstash Ratelimit via Vercel KV): recusa ANTES de
  // qualquer chamada paga ao Anthropic. Admin tem limite separado/maior. Sem KV
  // configurado, o fallback é por role — admin fail-open, não-admin fail-closed
  // (ADR 0023) — ver lib/rate-limit.ts.
  const rateLimit = await checkAnalysisRateLimit(
    session.user.id,
    session.user.role,
  );
  if (!rateLimit.ok) {
    // reason:"fail-closed" = KV ausente p/ não-admin, não um teto real atingido:
    // a copy de "limite de 0 análises" seria enganosa. Discriminador explícito
    // (não `limit === 0`) pra um limit:0 legítimo do Upstash nunca a disparar.
    if (rateLimit.reason === "fail-closed") {
      return {
        ok: false,
        error: "Análises temporariamente indisponíveis. Tente mais tarde.",
      };
    }
    return {
      ok: false,
      error: `Você atingiu o limite de ${rateLimit.limit} análises por dia. Tente novamente amanhã.`,
    };
  }
  // Override de modelo por análise, gateado por AUDIÊNCIA (ADR 0013) e revalidado
  // aqui (server actions são POST chamáveis fora do layout): usuário comum só
  // pode escolher modelos userSelectable; admin enxerga todos.
  // "default"/inválido/fora-da-audiência → cai no default global (sem erro).
  // Defense-in-depth além de esconder o seletor/limitar a lista na UI.
  const isAdmin = session.user.role === "admin";
  const overrideRaw = String(formData.get("modelOverride") ?? "");
  let modelOverride: AIModelId | undefined;
  if (
    overrideRaw &&
    overrideRaw !== "default" &&
    isModelAllowedForAudience(overrideRaw, isAdmin)
  ) {
    modelOverride = overrideRaw;
  }
  // Mercado a analisar, gateado por AUDIÊNCIA (ADR 0017) e re-validado AQUI
  // (server actions são POST chamáveis fora do layout): usuário comum só pode
  // escolher mercados graduados; admin enxerga também os ativos-não-graduados
  // (match_result hoje). Um `marketKey` ausente/inválido/fora-da-audiência cai no
  // default over_under (sem erro) — defesa-em-profundidade além de esconder/limitar
  // o seletor na UI. NUNCA gateado em predict.ts (ADR 0017).
  // O match é carregado AQUI (não só em predict) porque o gate de cobertura de liga
  // (#158) precisa de `match.league` ANTES da coerção do marketKey + da chamada paga.
  // Read barato vs LLM pago. predict() re-valida match/analisabilidade depois.
  const match = await getMatchById(matchId);
  if (!match) {
    return { ok: false, error: "Jogo não encontrado." };
  }
  // Analisabilidade ANTES do pre-warm de odds (#174 code review): um jogo
  // não-`scheduled` (encerrado/cancelado/ao vivo/adiado) faria o pre-warm por
  // evento gastar 1 crédito (additional) só pra o predict lançar depois.
  // Curto-circuita aqui (status já em escopo, read grátis), market-agnóstico —
  // espelha o gate de predict.ts.
  const notAnalyzable = notAnalyzableMessage(match.status, match.kickoffAt);
  if (notAnalyzable) {
    return { ok: false, error: notAnalyzable };
  }
  const marketKeyRaw = String(formData.get("marketKey") ?? "");
  // Audiência ∩ cobertura de liga (#158): um POST forjado com `marketKey=btts` numa
  // liga sem cobertura (ex.: brasileirao) é coercido a over_under ANTES de gastar.
  const allowedMarkets = marketsForLeague(
    await marketsForAudience(isAdmin),
    match.league,
  );
  const marketKey = allowedMarkets.some((m) => m.key === marketKeyRaw)
    ? marketKeyRaw
    : "over_under";
  // Linhas extras de over/under (#175): flag global (ai_config) ∩ cobertura da
  // variante multi-linha pra a liga deste match. getCartridge({extraLines}) devolve a
  // variante onde existir (over_under → v3); `candidateLines` a distingue da base e
  // `coveredLeagues` (data-driven, como btts/dc) restringe às ligas validadas. Liga
  // sem cobertura → extraLines=false → caminho featured 2.5 (graceful). Sem literal
  // de mercado: mercados sem variante caem na base mesmo com a flag ligada.
  const extraLinesEnabled = await getEnableOverUnderExtraLines();
  const variantDescriptor = getCartridge(marketKey, {
    extraLines: extraLinesEnabled,
  }).descriptor;
  const extraLines =
    extraLinesEnabled &&
    variantDescriptor.candidateLines !== undefined &&
    (variantDescriptor.coveredLeagues === undefined ||
      variantDescriptor.coveredLeagues.includes(match.league));
  try {
    // Mercado *additional* (btts/dupla chance OU over_under multi-linha sob flag):
    // pré-aquece a snapshot por evento (lazy, 1 crédito, deduplicado pelo gate de
    // frescor) ANTES do predict, pra o caminho de reuso fresco sempre acertar (predict
    // nunca batcheia additional). O descriptor EFETIVO sai de getCartridge(extraLines)
    // — over_under multi-linha vira additional (alternate_totals). Data-driven por
    // oddsSource, nunca `if (market==='btts')`.
    const effectiveDescriptor = getCartridge(marketKey, {
      extraLines,
    }).descriptor;
    if (effectiveDescriptor.oddsSource === "additional") {
      await ensureOddsSnapshotsFresh(match, {
        markets: [effectiveDescriptor],
      });
    }
    // predict() retorna o carrier N-vias { prediction, marketKey, selections }. O
    // marketKey RESOLVIDO + o candidate set alimentam a view N-vias (1X2 → grade
    // de 3) — síncrono, antes de qualquer re-query.
    const { prediction, marketKey: resolvedMarketKey, selections } =
      await predict({
        matchId,
        userId: session.user.id,
        isAdmin,
        modelOverride,
        marketKey,
        extraLines,
      });
    const aiCall = await getAiCallById(prediction.aiCallId);
    // Fuso do usuário (#1) pro "gerado em" da view fresca retornada ao cliente.
    const timeZone = await getRequestTimeZone();
    revalidatePath(`/match/${matchId}`);
    revalidatePath("/jogos");
    return {
      ok: true,
      view: toAnalysisView(
        {
          recommendation: prediction.recommendation,
          confidencePct: prediction.confidencePct,
          rationale: prediction.rationale,
          keyFactors: prediction.keyFactors,
          minimumOdd: prediction.minimumOdd,
          oddAtRecommendation: prediction.oddAtRecommendation,
          bookmaker: prediction.bookmaker,
          impliedProbPct: prediction.impliedProbPct,
          edgePct: prediction.edgePct,
          modelVersion: prediction.modelVersion,
          promptVersion: prediction.promptVersion,
          createdAt: prediction.createdAt,
          // Fiação multi-mercado (#170/#173): marketKey RESOLVIDO por predict()
          // (não o literal 'over_under'); `line` da forma do mercado salva (null em
          // 1X2); stake da row recém-gravada; candidate set N-vias retornado por
          // predict() → grade de 3 colunas em 1X2 (toAnalysisView ramifica).
          marketKey: resolvedMarketKey,
          line: prediction.marketParams?.line ?? null,
          stakeUnits: prediction.stakeUnits,
          selections,
        },
        aiCall ? { costUsd: aiCall.costUsd } : null,
        new Date(),
        timeZone,
      ),
    };
  } catch (err) {
    if (err instanceof PredictError) {
      console.error(
        JSON.stringify({
          scope: "analyzeMatch",
          matchId,
          error: "predict_failed",
          message: err.message,
          context: err.context,
        }),
      );
      return { ok: false, error: friendlyMessage(err) };
    }
    const dbCause = extractDbCause(err);
    console.error(
      JSON.stringify({
        scope: "analyzeMatch",
        matchId,
        error: "unexpected",
        message: err instanceof Error ? err.message : String(err),
        pgCode: dbCause.code,
        constraint: dbCause.constraint,
        detail: dbCause.detail,
        table: dbCause.table,
        column: dbCause.column,
      }),
    );
    return {
      ok: false,
      error: "Falha temporária ao gerar análise. Tente novamente.",
    };
  }
}

// ─── Modo "melhor aposta do jogo" (#178) ─────────────────────────────────────

export type AnalyzeBestBetResult =
  | { ok: true; view: BestBetView; palpite: PalpiteHeadlineView | null }
  | { ok: false; error: string };

// Mapeia QUALQUER erro pra mensagem amigável de UI. PredictError reusa o
// friendlyMessage; o resto (inesperado: DB etc.) cai numa cópia genérica. Fica
// server-side (passado pro orquestrador e pro pré-warm) — nunca vaza pro cliente.
function friendlyMessageFromUnknown(err: unknown): string {
  if (err instanceof PredictError) return friendlyMessage(err);
  return "Falha temporária ao gerar análise. Tente novamente.";
}

// Resolve extraLines pra UM mercado — port VERBATIM do bloco inline do analyzeMatch
// (L166-174), sem reler a flag (vem por parâmetro). Descriptor-driven, SEM literal de
// mercado: getCartridge(extraLines) devolve a variante onde existir (over_under→v3),
// `candidateLines` a distingue da base, `coveredLeagues` restringe às ligas validadas.
// analyzeMatch NÃO adota este helper neste PR (mantém o single-market intocado/golden).
function resolveExtraLines(
  marketKey: string,
  league: string,
  flagEnabled: boolean,
): boolean {
  const d = getCartridge(marketKey, { extraLines: flagEnabled }).descriptor;
  return (
    flagEnabled &&
    d.candidateLines !== undefined &&
    (d.coveredLeagues === undefined ||
      d.coveredLeagues.some((l) => l === league))
  );
}

/**
 * Fan-out cross-mercado: analisa TODOS os mercados ativos do jogo (audiência ∩ liga),
 * uma predição REAL por mercado (cada uma logada em ai_calls), ranqueadas no cliente.
 *
 * Ordem dos gates é LOAD-BEARING: TODOS os gates grátis (auth, acesso, flag re-check, jogo,
 * analisabilidade, candidatos-vazios) vêm ANTES do 1º checkAnalysisRateLimit (que INCREMENTA
 * o contador — é consumo, não leitura), pra um POST flag-off ou um jogo sem mercado NUNCA
 * queimar um slot diário. Rate-limit é o ÚLTIMO gate antes do spend e cobra 1 slot POR
 * mercado (#492), como o analyzeMarkets. Best-of-successful: 1 mercado falho não derruba o run.
 */
export async function analyzeBestBet(
  _prev: AnalyzeBestBetResult | null,
  formData: FormData,
): Promise<AnalyzeBestBetResult> {
  const matchId = String(formData.get("matchId") ?? "");
  if (!matchId) {
    return { ok: false, error: "matchId ausente" };
  }
  if (!z.uuid().safeParse(matchId).success) {
    return { ok: false, error: "Identificador de jogo inválido." };
  }
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Faça login para analisar." };
  }
  const access = await getUserAccessState(session.user.id);
  if (!access) {
    return { ok: false, error: "Sua sessão expirou. Faça login novamente." };
  }
  // Compõe com o floor do env (ADR 0023 §3/§6, #276): um e-mail no floor é permitido
  // mesmo com `allowed=false` no DB — espelha o gate do analyzeMatch.
  if (!access.allowed && !isEmailAllowed(session.user.email)) {
    return {
      ok: false,
      error: "Seu acesso está bloqueado. Fale com o administrador.",
    };
  }
  // Flag re-check server-side ANTES de qualquer spend E antes do incremento do
  // rate-limit (server actions são POST chamáveis fora do layout): flag-off = recurso
  // indisponível, sem queimar slot.
  const bestBetEnabled = await getEnableBestBetFanOut();
  if (!bestBetEnabled) {
    return { ok: false, error: "Recurso indisponível." };
  }
  const match = await getMatchById(matchId);
  if (!match) {
    return { ok: false, error: "Jogo não encontrado." };
  }
  const notAnalyzable = notAnalyzableMessage(match.status, match.kickoffAt);
  if (notAnalyzable) {
    return { ok: false, error: notAnalyzable };
  }
  const isAdmin = session.user.role === "admin";
  const overrideRaw = String(formData.get("modelOverride") ?? "");
  let modelOverride: AIModelId | undefined;
  if (
    overrideRaw &&
    overrideRaw !== "default" &&
    isModelAllowedForAudience(overrideRaw, isAdmin)
  ) {
    modelOverride = overrideRaw;
  }
  // Candidatos = audiência ∩ cobertura de liga (a MESMA expressão do analyzeMatch +
  // page.tsx). Cap retendo Tier-1 (over/under + 1X2) p/ teto de LLM calls.
  const candidates = capCandidates(
    marketsForLeague(await marketsForAudience(isAdmin), match.league),
    MAX_FANOUT_MARKETS,
  );
  if (candidates.length === 0) {
    return { ok: false, error: "Nenhum mercado disponível para este jogo." };
  }
  // Linhas extras (#175): flag SEPARADA (enable_over_under_extra_lines), NÃO a do
  // best-bet. Leitura grátis → ANTES do 1º slot. Resolvida UMA vez por mercado no
  // FanOutMarket — o MESMO valor alimenta o pré-warm e o predict (senão predict
  // resolveria um cartucho diferente do aquecido).
  const extraLinesEnabled = await getEnableOverUnderExtraLines();
  // Rate-limit POR MERCADO (N slots, #492 / Report 01 #3): 1 slot por candidato, em ordem,
  // ANTES do spend — mesma disciplina do analyzeMarkets. checkAnalysisRateLimit incrementa
  // 1/call (sem count param), então N chamadas = N slots. Para no 1º não-ok pra não queimar
  // slots além do teto. `granted` é sempre um PREFIXO de `candidates` → `candidates.slice(
  // granted.length)` é a cauda exata sem slot. Invariante de spend: slots consumidos ==
  // granted.length == mercados no runFanOut == predict() pagos. extraLines é resolvido POR
  // mercado (flag do cartucho), nunca vira mercado extra → não cobra slot a mais.
  //
  // Budget parcial: DEGRADA como o analyzeMarkets (roda os concedidos, a cauda vira
  // "indisponível" na view) em vez de recusar. Seguro pra semântica de "melhor aposta": o
  // rank é por-entry (independente dos irmãos) e o painel já é best-of-successful — um
  // mercado não analisado aparece em "Mercados indisponíveis" com o motivo, então o "melhor"
  // fica explicitamente limitado aos analisados. A ordem de `candidates` (marketsForAudience,
  // capCandidates Tier-1-first) faz over/under + 1X2 serem os primeiros concedidos.
  const granted: typeof candidates = [];
  let capRl: RateLimitResult | null = null;
  for (const c of candidates) {
    const rl = await checkAnalysisRateLimit(session.user.id, session.user.role);
    if (rl.ok) {
      granted.push(c);
      continue;
    }
    if (rl.reason === "fail-closed") {
      // KV ausente p/ não-admin: indisponível (não um teto real). Aborta o run inteiro
      // ANTES de qualquer spend (fail-closed só ocorre na 1ª call: sem KV não há limiter).
      return {
        ok: false,
        error: "Análises temporariamente indisponíveis. Tente mais tarde.",
      };
    }
    // Teto real atingido: para de consumir; este + a cauda ficam sem análise.
    capRl = rl;
    break;
  }
  if (granted.length === 0) {
    // capRl SEMPRE setado aqui: fail-closed já retornou; granted vazio só por cap na 1ª call.
    return {
      ok: false,
      error: `Você atingiu o limite de ${capRl?.limit ?? 0} análises por dia. Tente novamente amanhã.`,
    };
  }
  const rateLimitedErrors = candidates.slice(granted.length).map((c) => ({
    marketKey: c.key,
    message: "Limite diário atingido — não analisado.",
  }));
  // FanOut só sobre os CONCEDIDOS → nenhum predict() nem crédito de odds num mercado sem slot.
  const fanOut: FanOutMarket[] = granted.map((c) => ({
    marketKey: c.key,
    extraLines: resolveExtraLines(c.key, match.league, extraLinesEnabled),
  }));
  // Pré-aquece os mercados *additional* (btts/dupla chance/over_under multi-linha): o
  // descriptor EFETIVO sai do MESMO m.extraLines do FanOutMarket. Cada um numa chamada
  // própria (ensureOddsSnapshotsFresh hard-throws em seed faltante) → a falha de um vira
  // erro POR mercado, sem abortar os irmãos. Teto de créditos additional/run.
  const additional = fanOut
    .map((m) => ({
      marketKey: m.marketKey,
      descriptor: getCartridge(m.marketKey, { extraLines: m.extraLines })
        .descriptor,
    }))
    .filter((x) => x.descriptor.oddsSource === "additional");
  // Teto de créditos: nunca pré-aquece mais que MAX_ADDITIONAL_FETCHES. Um mercado
  // cortado aqui CONTINUA no fanOut → runFanOut chama predict() pra ele, mas predict
  // lança "sem snapshot fresco" ANTES da chamada Anthropic (sem gasto de LLM nem
  // crédito). Hoje inalcançável (WC tem ≤3 additional); move junto com MAX_FANOUT_MARKETS.
  const additionalToFetch =
    additional.length > MAX_ADDITIONAL_FETCHES
      ? additional.slice(0, MAX_ADDITIONAL_FETCHES)
      : additional;
  console.info(
    JSON.stringify({
      scope: "analyzeBestBet",
      matchId,
      candidates: candidates.length,
      granted: granted.length,
      rateLimited: rateLimitedErrors.length,
      additionalFetches: additionalToFetch.length,
    }),
  );
  const preWarmErrors: { marketKey: string; message: string }[] = [];
  for (const { marketKey: mk, descriptor } of additionalToFetch) {
    try {
      await ensureOddsSnapshotsFresh(match, { markets: [descriptor] });
    } catch (err) {
      preWarmErrors.push({
        marketKey: mk,
        message: friendlyMessageFromUnknown(err),
      });
    }
  }
  // Fan-out SERIAL: predict() por mercado concedido (a única porta pro LLM), best-of-successful.
  const outcomes = await runFanOut(
    { matchId, userId: session.user.id, isAdmin, modelOverride },
    fanOut,
    friendlyMessageFromUnknown,
  );
  // Custo por análise bem-sucedida (lê a aiCall pra exibir).
  const aiCallByMarketKey = new Map<
    string,
    { costUsd: string | number } | null
  >();
  for (const o of outcomes) {
    if (o.ok) {
      const aiCall = await getAiCallById(o.result.prediction.aiCallId);
      aiCallByMarketKey.set(
        o.marketKey,
        aiCall ? { costUsd: aiCall.costUsd } : null,
      );
    }
  }
  const view = toBestBetView(
    outcomes,
    aiCallByMarketKey,
    preWarmErrors,
    rateLimitedErrors,
  );
  if (view.entries.length === 0) {
    // Todos falharam → estado de erro (espelha o total-failure do analyzeMatch), NÃO um
    // sucesso vazio. O run pode ter pago ≤N calls pós-Anthropic + N slots — surge como erro.
    return {
      ok: false,
      error: view.errors[0]?.message ?? "Nenhum mercado pôde ser analisado.",
    };
  }
  // PASSO DE SÍNTESE (ADR 0030 / #353): turna as N análises numa manchete. Roda DENTRO
  // do mesmo run (sem slot próprio — ver Report 01 #3), sobre o FanOutOutcome[] EM MEMÓRIA — sem
  // re-query. Haiku (default do gerador). NULLABLE é LOAD-BEARING: a síntese roda DEPOIS
  // de até 6 predict() PAGOS; se ela falhar (Haiku throw, value-leak, …), o fan-out pago
  // NÃO pode ser descartado → log + palpite:null. Espelha a assimetria do generator (o
  // log de ai_call pode falhar sem afundar o produto).
  let palpite: PalpiteHeadlineView | null = null;
  try {
    const summaries = summarizeAnalysesForSynthesis(outcomes);
    const result = await generatePalpites({
      matchId,
      userId: session.user.id,
      analyses: summaries,
      modelOverride: "claude-haiku-4-5",
    });
    // As linhas settleable recém-gravadas estão TODAS pendentes (sem outcome) → badge
    // null. NARROW-not-cast (#354 / blocker §3.2): `params` é a union larga do jsonb;
    // estreitamos via ExactScoreParamsSchema.safeParse (prefer-skip: params ruins →
    // manchete null em vez de render quebrado). As dimensões (margin/clean_sheet/…) vêm
    // do MESMO helper que o reload (toDimensionViews) sobre as rows em memória com
    // outcome=null → fresh == reload, sem glitch de sumir-no-fresh-aparecer-no-reload.
    const scoreLine = result.palpites.find((p) => p.type === "exact_score");
    const ps = scoreLine?.params
      ? ExactScoreParamsSchema.safeParse(scoreLine.params)
      : null;
    if (result.palpiteSet.headline && ps?.success) {
      const linesWithPendingOutcome = result.palpites.map((p) => ({
        ...p,
        outcome: null,
      }));
      palpite = toPalpiteHeadlineView({
        headline: result.palpiteSet.headline,
        probableScore: ps.data,
        outcome: null,
        dimensions: toDimensionViews(linesWithPendingOutcome),
      });
    }
  } catch (err) {
    // Síntese falhou: o fan-out pago SOBREVIVE (view retorna), só a manchete some.
    console.error(
      JSON.stringify({
        scope: "analyzeBestBet",
        matchId,
        error: "synthesis_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
  revalidatePath(`/match/${matchId}`);
  revalidatePath("/jogos");
  return { ok: true, view, palpite };
}

// ─── Análise multi-mercado SELECIONADA pelo usuário (#245) ────────────────────

export type MarketRunStatus = "ok" | "failed" | "rate-limited";

export type MarketRunSummaryItem = {
  marketKey: string;
  marketLabel: string; // label do allowlist server-side, NUNCA do POST
  status: MarketRunStatus;
  message?: string; // failed | rate-limited
};

export type AnalyzeMarketsResult =
  | { ok: true; summaries: MarketRunSummaryItem[] }
  | { ok: false; error: string };

/**
 * Fan-out multi-mercado ESCOLHIDO PELO USUÁRIO (#245) — distinto do analyzeBestBet (#178,
 * fan-out AUTOMÁTICO + best-edge). Aqui o usuário marca QUAIS mercados; TODOS os escolhidos são
 * analisados (sem "melhor" pick), cada um vira sua predição + ai_call (custo por mercado) e
 * aterrissa na sua seção colapsável (#243) via revalidatePath → toMarketAnalysisSections.
 *
 * DINHEIRO REAL: N mercados = N predict() pagos. Como o analyzeBestBet (#492), o rate-limit é
 * cobrado POR MERCADO (N slots) — o AC do #245 exige que
 * custo/rate-limit reflitam N análises. checkAnalysisRateLimit incrementa 1/call (sem count
 * param), então creditamos N chamando-o 1× por mercado, ANTES do spend, parando no 1º não-ok
 * (degrada com graça: os concedidos rodam, a cauda vira "rate-limited"). Spend de pior caso =
 * min(remaining, MAX_FANOUT_MARKETS) chamadas pagas.
 *
 * Ordem dos gates é LOAD-BEARING (igual aos irmãos): TODOS os gates grátis (auth, acesso, jogo,
 * analisabilidade, allowlist de mercado) vêm ANTES do 1º checkAnalysisRateLimit (que CONSOME
 * slot), pra um POST forjado/vazio NUNCA queimar um slot diário.
 */
export async function analyzeMarkets(
  _prev: AnalyzeMarketsResult | null,
  formData: FormData,
): Promise<AnalyzeMarketsResult> {
  const matchId = String(formData.get("matchId") ?? "");
  if (!matchId) {
    return { ok: false, error: "matchId ausente" };
  }
  if (!z.uuid().safeParse(matchId).success) {
    return { ok: false, error: "Identificador de jogo inválido." };
  }
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Faça login para analisar." };
  }
  const access = await getUserAccessState(session.user.id);
  if (!access) {
    return { ok: false, error: "Sua sessão expirou. Faça login novamente." };
  }
  if (!access.allowed && !isEmailAllowed(session.user.email)) {
    return {
      ok: false,
      error: "Seu acesso está bloqueado. Fale com o administrador.",
    };
  }
  const match = await getMatchById(matchId);
  if (!match) {
    return { ok: false, error: "Jogo não encontrado." };
  }
  const notAnalyzable = notAnalyzableMessage(match.status, match.kickoffAt);
  if (notAnalyzable) {
    return { ok: false, error: notAnalyzable };
  }
  const isAdmin = session.user.role === "admin";
  const overrideRaw = String(formData.get("modelOverride") ?? "");
  let modelOverride: AIModelId | undefined;
  if (
    overrideRaw &&
    overrideRaw !== "default" &&
    isModelAllowedForAudience(overrideRaw, isAdmin)
  ) {
    modelOverride = overrideRaw;
  }
  // Allowlist server-side: audiência ∩ cobertura de liga (MESMA expressão de analyzeMatch e
  // page.tsx). A seleção do POST é re-validada contra ESTA lista — nunca confiar no cliente.
  const allowed = marketsForLeague(
    await marketsForAudience(isAdmin),
    match.league,
  );
  // Seleção do usuário (N hidden inputs name="marketKeys" → getAll), dedupada e re-validada.
  // `chosen` preserva {key,label} do SERVER (não do POST). Ordem = a de `allowed`
  // (`marketsForAudience`: over_under primeiro = base de exibição do sumário); sob o cap
  // `capCandidates` re-particiona Tier-1-first, mas over_under é Tier-1 → segue 1º (e o cap é
  // inalcançável hoje: só 4 descriptors). Um marketKey forjado fora da audiência/liga é dropado
  // aqui (sem gastar slot); duplicatas colapsam.
  const requested = new Set(formData.getAll("marketKeys").map((v) => String(v)));
  const chosen = capCandidates(
    allowed.filter((m) => requested.has(m.key)),
    MAX_FANOUT_MARKETS,
  );
  if (chosen.length === 0) {
    return { ok: false, error: "Nenhum mercado válido selecionado." };
  }
  // Rate-limit POR MERCADO (N slots): 1 slot por mercado, em ordem, ANTES do spend. Para no 1º
  // não-ok pra não queimar slots além do teto. `granted` é sempre um PREFIXO de `chosen`
  // (quebramos no 1º não-ok) → `chosen.slice(granted.length)` é a cauda exata de rate-limited.
  // Invariante de spend: slots consumidos == granted.length == mercados no runFanOut ==
  // chamadas predict(). capCandidates rodou ANTES do loop → N-selecionados-mas-capados nunca
  // sobre-cobram.
  const granted: { key: string; label: string }[] = [];
  let capRl: RateLimitResult | null = null;
  for (const c of chosen) {
    const rl = await checkAnalysisRateLimit(session.user.id, session.user.role);
    if (rl.ok) {
      granted.push(c);
      continue;
    }
    if (rl.reason === "fail-closed") {
      // KV ausente p/ não-admin: indisponível (não um teto real). Aborta o run inteiro ANTES de
      // qualquer spend — espelha o single-market analyzeMatch.
      return {
        ok: false,
        error: "Análises temporariamente indisponíveis. Tente mais tarde.",
      };
    }
    // Teto real atingido: para de consumir; este + a cauda viram rate-limited.
    capRl = rl;
    break;
  }
  const rateLimited = chosen.slice(granted.length);
  if (granted.length === 0) {
    // capRl SEMPRE setado aqui: fail-closed já retornou acima; granted vazio só por cap na 1ª call.
    return {
      ok: false,
      error: `Você atingiu o limite de ${capRl?.limit ?? 0} análises por dia. Tente novamente amanhã.`,
    };
  }
  // FanOut só sobre os CONCEDIDOS. extraLines resolvido 1× por mercado (mesmo valor alimenta o
  // pré-warm e o predict, senão predict resolveria um cartucho diferente do aquecido).
  const extraLinesEnabled = await getEnableOverUnderExtraLines();
  const fanOut: FanOutMarket[] = granted.map((c) => ({
    marketKey: c.key,
    extraLines: resolveExtraLines(c.key, match.league, extraLinesEnabled),
  }));
  // Pré-aquece os mercados *additional* (btts/dupla chance/over_under multi-linha) — bloco
  // DUPLICADO do analyzeBestBet de propósito: extrair um helper mudaria o console.info
  // (additionalFetches) do analyzeBestBet, path pago golden fora do escopo do #245. Só sobre os
  // CONCEDIDOS (nunca rate-limited) → nenhum crédito da The Odds API gasto num mercado que não
  // vai rodar. Cada um numa chamada própria; falha de um vira erro POR mercado (predict lança
  // "sem snapshot fresco" depois, sem custo de LLM), sem abortar os irmãos. Teto additional/run.
  const additionalDescriptors = fanOut
    .map((m) => getCartridge(m.marketKey, { extraLines: m.extraLines }).descriptor)
    .filter((d) => d.oddsSource === "additional");
  const additionalToFetch =
    additionalDescriptors.length > MAX_ADDITIONAL_FETCHES
      ? additionalDescriptors.slice(0, MAX_ADDITIONAL_FETCHES)
      : additionalDescriptors;
  console.info(
    JSON.stringify({
      scope: "analyzeMarkets",
      matchId,
      candidates: chosen.length,
      granted: granted.length,
      rateLimited: rateLimited.length,
      additionalFetches: additionalToFetch.length,
    }),
  );
  for (const descriptor of additionalToFetch) {
    try {
      await ensureOddsSnapshotsFresh(match, { markets: [descriptor] });
    } catch (err) {
      // Pré-warm falho → o mercado segue no fanOut; predict lança "sem snapshot fresco" ANTES do
      // Anthropic (sem custo) → vira `failed` no outcome com a copy amigável. Só logamos; o
      // outcome já reporta a falha por mercado (sem thread separado de pré-warm errors).
      console.warn(
        JSON.stringify({
          scope: "analyzeMarkets",
          matchId,
          preWarm: descriptor.providerMarketKey,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  // Fan-out SERIAL: predict() por mercado concedido (a única porta pro LLM), erro isolado por
  // mercado — NÃO best-of-successful (#245 mostra TODOS, sem ranking).
  const outcomes = await runFanOut(
    { matchId, userId: session.user.id, isAdmin, modelOverride },
    fanOut,
    friendlyMessageFromUnknown,
  );
  const labelByKey = new Map(chosen.map((c) => [c.key, c.label]));
  const summaries: MarketRunSummaryItem[] = [
    ...outcomes.map((o) =>
      o.ok
        ? {
            marketKey: o.marketKey,
            marketLabel: labelByKey.get(o.marketKey) ?? o.marketKey,
            status: "ok" as const,
          }
        : {
            marketKey: o.marketKey,
            marketLabel: labelByKey.get(o.marketKey) ?? o.marketKey,
            status: "failed" as const,
            message: o.message,
          },
    ),
    ...rateLimited.map((c) => ({
      marketKey: c.key,
      marketLabel: c.label,
      status: "rate-limited" as const,
      message: "Limite diário atingido — não analisado.",
    })),
  ];
  // ≥1 predict rodou (granted.length>0). Mesmo se TODOS falharem, mantemos ok:true com o detalhe
  // por-mercado (≠ analyzeBestBet, que vira ok:false em entries vazio): aqui já gastamos N slots
  // e o banner explica qual falhou — uma string de erro única perderia o detalhe. Nenhuma seção
  // nova aparece pros que falharam; revalidate é inócuo nesse caso.
  revalidatePath(`/match/${matchId}`);
  revalidatePath("/jogos");
  return { ok: true, summaries };
}

// ─── "Analise minha aposta" — leitor de valor selection-pinned (#412, ADR 0034) ──

export type GradeMyBetResult =
  | { ok: true; view: GradeMyBetView }
  | {
      ok: false;
      error: string;
      kind?: "rate-limited" | "input-invalido" | "nao-analisavel";
    };

/**
 * Avalia o VALOR de uma aposta FIXADA pelo usuário (mercado + seleção + linha + a
 * odd que ele pegou na casa) — variante selection-pinned do analyzeMatch (ADR 0034).
 * Cache-FIRST: lê a distribuição persistida (zero LLM, zero ai_calls); só no MISS
 * passa pelo rate-limit e chama predict() (a ÚNICA porta LLM). A fixação é 100% no
 * mapper (selections.find) — predict.ts NÃO é tocado, PredictArgs NÃO é estendido.
 *
 * GATES EM ORDEM EXATA (espelha analyzeMatch): matchId → auth → acesso → match →
 * não-analisável → ZOD (boundary barato, ANTES de qualquer DB read de predição) →
 * re-validação audiência∩liga + seleção (firewall POST forjado, SEM coerção) →
 * linha-modelável ANTES DE GASTAR → cache-first (HIT sem rate-limit; MISS:
 * rate-limit → predict). A ordem é load-bearing: nada que GASTE (rate-limit/predict)
 * roda antes de todos os gates grátis.
 */
export async function gradeMyBet(
  _prev: GradeMyBetResult | null,
  formData: FormData,
): Promise<GradeMyBetResult> {
  // 1. matchId.
  const matchId = String(formData.get("matchId") ?? "");
  if (!matchId) {
    return { ok: false, error: "matchId ausente" };
  }
  if (!z.uuid().safeParse(matchId).success) {
    return { ok: false, error: "Identificador de jogo inválido." };
  }
  // 2. auth.
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Faça login para analisar." };
  }
  // 3. acesso (DB direto + floor do env — espelha analyzeMatch).
  const access = await getUserAccessState(session.user.id);
  if (!access) {
    return { ok: false, error: "Sua sessão expirou. Faça login novamente." };
  }
  if (!access.allowed && !isEmailAllowed(session.user.email)) {
    return {
      ok: false,
      error: "Seu acesso está bloqueado. Fale com o administrador.",
    };
  }
  // 4. match (carrega liga p/ o gate de cobertura ANTES de gastar).
  const match = await getMatchById(matchId);
  if (!match) {
    return { ok: false, error: "Jogo não encontrado." };
  }
  // 5. analisabilidade (status≠scheduled / kickoff passado).
  const notAnalyzable = notAnalyzableMessage(match.status, match.kickoffAt);
  if (notAnalyzable) {
    return { ok: false, error: notAnalyzable, kind: "nao-analisavel" };
  }
  // 6. ZOD BOUNDARY (barato, ANTES de qualquer read de predição): odd parseada
  // (vírgula PT-BR) + > 1, linha coercida a number, mercado/seleção não-vazios.
  const parsed = GradeMyBetInputSchema.safeParse({
    marketKey: String(formData.get("marketKey") ?? ""),
    selectionKey: String(formData.get("selectionKey") ?? ""),
    line: formData.get("line") ?? undefined,
    odd: String(formData.get("odd") ?? ""),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: "Aposta inválida. Confira mercado, seleção, linha e a odd (> 1).",
      kind: "input-invalido",
    };
  }
  const { marketKey, selectionKey, line, odd: userOdd } = parsed.data;
  // 7. RE-VALIDAÇÃO server-side (firewall contra POST forjado): mercado ∈ audiência
  // ∩ liga; seleção ∈ selectionKeys ESTÁTICO. DIVERGÊNCIA DELIBERADA de analyzeMatch:
  // um mercado fora da cobertura NÃO é coercido a over_under (a seleção é FIXADA —
  // coercir avaliaria OUTRA aposta), vira nao-avalio.
  const isAdmin = session.user.role === "admin";
  const allowedMarkets = marketsForLeague(
    await marketsForAudience(isAdmin),
    match.league,
  );
  if (!allowedMarkets.some((m) => m.key === marketKey)) {
    return {
      ok: true,
      view: {
        kind: "nao-avalio",
        reason: "Não avalio esse mercado ainda neste jogo.",
      },
    };
  }
  const descriptor = getDescriptor(marketKey);
  // selectionKeys vazio (dynamicSelections) → nenhuma seleção estática casa → inerte.
  if (!descriptor || !descriptor.selectionKeys.includes(selectionKey)) {
    return {
      ok: true,
      view: {
        kind: "nao-avalio",
        reason: "Não avalio essa seleção ainda neste mercado.",
      },
    };
  }
  // 8. GATE DE LINHA-MODELÁVEL ANTES DE GASTAR: over/under só modela {2.5}(featured)
  // ∪ candidateLines (quando a variante multi-linha resolve p/ a liga). over 3.5 fora
  // de world_cup NUNCA é modelável (OVER_UNDER_ALT.coveredLeagues=['world_cup']) →
  // nao-avalio SEM rate-limit, SEM predict (senão predict só produziria a 2.5 e
  // queimaria slot+ai_call à toa).
  if (marketKey === "over_under") {
    const extraLinesEnabled = await getEnableOverUnderExtraLines();
    const extraLines = resolveExtraLines(
      marketKey,
      match.league,
      extraLinesEnabled,
    );
    const altDescriptor = getCartridge(marketKey, { extraLines }).descriptor;
    const modelableLines = new Set<number>([2.5]);
    if (extraLines && altDescriptor.candidateLines !== undefined) {
      for (const l of altDescriptor.candidateLines) modelableLines.add(l);
    }
    if (line === undefined || !modelableLines.has(line)) {
      return {
        ok: true,
        view: {
          kind: "nao-avalio",
          reason: "Não avalio essa linha ainda neste jogo.",
        },
      };
    }
  }
  // 9. CACHE-FIRST. over/under casa por linha (Number()'da na fronteira); os demais
  // por marketKey só (line=null). HIT → SEM rate-limit (leitura grátis). MISS →
  // rate-limit → predict() (gasto real).
  const cacheLine = marketKey === "over_under" ? line ?? null : null;
  let hit = await getLatestPredictionForPin(
    matchId,
    session.user.id,
    marketKey,
    cacheLine,
  );
  let persisted: {
    edgePct: number | null;
    impliedProbPct: number | null;
    stakeUnits: number | null;
  } | null = null;
  let extraLinesForPredict = false;
  if (marketKey === "over_under") {
    const extraLinesEnabled = await getEnableOverUnderExtraLines();
    extraLinesForPredict = resolveExtraLines(
      marketKey,
      match.league,
      extraLinesEnabled,
    );
  }
  if (!hit) {
    // MISS → rate-limit (incrementa o contador — gasto real, espelha analyzeMatch).
    const rateLimit = await checkAnalysisRateLimit(
      session.user.id,
      session.user.role,
    );
    if (!rateLimit.ok) {
      if (rateLimit.reason === "fail-closed") {
        return {
          ok: false,
          error: "Análises temporariamente indisponíveis. Tente mais tarde.",
          kind: "rate-limited",
        };
      }
      return {
        ok: false,
        error: `Você atingiu o limite de ${rateLimit.limit} análises por dia. Tente novamente amanhã.`,
        kind: "rate-limited",
      };
    }
    try {
      // Pré-aquece mercados *additional* (btts/dupla chance / over_under multi-linha)
      // como analyzeMatch, pra o predict achar a snapshot fresca.
      const effectiveDescriptor = getCartridge(marketKey, {
        extraLines: extraLinesForPredict,
      }).descriptor;
      if (effectiveDescriptor.oddsSource === "additional") {
        await ensureOddsSnapshotsFresh(match, {
          markets: [effectiveDescriptor],
        });
      }
      await predict({
        matchId,
        userId: session.user.id,
        isAdmin,
        marketKey,
        extraLines: extraLinesForPredict,
      });
    } catch (err) {
      if (err instanceof PredictError) {
        console.error(
          JSON.stringify({
            scope: "gradeMyBet",
            matchId,
            error: "predict_failed",
            message: err.message,
            context: err.context,
          }),
        );
        return { ok: false, error: friendlyMessage(err) };
      }
      console.error(
        JSON.stringify({
          scope: "gradeMyBet",
          matchId,
          error: "unexpected",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      return {
        ok: false,
        error: "Falha temporária ao avaliar a aposta. Tente novamente.",
      };
    }
    // Re-lê a distribuição recém-persistida (a fixação é 100% no mapper).
    hit = await getLatestPredictionForPin(
      matchId,
      session.user.id,
      marketKey,
      cacheLine,
    );
    if (!hit) {
      // Predict rodou mas não produziu a linha/mercado fixados (ex.: a escada não
      // tem a linha): não modelamos → skip-not-fabricate.
      return {
        ok: true,
        view: {
          kind: "nao-avalio",
          reason: "Não avalio essa aposta ainda neste jogo.",
        },
      };
    }
  }
  // persisted SÓ quando a seleção fixada É a recomendada pela análise — só aí há
  // edge/implied/stake persistidos da seleção. Number() na fronteira drizzle
  // (numeric → string): os campos voltam STRING e DEVEM virar number ANTES do mapper.
  if (hit.prediction.recommendation === selectionKey) {
    persisted = {
      edgePct:
        hit.prediction.edgePct === null ? null : Number(hit.prediction.edgePct),
      impliedProbPct:
        hit.prediction.impliedProbPct === null
          ? null
          : Number(hit.prediction.impliedProbPct),
      stakeUnits:
        hit.prediction.stakeUnits === null
          ? null
          : Number(hit.prediction.stakeUnits),
    };
  }
  const timeZone = await getRequestTimeZone();
  const view = toGradeMyBetView({
    // hit.selections já vem Number()'do (mapSelectionRow na fronteira drizzle).
    selections: hit.selections,
    pinnedKey: selectionKey,
    userOdd,
    marketKey,
    line: hit.prediction.marketParams?.line ?? null,
    recommendation: hit.prediction.recommendation,
    persisted,
    createdAt: hit.prediction.createdAt.toLocaleString("pt-BR", { timeZone }),
  });
  revalidatePath(`/match/${matchId}`);
  return { ok: true, view };
}
