import {
  engineFromModelVersion,
  type AnalysisEngine,
} from "@/lib/ai/engine/analysis-engine";
import type { JudgmentMultipliers } from "@/lib/ai/judgments/apply";
import type { JudgmentAnswers, JudgmentQuestionId } from "@/lib/ai/judgments/types";
import { judgmentFactorPhrases } from "@/lib/ai/markets/_narrator/labels";
import type { FactorOrigins } from "@/lib/ai/markets/_narrator/types";
import { newsFactorOrigins } from "@/lib/match-news/apply";
import { modelAnswersOf } from "@/lib/match-news/model-answers";
import { MatchModelNewsSchema, type MatchModelNews } from "@/lib/match-news/types";
import type { PredictionWithAiCall } from "@/lib/db/queries/predictions";
import { asStoredOdd } from "@/lib/odds/stored-odd";
import { claimEffect } from "@/lib/user-palpite/evidence";
import { hasContextNote } from "@/lib/user-palpite/labels";
import { PredictionUserContextSchema } from "@/lib/user-palpite/types";
import { getMarketPresentation } from "@/lib/view/markets/presentation";

import type { FanOutOutcome } from "../best-bet";
import type { PredictResult } from "../predict";
import { weighedFactorInputs, type WeighedInputs } from "./weighed";

// Projeção de UMA análise de mercado pro passo de síntese (#353, Fork A / ADR 0030).
// Camada `lib/ai`: lê os campos JÁ PERSISTIDOS da prediction (edge/confiança/odd) —
// NÃO re-deriva via computeMarketScenarios (evita divergência com o que a row gravou).
//
// `getMarketPresentation` é PURO e SEGURO PRO BUNDLE (não importa @/lib/ai* nem
// @/lib/db) → importável daqui sem inverter a dependência: a advertência do plano é
// contra puxar `toBestBetView`/o agregador da view, não os rótulos de display.
//
// FIREWALL (ADR 0030 §3): `edgePct`/`evPerUnit`/`oddAtRecommendation` viajam como
// DADO (informam o veredito do LLM) — NUNCA aparecem na manchete. O guard estrutural
// (output `.strict()`) + o guard de conteúdo (value-language) garantem isso na saída.
export type MarketAnalysisSummary = {
  marketKey: string;
  marketLabel: string; // do descriptor de display (getMarketPresentation), não da view agregada
  recommendation: string; // selectionKey OU 'pass'
  recommendedLabel: string | null; // rótulo legível da seleção recomendada
  isPass: boolean;
  modelProbPct: number | null; // da seleção recomendada (Number()'d)
  edgePct: number | null; // prediction.edgePct PERSISTIDO, Number()'d (null em pass) — DADO, não vai p/ manchete
  confidencePct: number | null; // prediction.confidencePct, Number()'d
  oddAtRecommendation: number | null;
  rationale: string; // prediction.rationale (sinal p/ a narrativa); ver synthesisRationale
  predictionId: string; // proveniência → headline.sourcePredictionIds
  selections: { key: string; label?: string; modelProbPct: number }[];
  // Motor que produziu a análise (do modelVersion). Só decide se o 1X2 serve de fonte
  // da confiança do palpite (#649); não vai pro prompt. Ausente = desconhecido.
  engine?: AnalysisEngine | null;
  // ── Insumo do palpite decidido em código (#668, ADR 0072). Nunca vai ao prompt: o
  // parse do input da síntese descarta, e o pick é calculado antes (lib/ai/palpites/pick).
  // Odd CONGELADA de cada seleção na análise, arredondada a 3 casas (a precisão de
  // `prediction_selection_odds.odd`), pra o caminho em memória e o do histórico darem o
  // mesmo palpite. Só as seleções com odd válida.
  odds?: Record<string, number>;
  // Linha da análise (over/under); null nos mercados sem linha.
  line?: number | null;
  // ISO do createdAt da predição: decide se duas análises são do mesmo run.
  predictionCreatedAt?: string | null;
  // λ do motor code_jev gravado na predição (judgments.lambda) + chaves do run.
  judgmentsModel?: AnalysisJudgmentsModel | null;
  // Fatores do JEV que mexeram no λ, em frases sem número (times genéricos), sem os que
  // o contexto extra do usuário moveu (mesma regra do racional, #565). Os que a notícia
  // moveu (#672) levam a origem "(segundo o ge…)": a notícia é pública.
  factorPhrases?: string[];
  // Notícias do ge sem efeito no número (#672), em linhas do código. Ausente = nenhuma.
  newsNotes?: string[];
};

