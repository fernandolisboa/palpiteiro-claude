// Núcleo PURO do gate de replay eval (scripts/replay-prompt-eval.ts) — sem SDK
// Anthropic, sem db, sem dotenv, sem `main()`. Importável e unit-testável a seco
// (zero chamada paga). O script paga (replay-prompt-eval.ts) importa daqui; a
// orquestração que de fato chama a API (incl. o loop de reprodução adaptive) fica
// LÁ, fora do alcance dos testes.
//
// Model-aware (ADR 0021, #203): a regra de FLIP é bifurcada pelo `thinkingMode` do
// modelo — caminho `temperature` (Sonnet 4.5/Haiku, amostragem fixa em 0.3) é
// estrito (qualquer flip reprova); caminho `adaptive` (Opus/Sonnet 4.6, sem knob de
// amostragem) só reprova se o flip REPRODUZIR na maioria de N re-replays do MESMO
// payload (mata o ruído single-shot — o modo de falha A/A observado no #105). Os
// outros abortos do gate (mediana |Δconf| e errors) NÃO são model-aware.

import { MODEL_REGISTRY, isAIModelId } from "@/lib/ai/models";

export type ThinkingPath = "adaptive" | "temperature";

// N re-replays do MESMO payload pra confirmar um flip adaptive. 3 espelha as 3
// execuções manuais do gate no #105. DEVE ficar >= 3: a confirmação por maioria
// `ceil(N/2)` só é significativa a partir de 3 (com N=2, ceil(2/2)=1 → um flip
// único já "confirmaria", anulando a tolerância a ruído).
export const ADAPTIVE_FLIP_REPRO_RUNS = 3;
export const MAX_DELTA_CONF_MEDIAN_PP = 5;

// Caminho de amostragem do modelo. Id fora do registry (modelo legado/removido —
// ex.: um payload Fable antigo) → "temperature" = caminho ESTRITO (qualquer flip
// reprova). Conservador de propósito: nunca tolera flip de um modelo que não
// conseguimos classificar. O CALLER deve LOGAR ao cair aqui (não tolerar em
// silêncio); a classificação em si é pura.
export function classifyThinkingMode(modelId: string): ThinkingPath {
  return isAIModelId(modelId)
    ? MODEL_REGISTRY[modelId].thinkingMode
    : "temperature";
}

// Um flip no caminho adaptive só conta como reprovação se reproduzir na MAIORIA
// dos N runs (ceil(N/2)). `flippedRuns` conta só runs COMPLETADOS que fliparam;
// reruns que erraram não incrementam (contam como não-flip contra o N FIXO), o que
// empurra a decisão pra TOLERAR — preferimos não reprovar o gate por ruído/API
// flaky (alinhado ao ADR). `n` é sempre ADAPTIVE_FLIP_REPRO_RUNS no caller.
export function isAdaptiveFlipConfirmed(
  flippedRuns: number,
  n: number,
): boolean {
  return flippedRuns >= Math.ceil(n / 2);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// confidence_pct é P(lado recomendado) p/ over/under e P(over) p/ pass. Pra comparar
// |Δconfidence| entre baseline e replay quando há flip envolvendo "under",
// normalizamos os dois lados pra P(over) antes do delta: identidade p/ over/pass,
// complemento (100 − conf) p/ under. Em mesma recommendation = delta cru.
export function pOver(recommendation: string, confidencePct: number): number {
  return recommendation === "under" ? 100 - confidencePct : confidencePct;
}

// Uma linha de resultado já reduzida ao que o veredito precisa. O caller anota
// `flipConfirmed` por payload: no caminho temperature é === flip (estrito); no
// adaptive é o resultado da reprodução em N runs (isAdaptiveFlipConfirmed). Assim
// `computeVerdict` é PURO e testável com linhas fabricadas, sem API.
export type VerdictRow = {
  thinkingMode: ThinkingPath;
  flip: boolean;
  flipConfirmed: boolean;
  deltaConf: number;
};

export type Verdict = {
  failed: boolean;
  confirmedFlips: number;
  toleratedNoiseFlips: number;
  medianDelta: number;
};

// Veredito model-aware. `confirmedFlips` (contam pra reprovação) = linhas com
// flipConfirmed; `toleratedNoiseFlips` = flips adaptive observados mas NÃO
// reproduzidos (ruído — logados, não reprovam). Mediana de |Δconf| e errorCount
// seguem GLOBAIS e intocados (ADR 0021: "não mexer nos outros abortos").
export function computeVerdict(args: {
  results: VerdictRow[];
  errorCount: number;
  maxDeltaConfMedianPp?: number;
}): Verdict {
  const limit = args.maxDeltaConfMedianPp ?? MAX_DELTA_CONF_MEDIAN_PP;
  const confirmedFlips = args.results.filter((r) => r.flipConfirmed).length;
  const toleratedNoiseFlips = args.results.filter(
    (r) => r.thinkingMode === "adaptive" && r.flip && !r.flipConfirmed,
  ).length;
  const medianDelta = median(args.results.map((r) => r.deltaConf));
  const failed =
    confirmedFlips > 0 || medianDelta > limit || args.errorCount > 0;
  return { failed, confirmedFlips, toleratedNoiseFlips, medianDelta };
}
