import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";

import {
  aiCalls,
  matches,
  predictionSelectionOdds,
  predictions,
  recommendationEnum,
} from "@/db/schema";
import { db } from "@/lib/db";
import { resolveMarketCatalog } from "@/lib/db/queries/market-catalog";
import { getLatestFreshSelectionOddsSnapshots } from "@/lib/db/queries/odds-snapshots";
import { extractDbCause } from "@/lib/db/pg-error";
import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";
import { OVER_UNDER } from "@/lib/odds/market-descriptor";
import { pickBestBookmaker, type MarketOddsBundle } from "@/lib/odds/select-bookmaker";
import { getOddsForSport } from "@/lib/providers/odds-api";
import { leagueToSportKey } from "@/lib/providers/odds-api-constants";
import type { OddsApiEventOdds } from "@/lib/providers/odds-api-schemas";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import { normalizeTeamName } from "@/lib/providers/sports-data/team-names";
import {
  SportsDataTransientError,
  SportsDataUnsupportedError,
  type FixtureRef,
  type NormalizedInjury,
} from "@/lib/providers/sports-data/types";

import {
  getDefaultModelId,
  getGenerationParams,
} from "@/lib/db/queries/ai-config";
import { getPreferredModelId } from "@/lib/db/queries/users";

import { getAnthropicClient } from "./anthropic";
import { calculateCost } from "./cost";
import { computeStakeUnits } from "./staking";
import { getCartridge } from "./markets/registry";
import type { BaseMarketOutput } from "./markets/types";
import {
  MODEL_REGISTRY,
  isModelAllowedForAudience,
  type AIModelId,
} from "./models";
import { buildAnthropicRequest } from "./request-builder";

// ─── Types & errors ──────────────────────────────────────────────────────────

export type PredictArgs = {
  matchId: string;
  userId: string;
  // Audiência do caller (ADR 0013). Decide se a preferência pessoal do usuário
  // pode apontar pra um modelo admin-only: ex-admin rebaixado com Fable salvo
  // cai no default. NÃO afeta o `modelOverride` (já validado pelo caller).
  isAdmin: boolean;
  // Override admin-gated (já validado pelo caller); predict confia num
  // AIModelId. Ausente → usa a preferência do usuário / default global do DB.
  modelOverride?: AIModelId;
  // Mercado a analisar (ADR 0017). Default `"over_under"` (o caller único hoje
  // não passa). Resolve o cartucho via getCartridge — predict NÃO ramifica por
  // `if (market === X)`.
  marketKey?: string;
};

export type Prediction = typeof predictions.$inferSelect;

// Carrier do retorno do predict (gate #15): a prediction persistida + o marketKey
// resolvido + a grade N-vias (uma entrada por selectionKey, com a prob do modelo e
// a odd congelada). A action monta a view SÍNCRONA a partir de `selections` (o
// painel renderiza antes de qualquer re-query). `odd` é null se a seleção não tem
// odd no bundle (não acontece hoje — todo selectionKey vem do mercado completo).
export type PredictResult = {
  prediction: Prediction;
  marketKey: string;
  selections: { key: string; modelProbPct: number; odd: number | null }[];
};

type AiCallStatus =
  | "ok"
  | "invalid_output"
  | "provider_error"
  | "timeout"
  | "tool_missing"
  | "rate_limited";