export type AnalysisJudgmentsModel = {
  base: { home: number; away: number };
  adjusted: { home: number; away: number };
  rho: number | null;
  stateHash: string;
  jevAiCallId: string | null;
  // Os fatores que mexeram no λ e quem levou cada um ao valor final (#683): insumo do
  // "o que pesou" (headline.pick.weighed). null = contexto extra ilegível; [] = nada mexeu.
  // Ausente nos resumos montados à mão (testes).
  factors?: WeighedInputs | null;
};

// Uma análise já persistida, venha ela do fan-out em memória (PredictResult) ou do
// histórico do DB. `modelProbPct` null: mercados de seleção dinâmica (artilheiro,
// assistência) só trazem prob pros jogadores que o modelo estimou.
type AnalysisSource = {
  marketKey: string;
  prediction: PredictResult["prediction"];
  selections: {
    key: string;
    label?: string;
    modelProbPct: number | null;
    odd?: number | null;
  }[];
};

function finiteOrNull(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Resume o `FanOutOutcome[]` (em memória, pós-fan-out) numa lista de
 * `MarketAnalysisSummary` pro cartucho de síntese. Filtra os outcomes `ok` (falhas
 * por-mercado são descartadas), lê os campos persistidos da prediction com `Number()`
 * no boundary (Drizzle numeric → string), trata `pass` (sem edge/odd; isPass=true),
 * e ordena por edge desc só como CONTEXTO de prompt (palpites com mais valor primeiro;
 * a ordenação é insumo, não escolha — a manchete é uma síntese, não um pick).
 */
export function summarizeAnalysesForSynthesis(
  outcomes: FanOutOutcome[],
): MarketAnalysisSummary[] {
  return summarizeSources(
    outcomes.flatMap((o) => (o.ok ? [o.result] : [])),
  );
}

/**
 * Mesma projeção, a partir do histórico salvo (botão "gerar só o palpite"): a análise
 * MAIS RECENTE de cada mercado, a mesma que "Ler análise completa" mostra na página do jogo.
 * O histórico vem em ordem desc de criação. Seleção sem prob gravada (null) segue
 * sem prob, nunca 0%.
 */
//
// Pré-jogo e ao vivo não se misturam (#594): `live: false` (default) lê só as análises
// de pré-jogo (uma leitura ao vivo nunca entra no palpite de antes do apito);
// `live: true`, só as leituras ao vivo (o chamador já filtrou as do momento atual).
export function summarizeSavedAnalysesForSynthesis(
  history: PredictionWithAiCall[],
  opts: { live?: boolean } = {},
): MarketAnalysisSummary[] {
  const wantLive = opts.live === true;
  const latestByMarket = new Map<string, AnalysisSource>();
  for (const row of history) {
    if ((row.prediction.isLive === true) !== wantLive) continue;
    const marketKey = row.marketKey ?? "over_under";
    if (latestByMarket.has(marketKey)) continue;
    latestByMarket.set(marketKey, {
      marketKey,
      prediction: row.prediction,
      selections: row.selections.map((s) => ({
        key: s.key,
        ...(s.label !== undefined ? { label: s.label } : {}),
        modelProbPct: s.modelProbPct,
        odd: s.odd,
      })),
    });
  }
  return summarizeSources([...latestByMarket.values()]);
}

function summarizeSources(sources: AnalysisSource[]): MarketAnalysisSummary[] {
  const summaries: MarketAnalysisSummary[] = [];
  for (const { prediction, marketKey, selections } of sources) {
    // getMarketPresentation THROWA em marketKey desconhecido. Pula este mercado em vez
    // de anular a manchete inteira (espelha a tolerância de toBestBetView) — defesa
    // contra um mercado novo sem rótulo de presentation; os mercados vivos têm todos.
    let presentation;
    try {
      presentation = getMarketPresentation(marketKey);
    } catch {
      continue;
    }
    const recommendation = prediction.recommendation;
    const isPass = recommendation === "pass";

    // Rótulo legível da seleção recomendada: prefere o `label` threadado (mercados
    // dynamicSelections — nome do jogador) ao presentation.selectionLabel(key) (que
    // devolveria a key crua). `pass`/recomendação não-presente → null.
    const recSel = isPass
      ? undefined
      : selections.find((s) => s.key === recommendation);
    // Com a linha (over/under): uma análise salva pode ser de outra linha (1.5, 3.5);
    // "Over" sozinho faria a síntese assumir 2.5.
    const line = finiteOrNull(prediction.marketParams?.line) ?? presentation.defaultLine;
    const recommendedLabel = isPass
      ? null
      : (recSel?.label ?? presentation.outcomeLabel(recommendation, line));

    summaries.push({
      marketKey,
      marketLabel: presentation.marketLabel,
      recommendation,
      recommendedLabel,
      isPass,
      modelProbPct: finiteOrNull(recSel?.modelProbPct),
      edgePct: prediction.edgePct !== null ? Number(prediction.edgePct) : null,
      confidencePct:
        prediction.confidencePct !== null
          ? Number(prediction.confidencePct)
          : null,
      oddAtRecommendation:
        prediction.oddAtRecommendation !== null
          ? Number(prediction.oddAtRecommendation)
          : null,
      rationale: synthesisRationale(prediction),
      predictionId: prediction.id,
      engine: analysisEngineOf(prediction),
      odds: frozenOdds(selections),
      line: finiteOrNull(prediction.marketParams?.line),
      predictionCreatedAt: isoOrNull(prediction.createdAt),
      judgmentsModel: judgmentsModelOf(prediction),
      factorPhrases: synthesisFactorPhrases(prediction),
      ...newsNotesField(prediction),
      // Só as seleções COM prob: sem isso o schema da síntese rejeitava o input inteiro
      // (um jogador sem estimativa derrubava a manchete de todos os mercados).
      selections: selections.flatMap((s) => {
        const modelProbPct = finiteOrNull(s.modelProbPct);
        if (modelProbPct === null) return [];
        return [
          {
            key: s.key,
            ...(s.label !== undefined ? { label: s.label } : {}),
            modelProbPct,
          },
        ];
      }),
    });
  }
  // Edge desc só como contexto (pass = sem edge → fim da lista). NÃO é o "pick".
  summaries.sort((a, b) => (b.edgePct ?? -Infinity) - (a.edgePct ?? -Infinity));
  return summaries;
}

function frozenOdds(
  selections: AnalysisSource["selections"],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of selections) {
    const odd = finiteOrNull(s.odd);
    if (odd !== null && odd > 1) out[s.key] = asStoredOdd(odd);
  }
  return out;
}

function isoOrNull(d: Date | string | null | undefined): string | null {
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d.toISOString();
  return typeof d === "string" ? d : null;
}

function judgmentsModelOf(
  prediction: PredictResult["prediction"],
): AnalysisJudgmentsModel | null {
  const j = prediction.judgments;
  if (j?.engine !== "code_jev" || !j.lambda) return null;
  return {
    base: { home: j.lambda.base.home, away: j.lambda.base.away },
    adjusted: { home: j.lambda.adjusted.home, away: j.lambda.adjusted.away },
    rho: j.lambda.rho ?? null,
    stateHash: j.stateHash,
    jevAiCallId: j.aiCallId ?? null,
    factors: weighedFactorInputs(j),
  };
}

// O motor da análise: o carimbo dos julgamentos (code_jev) ou a tag do modelVersion.
function analysisEngineOf(
  prediction: PredictResult["prediction"],
): AnalysisEngine | null {
  if (prediction.judgments?.engine) return prediction.judgments.engine;
  return typeof prediction.modelVersion === "string"
    ? engineFromModelVersion(prediction.modelVersion)
    : null;
}

// ─── Contexto extra (#565) fora da síntese ───────────────────────────────────

// Times genéricos nas frases de fator: a síntese já recebe os nomes no cabeçalho.
const GENERIC_TEAMS = { home: "mandante", away: "visitante" };