export class PredictError extends Error {
  readonly context: Record<string, unknown>;
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = "PredictError";
    this.context = context;
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

const FORM_LAST = 5;
const H2H_LAST = 5;
const ODDS_WINDOW_MS = 6 * 60 * 60 * 1000;
const ERROR_MESSAGE_MAX = 2000;

// Re-export normalizeTeamName for back-compat with any caller still importing
// it from this module (e.g. tests). Canonical location is now
// lib/providers/sports-data/team-names.ts.
export { normalizeTeamName };

function teamNamesMatch(a: string, b: string): boolean {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// ─── Odds matching ───────────────────────────────────────────────────────────

function findMatchingEvent(
  events: OddsApiEventOdds[],
  homeName: string,
  awayName: string,
  kickoffAt: Date,
): OddsApiEventOdds | undefined {
  const kickoffMs = kickoffAt.getTime();
  return events.find((event) => {
    const ts = Date.parse(event.commence_time);
    if (!Number.isFinite(ts) || Math.abs(ts - kickoffMs) > ODDS_WINDOW_MS) {
      return false;
    }
    return (
      teamNamesMatch(event.home_team, homeName) &&
      teamNamesMatch(event.away_team, awayName)
    );
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function classifyAnthropicError(err: unknown): {
  status: Exclude<AiCallStatus, "ok" | "invalid_output" | "tool_missing">;
  message: string;
} {
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return { status: "timeout", message: err.message };
  }
  if (err instanceof Anthropic.RateLimitError) {
    const retryAfter = err.headers?.get?.("retry-after") ?? null;
    return {
      status: "rate_limited",
      message: `${err.status}: ${err.message}${retryAfter ? ` (retry-after=${retryAfter})` : ""}`,
    };
  }
  if (err instanceof Anthropic.APIError) {
    const requestId = err.headers?.get?.("request-id") ?? null;
    return {
      status: "provider_error",
      message: `${err.status ?? "?"}: ${err.message}${requestId ? ` (request-id=${requestId})` : ""}`,
    };
  }
  return {
    status: "provider_error",
    message: err instanceof Error ? err.message : String(err),
  };
}

function serializeAnthropicError(err: unknown): Record<string, unknown> {
  if (err instanceof Anthropic.APIError) {
    return {
      name: err.name,
      message: err.message,
      status: err.status ?? null,
      requestId: err.headers?.get?.("request-id") ?? null,
    };
  }
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { error: String(err) };
}

async function persistAiCallError(args: {
  userId: string;
  matchId: string;
  model: AIModelId;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: AiCallStatus;
  errorMessage: string;
  promptVersion: string;
}): Promise<void> {
  const cost = calculateCost({
    model: args.model,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
  });
  // This logs an error that ALREADY happened, so its own failure must not mask
  // the primary error by throwing a raw "Failed query: insert into ai_calls".
  // Swallow + log so the original PredictError surfaces to the caller.
  try {
    await db.insert(aiCalls).values({
      userId: args.userId,
      matchId: args.matchId,
      provider: "anthropic",
      model: args.model,
      promptVersion: args.promptVersion,
      inputPayload: args.inputPayload,
      outputPayload: args.outputPayload,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      latencyMs: args.latencyMs,
      costUsd: cost.toFixed(6),
      status: args.status,
      errorMessage: truncate(args.errorMessage, ERROR_MESSAGE_MAX),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "persistAiCallError",
        matchId: args.matchId,
        error: "ai_call_audit_insert_failed",
        originalStatus: args.status,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function predict({
  matchId,
  userId,
  isAdmin,
  modelOverride,
  marketKey = "over_under",
}: PredictArgs): Promise<PredictResult> {
  // Cartucho de mercado (ADR 0017): resolve por marketKey (throw em desconhecido).
  // Read puro — roda ANTES de qualquer chamada paga; predict NÃO ramifica por
  // `if (market === X)`, todo o comportamento específico vem do cartucho.
  const cartridge = getCartridge(marketKey);

  // 0. Resolve o modelo UMA vez pela cascata completa (ADR 0013):
  //    override por análise > preferência do usuário > default global >
  //    DEFAULT_MODEL_ID. A preferência só vale se passar no filtro de audiência
  //    (admin-only nunca roda pra usuário comum — ex-admin rebaixado com Fable
  //    salvo cai no default). Havendo override, nem lemos a preferência (query
  //    desnecessária). As leituras de DB são baratas ante a chamada paga ao LLM.
  let resolvedModelId: AIModelId;
  if (modelOverride) {
    resolvedModelId = modelOverride;
  } else {
    const pref = await getPreferredModelId(userId);
    const usablePref =
      pref && isModelAllowedForAudience(pref, isAdmin) ? pref : null;
    resolvedModelId = usablePref ?? (await getDefaultModelId());
  }
  const model = MODEL_REGISTRY[resolvedModelId];

  // 1. Lookup do match no DB
  const matchRows = await db
    .select()
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  const match = matchRows[0];
  if (!match) {
    throw new PredictError("match not found", { matchId });
  }
  if (match.status === "finished" || match.status === "cancelled") {
    throw new PredictError("match is not analyzable", {
      matchId,
      status: match.status,
    });
  }
  const kickoffMs = match.kickoffAt.getTime();

  const provider = getSportsDataProvider();
  const ref: FixtureRef = {
    league: match.league,
    kickoffAt: match.kickoffAt.toISOString(),
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
  };

  // 2. Fetch normalized fixture (composite-keyed). Used to populate venue
  //    and serve as the reference for downstream lookups (lineups, injuries).
  const fixture = await provider.getFixtureByMatch(ref);
  if (!fixture) {
    throw new PredictError("fixture not found in provider", {
      matchId,
      ref,
      providerName: provider.capabilities.name,
    });
  }

  // 3. Parallel fetch of supporting data. The provider's adapters serialize
  //    HTTP calls through their concurrency + throttle limiters
  //    (lib/providers/http/), so the Promise.all here expresses logical
  //    independence; the transport layer enforces rate limits.
  //
  //    Injuries are wrapped in catch() to map both SportsDataUnsupportedError
  //    (capability missing, e.g. football-data.org has no injury endpoint) AND
  //    SportsDataTransientError (e.g. an api-football transient outage on the
  //    injuries route) to the same absences-unavailable signal for the AI input
  //    — the analysis proceeds and the LLM is told injuries are unavailable.
  //    This graceful degrade is scoped to ONLY the injuries fetch: every other
  //    fetch (form/h2h/standings/lineups) still rejects Promise.all on a
  //    transient error, and any non-transient/non-unsupported injuries error
  //    still bubbles up.
  const [homeForm, awayForm, h2h, standings, injuries, lineups] =
    await Promise.all([
      provider.getTeamForm(match.homeTeam, match.league, FORM_LAST),
      provider.getTeamForm(match.awayTeam, match.league, FORM_LAST),
      provider.getH2H(match.homeTeam, match.awayTeam, match.league, H2H_LAST),
      provider.getStandings(match.league),
      provider
        .getInjuriesByFixture(ref)
        .then((data) => ({ data, unavailable: false }))
        .catch((err: unknown) => {
          if (
            err instanceof SportsDataUnsupportedError ||
            err instanceof SportsDataTransientError
          ) {
            return {
              data: {
                home: [] as NormalizedInjury[],
                away: [] as NormalizedInjury[],
              },
              unavailable: true,
            };
          }
          throw err;
        }),
      provider.getLineups(ref),
    ]);
  const absencesAvailable = !injuries.unavailable;

  // 4. Odds (N-vias): reusa uma captura fresca se a página já snapshotou nesta
  //    sessão (quota: evita uma 2ª call à Odds API). Cai no fetch direto quando
  //    predict() roda standalone (script, sem render prévio). Ambos os caminhos
  //    produzem um `MarketOddsBundle` (selections[] keyed por selectionKey +
  //    overround) — over/under é o caso N=2. O caminho fresh já é dual-escrito
  //    pelo fetch-and-snapshot, então a paridade over/under é preservada.
  let oddsBundle: MarketOddsBundle;
  const freshSnapshot = await getLatestFreshSelectionOddsSnapshots({
    matchId: match.id,
    dbMarketKey: cartridge.descriptor.dbMarketKey,
    params: cartridge.descriptor.params,
  });
  if (freshSnapshot) {
    // numeric → string no Drizzle; Number() na fronteira antes de qualquer math.
    const selections = freshSnapshot.selections.map((s) => ({
      key: s.key,
      odd: Number(s.odd),
    }));
    const { overround } = computeMarketImpliedProbabilities(
      cartridge.descriptor.selectionKeys.map((key) => {
        const sel = selections.find((s) => s.key === key);
        if (!sel) {
          throw new PredictError(
            `fresh snapshot missing selection '${key}' for market '${cartridge.descriptor.dbMarketKey}'`,
            { matchId, key },
          );
        }
        return sel.odd;
      }),
    );
    oddsBundle = {
      bookmakerKey: "", // não usado downstream; schema guarda title, não key.
      bookmakerTitle: freshSnapshot.bookmaker,
      lastUpdate: freshSnapshot.capturedAt.toISOString(),
      selections,
      overround,
    };
  } else if (cartridge.descriptor.oddsSource === "additional") {
    // Mercado *additional* (btts): odds só por evento, NUNCA em batch (quota). O
    // snapshot fresco DEVE ter sido garantido por evento antes do predict (pre-warm
    // na action). Sem ele, NÃO batcheia getOddsForSport — falha explícita. Guard
    // data-driven (oddsSource do descriptor), não um literal de nome de mercado.
    throw new PredictError(
      `additional-market '${cartridge.descriptor.dbMarketKey}' sem snapshot fresco; odds devem ser garantidas por evento antes do predict (nunca batch)`,
      { matchId, dbMarketKey: cartridge.descriptor.dbMarketKey },
    );
  } else {
    const sportKey = leagueToSportKey(match.league);
    const commenceTimeFrom = new Date(kickoffMs - ODDS_WINDOW_MS).toISOString();
    const commenceTimeTo = new Date(kickoffMs + ODDS_WINDOW_MS).toISOString();
    const events = await getOddsForSport(sportKey, {
      // provider market key do descriptor (= "totals" pro over/under); request
      // byte-idêntico ao literal antigo, mas sem hardcode no predict.
      markets: [cartridge.descriptor.providerMarketKey],
      regions: ["eu"],
      commenceTimeFrom,
      commenceTimeTo,
    });
    const event = findMatchingEvent(
      events,
      fixture.homeTeam,
      fixture.awayTeam,
      match.kickoffAt,
    );
    if (!event) {
      throw new PredictError("no matching odds event found", {
        home: fixture.homeTeam,
        away: fixture.awayTeam,
        kickoff: match.kickoffAt.toISOString(),
        candidates: events.length,
      });
    }
    const bundle = pickBestBookmaker({
      event,
      match: { homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam },
      descriptor: cartridge.descriptor,
    });
    if (!bundle) {
      throw new PredictError(
        `no complete '${cartridge.descriptor.dbMarketKey}' odds available for event`,
        {
          eventId: event.id,
          bookmakers: event.bookmakers.length,
        },
      );
    }
    oddsBundle = bundle;
  }

  // 4b. Catálogo do mercado (marketId + mapas seleção↔id) — read PRÉ-chamada-paga,
  //     keyed por dbMarketKey (= "over_under", NÃO o enum legado "over_under_2_5").
  //     Hard-fail aqui (market sem seed) acontece ANTES de queimar spend e ANTES
  //     do insert de ai_call. A persistência (passo 11) só CONSOME estes mapas.
  const catalog = await resolveMarketCatalog(cartridge.descriptor.dbMarketKey);

  // 4c. Guarda de seed COMPLETO — PRÉ-chamada-paga. resolveMarketCatalog (shared
  //     com #164) só hard-falha em mercado ausente ou ZERO seleções; um mercado
  //     seedado com SÓ ALGUMAS seleções (ex.: 'over' sem 'under') passaria por ela
  //     e só estouraria nos hard-fails por-seleção DEPOIS de client.messages.create()
  //     (queimando spend + uma row de ai_call). O invariante "falha antes do gasto"
  //     exige checar AQUI que TODA seleção do cartucho tem id no catálogo.
  const missingSelections = cartridge.selections.filter(
    (key) => !catalog.idByKey.has(key),
  );
  if (missingSelections.length > 0) {
    throw new PredictError(
      `market '${cartridge.descriptor.dbMarketKey}' seedado incompleto: faltam seleções [${missingSelections.join(", ")}]`,
      { marketKey, missingSelections },
    );
  }

  // 5. Implied probabilities normalizadas (N seleções; contrato chave→índice).
  //    O candidate-odds array é montado na ordem `descriptor.selectionKeys`
  //    (['over','under'] / ['home','draw','away']) SOBRE as odds do bundle — nunca
  //    por ordem de linhas de read. `oddByKey` mapeia selectionKey→odd a partir das
  //    `bundle.selections`; impliedByKey indexa o resultado pela MESMA chave, e o
  //    *100 segue a ordem de operações de antes (probs[i] * 100) → bit-exato com o
  //    legado em N=2.
  const selectionKeys = cartridge.descriptor.selectionKeys;
  const oddByKey: Record<string, number> = {};
  for (const sel of oddsBundle.selections) {
    oddByKey[sel.key] = sel.odd;
  }
  const candidateOdds = selectionKeys.map((key) => {
    const odd = oddByKey[key];
    if (odd === undefined) {
      throw new PredictError(
        `odds bundle missing selection '${key}' for market '${cartridge.descriptor.dbMarketKey}'`,
        { matchId, key },
      );
    }
    return odd;
  });
  const { probs } = computeMarketImpliedProbabilities(candidateOdds);
  const impliedByKey: Record<string, number> = {};
  selectionKeys.forEach((key, i) => {
    impliedByKey[key] = probs[i] * 100;
  });

  // 6. Monta o input do cartucho (over_under: down-mapeia o generic args
  //    selections[]/pct pro shape binário; ver build-input.ts). predict monta UM
  //    args genérico que QUALQUER cartucho aceita.
  let input: ReturnType<typeof cartridge.buildPredictionInput>;
  try {
    input = cartridge.buildPredictionInput({
      match: {
        externalId: match.externalId,
        league: match.league,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        kickoffAt: match.kickoffAt,
        venue: fixture.venue,
      },
      standings,
      home: {
        form: homeForm,
        injuries: injuries.data.home,
        absencesAvailable,
      },
      away: {
        form: awayForm,
        injuries: injuries.data.away,
        absencesAvailable,
      },
      lineups,
      h2h,
      odds: {
        bookmaker: oddsBundle.bookmakerTitle,
        // captured_at normalizado aqui (mantém o local do new Date().toISOString()
        // do legado): o caminho fallback traz `lastUpdate` cru do provider
        // ("...Z"); o fresh já traz ISO. O cartucho consome verbatim.
        captured_at: new Date(oddsBundle.lastUpdate).toISOString(),
        selections: selectionKeys.map((key) => ({ key, odd: oddByKey[key] })),
      },
      implied: { pct: impliedByKey },
    });
  } catch (err) {
    if (err instanceof cartridge.BuildInputError) {
      throw new PredictError(`buildPredictionInput failed: ${err.message}`, {
        ...(err as { context?: Record<string, unknown> }).context,
      });
    }
    throw err;
  }

  // 7. Monta payload do Claude
  const daysToKickoff = Math.max(
    0,
    Math.ceil((kickoffMs - Date.now()) / 86_400_000),
  );
  const userMessage = cartridge.buildUserMessage(input, { daysToKickoff });
  // Parâmetros de geração calibráveis (ADR 0008, emenda 2). Aplicados MODEL-AWARE
  // pelo request-builder: maxTokens p/ todos, effort só adaptive, temperature só
  // temperature-mode. Leitura barata de DB ante a chamada paga ao LLM.
  const genParams = await getGenerationParams();
  // Constrói UM objeto de request model-aware, reusado tanto pro inputPayload
  // logado quanto pra chamada real (sem divergência). request-builder omite
  // temperature em modelos adaptive (Opus 4.8 dá 400) e a mantém no Sonnet 4.5.
  const request = buildAnthropicRequest({
    model,
    system: cartridge.systemPrompt,
    userMessage,
    tools: [cartridge.tool],
    toolName: cartridge.toolName,
    maxTokens: genParams.maxTokens,
    effort: genParams.effort,
    temperature: genParams.temperature,
  });
  const inputPayload = request as unknown as Record<string, unknown>;

  // 8. Chamada do Claude (com cronômetro)
  const client = getAnthropicClient();
  const start = performance.now();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create(request);
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const classified = classifyAnthropicError(err);
    await persistAiCallError({
      userId,
      matchId,
      model: model.id,
      inputPayload,
      outputPayload: { error: serializeAnthropicError(err) },
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      status: classified.status,
      errorMessage: classified.message,
      promptVersion: cartridge.version,
    });
    throw new PredictError(`anthropic call failed: ${classified.message}`, {
      cause: err,
    });
  }
  const latencyMs = Math.round(performance.now() - start);
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const outputPayload = response as unknown as Record<string, unknown>;

  // 9. Extração do tool_use block
  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === cartridge.toolName,
  );
  if (!toolUse) {
    const snippet = JSON.stringify(response.content).slice(0, 500);
    await persistAiCallError({
      userId,
      matchId,
      model: model.id,
      inputPayload,
      outputPayload,
      inputTokens,
      outputTokens,
      latencyMs,
      status: "tool_missing",
      errorMessage: `model did not call ${cartridge.toolName}; content=${snippet}`,
      promptVersion: cartridge.version,
    });
    throw new PredictError("LLM did not call submit_prediction tool", {
      stopReason: response.stop_reason,
    });
  }

  // 10. Validação Zod do output (schema do cartucho; fronteira do CLAUDE.md —
  //     output do LLM SEMPRE validado por Zod antes de uso).
  const parsed = cartridge.outputSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    await persistAiCallError({
      userId,
      matchId,
      model: model.id,
      inputPayload,
      outputPayload,
      inputTokens,
      outputTokens,
      latencyMs,
      status: "invalid_output",
      errorMessage: JSON.stringify(parsed.error.issues),
      promptVersion: cartridge.version,
    });
    throw new PredictError("LLM output failed Zod validation", {
      issues: parsed.error.issues,
    });
  }
  // O registry apaga o genérico do schema (ZodType<unknown>). predict é
  // market-agnostic: lê só os campos compartilhados (recommendation/confidence_pct/
  // rationale/key_factors/minimum_odd) via BaseMarketOutput — cada cartucho já
  // validou o output completo pelo SEU schema acima. O comportamento específico de
  // mercado vem de cartridge.selectionProbs / descriptor, nunca de `if (market===X)`.
  const output = parsed.data as BaseMarketOutput;

  // 11. Persistência (sequencial — neon-http não suporta transações reais).
  const cost = calculateCost({
    model: model.id,
    inputTokens,
    outputTokens,
  });
  let aiCallRow: typeof aiCalls.$inferSelect;
  try {
    const [row] = await db
      .insert(aiCalls)
      .values({
        userId,
        matchId,
        provider: "anthropic",
        model: model.id,
        promptVersion: cartridge.version,
        inputPayload,
        outputPayload,
        inputTokens,
        outputTokens,
        latencyMs,
        costUsd: cost.toFixed(6),
        status: "ok",
        errorMessage: null,
      })
      .returning();
    aiCallRow = row;
  } catch (err) {
    // O erro real do Postgres mora em err.cause; Drizzle só expõe o wrapper
    // "Failed query:" em err.message. Sem isto, uma violação de FK/constraint
    // some no log como "unexpected". Ver lib/db/pg-error.ts.
    const cause = extractDbCause(err);
    console.error(
      JSON.stringify({
        scope: "predict",
        matchId,
        userId,
        error: "ai_call_insert_failed",
        ...cause,
      }),
    );
    throw new PredictError("failed to persist ai_call", cause);
  }

  // Probabilidade do modelo por seleção (decisão B): derivada PURA do output pelo
  // cartucho (binário em over/under, distribuição em 1X2). Alimenta a coluna NOVA
  // `model_prob_pct` do PSO, a grade N-vias retornada (seam 8) E o edge persistido
  // abaixo. Computada aqui (antes do edge) porque o edge usa a prob POR SELEÇÃO.
  const modelProbByKey = cartridge.selectionProbs(output);

  // Edge N-vias (ADR 0018): cada seleção tem seu próprio edge `modelProb − implied`.
  // NUNCA `100−x` — em N≥3 não há complemento binário. `pass` → sem lado, sem edge.
  // O lado recomendado é uma selectionKey (`oddByKey`/`impliedByKey` indexados por
  // ela); o valor é `undefined` só se a seleção não está no mercado — bug de
  // contrato, não fluxo (o catalog/seed guard já barrou antes).
  //
  // `modelProb` do lado recomendado vem de selectionProbs(output)[side] — a MESMA
  // prob por seleção que a grade exibe — não de confidence_pct. Em over/under são
  // byte-idênticos (selectionProbs[rec] === confidence_pct, ver over_under/index.ts);
  // em 1X2 o LLM pode emitir confidence_pct ≠ prob_<recomendado>, e aqui o edge
  // persistido passa a casar com o edge da grade N-vias em vez de divergir.
  const side = output.recommendation;
  const oddAtRec = side === "pass" ? null : (oddByKey[side] ?? null);
  const impliedPct = side === "pass" ? null : (impliedByKey[side] ?? null);
  const edge =
    side !== "pass" && impliedPct !== null
      ? modelProbByKey[side] - impliedPct
      : null;

  // Staking determinístico (ADR 0019): decidido EM CÓDIGO, nunca pelo LLM. A
  // banda usa os MESMOS valores CONGELADOS na row (edge/confiança arredondados a
  // 2 casas) pra que a decisão nunca divirja do `edge_pct` visível — no seam
  // 7.996→"8.00" a row mostra 8.00 e a banda decide sobre 8.00, não sobre o raw.
  // As colunas persistidas seguem byte-idênticas (toFixed(2) do raw == do
  // arredondado); só a DECISÃO passa a usar a precisão exata gravada.
  const edgePctRounded = edge === null ? null : Number(edge.toFixed(2));
  const confidencePctRounded = Number(output.confidence_pct.toFixed(2));
  const stakeUnits = computeStakeUnits(edgePctRounded, confidencePctRounded);

  // Coluna NOVA `selection_id`: o lado escolhido (NULL em pass — não há seleção).
  // Resolvido em MEMÓRIA pelo catálogo já lido — hard-fail ANTES do insert (não
  // violação de FK opaca pós-paga) se a seleção recomendada não estiver seedada.
  let selectionId: string | null = null;
  if (side !== "pass") {
    const id = catalog.idByKey.get(side);
    if (!id) {
      throw new PredictError(
        `seleção '${side}' não seedada pro market '${cartridge.descriptor.dbMarketKey}'`,
        { marketKey, recommendation: side },
      );
    }
    selectionId = id;
  }

  // Rows do candidate set (N seleções) pra prediction_selection_odds, montadas
  // ANTES do insert da prediction pra que um seed faltante falhe SEM ter
  // commitado a prediction (mesma semântica do hard-fail de selectionId acima).
  // odds = EXATAMENTE o par do MESMO bundle → PSO["over"] === overOddAtPrediction
  // byte-a-byte. Uma row por seleção, INCLUSIVE em pass. `model_prob_pct` vem do
  // cartucho (numeric nullable; toFixed(2) no boundary).
  const psoRowsToInsert = selectionKeys.map((key) => {
    const sid = catalog.idByKey.get(key);
    if (!sid) {
      throw new PredictError(
        `seleção '${key}' não seedada pro market '${cartridge.descriptor.dbMarketKey}'`,
        { marketKey, key },
      );
    }
    const modelProb = modelProbByKey[key];
    return {
      selectionId: sid,
      odd: oddByKey[key].toFixed(3),
      modelProbPct: modelProb === undefined ? null : modelProb.toFixed(2),
    };
  });

  // Legacy-write guard (gate #20): as colunas LEGADAS over/under-específicas
  // (`market` enum + `overOddAtPrediction`/`underOddAtPrediction`) só são escritas
  // pro over/under — comparação CONSTANTE com OVER_UNDER.dbMarketKey, espelhando
  // fetch-and-snapshot.ts (NUNCA `=== "over_under"` literal). Pra qualquer outro
  // mercado ficam null; a fonte-da-verdade é marketId/selectionId/marketParams (já
  // genéricos) + o candidate set em PSO. O par binário só faz sentido em N=2.
  const isOverUnder =
    cartridge.descriptor.dbMarketKey === OVER_UNDER.dbMarketKey;
  let predictionRow: Prediction;
  try {
    const [row] = await db
      .insert(predictions)
      .values({
        matchId,
        userId,
        aiCallId: aiCallRow.id,
        // Enum LEGADO single-value: só over/under; null pros novos mercados.
        market: isOverUnder ? "over_under_2_5" : null,
        // Colunas NOVAS multi-mercado (#165): marketId do catálogo; selectionId
        // resolvido acima (NULL em pass); marketParams verbatim do descriptor
        // (= { line: 2.5 } NUMBER pro over/under; null pro 1X2).
        marketId: catalog.marketId,
        selectionId,
        marketParams: cartridge.descriptor.params ?? null,
        // recommendation = selectionKey (enum estendido com home/draw/away) ou "pass".
        // O cartucho já validou output.recommendation contra o SEU enum (over|under|
        // pass / home|draw|away|pass) — todos ⊆ recommendationEnum; o cast só estreita
        // o `string` do BaseMarketOutput pro tipo da coluna.
        recommendation:
          output.recommendation as (typeof recommendationEnum.enumValues)[number],
        confidencePct: output.confidence_pct.toFixed(2),
        rationale: output.rationale,
        keyFactors: output.key_factors,
        minimumOdd: output.minimum_odd?.toFixed(3) ?? null,
        oddAtRecommendation: oddAtRec?.toFixed(3) ?? null,
        // bookmaker = fonte das odds analisadas — persiste também em pass
        // (ADR 0012, decisão 3).
        bookmaker: oddsBundle.bookmakerTitle,
        impliedProbPct: impliedPct?.toFixed(2) ?? null,
        edgePct: edge?.toFixed(2) ?? null,
        // Stake congelado (ADR 0019): banda determinística sobre edge/confiança;
        // pass → 1u (irrelevante, fora do Yield). numeric(6,2) → string.
        stakeUnits: stakeUnits.toFixed(2),
        // Par congelado dos DOIS lados — SÓ over/under (binário). Em N≥3 não há par;
        // o candidate set vive em PSO. Pra toda recomendação inclusive pass
        // (ADR 0012, decisões 3-4) — alimenta o bloco de cenários binário.
        overOddAtPrediction: isOverUnder ? oddByKey.over.toFixed(3) : null,
        underOddAtPrediction: isOverUnder ? oddByKey.under.toFixed(3) : null,
        modelVersion: model.id,
        promptVersion: cartridge.version,
      })
      .returning();
    predictionRow = row;
  } catch (err) {
    // ai_call já foi persistido (custo registrado); só a prediction falhou.
    const cause = extractDbCause(err);
    console.error(
      JSON.stringify({
        scope: "predict",
        matchId,
        userId,
        aiCallId: aiCallRow.id,
        error: "prediction_insert_failed",
        ...cause,
      }),
    );
    throw new PredictError("failed to persist prediction", cause);
  }

  // 12. prediction_selection_odds (SEQUENCIAL, após prediction.id — o FK NOT NULL
  //     só existe após .returning()). As rows (candidate set, INCLUSIVE pass) já
  //     foram montadas acima; aqui só ligamos o predictionId e inserimos.
  //
  //     Falha AQUI (prediction já commitada) = log + DEGRADE (não throw): retorna
  //     a prediction; o candidate set é re-preenchível pelo backfill #162
  //     (idempotente via o UNIQUE). Janela de parcialidade tolerada (estilo
  //     persistAiCallError — não mascarar a prediction válida com um erro de PSO).
  try {
    await db.insert(predictionSelectionOdds).values(
      psoRowsToInsert.map((r) => ({
        predictionId: predictionRow.id,
        selectionId: r.selectionId,
        odd: r.odd,
        modelProbPct: r.modelProbPct,
      })),
    );
  } catch (err) {
    const cause = extractDbCause(err);
    console.error(
      JSON.stringify({
        scope: "predict",
        matchId,
        userId,
        predictionId: predictionRow.id,
        error: "prediction_selection_odds_insert_failed",
        ...cause,
      }),
    );
    // Degrade: a prediction já está persistida; não derrubar o caller por uma
    // falha do candidate set (re-preenchível pelo backfill #162).
  }

  // Carrier da grade N-vias (gate #15): a prediction + o marketKey resolvido + uma
  // entrada por selectionKey (prob do modelo + odd congelada). A action monta a
  // view SÍNCRONA a partir disto. Tudo já em escopo (selectionKeys/modelProbByKey/
  // oddByKey) — nenhuma re-query.
  return {
    prediction: predictionRow,
    marketKey: cartridge.marketKey,
    selections: selectionKeys.map((key) => ({
      key,
      modelProbPct: modelProbByKey[key],
      odd: oddByKey[key] ?? null,
    })),
  };
}