// As notícias aplicadas na análise (#672), relidas pelo Zod (jsonb). Ilegível → sem.
function newsOf(prediction: PredictResult["prediction"]): MatchModelNews | null {
  const raw = prediction.judgments?.news;
  if (raw === undefined) return null;
  const parsed = MatchModelNewsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// Há `judgments.news` gravado, mas o Zod não o lê: não dá pra saber quais fatores a
// notícia moveu.
function newsUnreadable(prediction: PredictResult["prediction"]): boolean {
  return prediction.judgments?.news !== undefined && newsOf(prediction) === null;
}

function newsNotesField(prediction: PredictResult["prediction"]): { newsNotes?: string[] } {
  if (prediction.judgments?.engine !== "code_jev") return {};
  const notes = newsOf(prediction)?.notes ?? [];
  return notes.length > 0 ? { newsNotes: notes } : {};
}

// O que o número já tinha antes do usuário (JEV ∨ notícia), os fatores que a notícia
// moveu (origem nas frases) e os que o usuário moveu (fora da síntese). `userMoved` null
// = contexto ilegível (na dúvida, tratado como movido).
function judgmentsReading(prediction: PredictResult["prediction"]): {
  modelAnswers: JudgmentAnswers | null;
  newsOrigins: FactorOrigins;
  userMoved: Set<JudgmentQuestionId> | null;
  noted: boolean;
} | null {
  const judgments = prediction.judgments;
  if (judgments?.engine !== "code_jev") return null;
  const news = newsOf(prediction);
  const modelAnswers = modelAnswersOf({ answers: judgments.answers, news });
  const jevApplied = judgments.answers !== null;
  const newsOrigins: FactorOrigins = {};
  if (news) {
    for (const [id, strength] of Object.entries(newsFactorOrigins(news.claims, judgments.answers))) {
      if (strength) newsOrigins[id as JudgmentQuestionId] = { by: "news", strength };
    }
  }
  if (judgments.userContext === undefined) {
    return { modelAnswers, newsOrigins, userMoved: new Set(), noted: false };
  }
  const parsed = PredictionUserContextSchema.safeParse(judgments.userContext);
  if (!parsed.success) return { modelAnswers, newsOrigins, userMoved: null, noted: true };
  return {
    modelAnswers,
    newsOrigins,
    userMoved: new Set(
      parsed.data.claims.flatMap((c) => claimEffect(c, modelAnswers, jevApplied).moved),
    ),
    // Nota do contexto extra (#569): o racional a cita mesmo sem fator movido.
    noted: hasContextNote(parsed.data.claims),
  };
}

function factorPhrasesOf(
  prediction: PredictResult["prediction"],
  reading: NonNullable<ReturnType<typeof judgmentsReading>>,
  userMoved: ReadonlySet<JudgmentQuestionId>,
): string[] {
  const judgments = prediction.judgments;
  if (!reading.modelAnswers || !judgments?.multipliers) return [];
  // Notícia ilegível: na dúvida, nenhum fator (como o contexto ilegível). Senão um fator
  // que a notícia moveu sairia como fator do modelo, sem a origem.
  if (newsUnreadable(prediction)) return [];
  return judgmentFactorPhrases(
    reading.modelAnswers,
    withoutFactors(judgments.multipliers, userMoved),
    GENERIC_TEAMS,
    Object.keys(reading.newsOrigins).length > 0
      ? { jev: judgments.answers, origins: reading.newsOrigins }
      : undefined,
  );
}

/**
 * O racional que a síntese vê. A manchete pode ser compartilhada (/p) e a síntese não
 * sabe de onde veio cada fator: quando o contexto extra do usuário moveu algum fator
 * (PLAN-565 §13.2, emenda do ADR 0055) ou deixou nota pro narrador (#569), o racional do
 * narrador (que cita o que a pessoa informou) NÃO vai. No lugar, um racional montado em
 * código só com os fatores que o usuário não moveu (os da notícia com a origem, #672);
 * sem nenhum, vazio (a linha "Racional" some). As probs e a seleção seguem as da row.
 * O "moveu?" do usuário mede contra JEV ∨ notícia (o que o número já tinha).
 */
function synthesisRationale(prediction: PredictResult["prediction"]): string {
  const reading = judgmentsReading(prediction);
  if (!reading || prediction.judgments?.userContext === undefined) {
    return prediction.rationale;
  }
  if (reading.userMoved?.size === 0 && !reading.noted) return prediction.rationale;
  if (!reading.userMoved) return "";
  const phrases = factorPhrasesOf(prediction, reading, reading.userMoved);
  return phrases.length > 0 ? `Fatores do modelo: ${phrases.join("; ")}.` : "";
}

// Os fatores pra síntese, sem os que o contexto extra do usuário moveu (#565), com os da
// notícia marcados "(segundo o ge…)" (#672). Contexto ou notícia ilegível: na dúvida,
// nenhum fator (como no racional). Sem notícia, as mesmas frases de antes (palpites_v14).
function synthesisFactorPhrases(prediction: PredictResult["prediction"]): string[] {
  const reading = judgmentsReading(prediction);
  if (!reading || !reading.userMoved) return [];
  return factorPhrasesOf(prediction, reading, reading.userMoved);
}

function withoutFactors(
  m: JudgmentMultipliers,
  drop: ReadonlySet<JudgmentQuestionId>,
): JudgmentMultipliers {
  const strip = (side: JudgmentMultipliers["home"]) => ({
    ...side,
    factors: Object.fromEntries(
      Object.entries(side.factors).filter(([id]) => !drop.has(id as JudgmentQuestionId)),
    ),
  });
  return { home: strip(m.home), away: strip(m.away) };
}
