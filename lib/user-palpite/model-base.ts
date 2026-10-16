import { JUDGMENTS_VERSION } from "@/lib/ai/judgments/questions";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import { resolveSlipModel, type SlipModelMatch } from "@/lib/bets/slip-model";
import { getLatestMatchModelSnapshotWithKickoff } from "@/lib/db/queries/match-model-snapshots";
import { MODEL_SCORELINE_MAX_AGE_MS } from "@/lib/model-base/model-scoreline";
import type { MatchModelSnapshot } from "@/lib/model-base/types";
import { MATCH_MODEL_VERSION } from "@/lib/model-base/version";
import { isInPlayScoreline } from "@/lib/quant/in-play";
import type {
  DixonColesFallbackReason,
  ModelScoreline,
  ModelScorelineSource,
} from "@/lib/quant/match-model";


// Seam do modelo do "Seu palpite" (#564, ADR 0055). Server-only (lê o banco e, no
// fallback, o provider), mas sem `import "server-only"`: o pacote não está nas deps e o
// cliente só faz `import type` daqui.
//
// O λ daqui é SEMPRE o pré-JEV: o caminho "base" lê lambdaHome/AwayBase e devolve as
// respostas JEV à parte; o caminho "live" não tem respostas. Quem lê aplica
// `applyJudgments` UMA vez (lambdasFor), então o JEV nunca entra duas vezes.

export type PalpiteModelBase = {
  origin: "snapshot" | "live";
  snapshotId: string | null;
  // MATCH_MODEL_VERSION quando veio da base.
  modelVersion: string | null;
  // judgments.versions.weights da base (pode diferir do JUDGMENT_WEIGHTS_VERSION atual;
  // as respostas são reaplicadas com os pesos atuais e as duas versões são gravadas).
  snapshotWeightsVersion: string | null;
  source: ModelScorelineSource;
  degraded: boolean;
  fallbackReason: DixonColesFallbackReason | null;
  // Havia base do jogo, mas velha/de outra versão: o cálculo foi ao vivo.
  staleBase: boolean;
  lambdaHomeBase: number;
  lambdaAwayBase: number;
  // null = DIXON_COLES_RHO pinado.
  rho: number | null;
  // null = JEV não aplicado.
  jevAnswers: JudgmentAnswers | null;
};

/** As MESMAS regras de getMatchModelScoreline (lib/model-base/model-scoreline.ts). */
export function isSnapshotUsable(
  s: MatchModelSnapshot,
  kickoffAt: Date,
  now: Date,
): boolean {
  if (s.modelVersion !== MATCH_MODEL_VERSION) return false;
  if (now.getTime() - s.checkedAt.getTime() > MODEL_SCORELINE_MAX_AGE_MS) return false;
  return kickoffAt.getTime() > now.getTime();
}

function snapshotAnswers(s: MatchModelSnapshot): JudgmentAnswers | null {
  const j = s.judgments;
  if (s.jevStatus !== "applied" || !j || !j.applied || !j.answers) return null;
  // Respostas de outro conjunto de perguntas não se aplicam aos fatores de hoje.
  if (j.versions.judgments !== JUDGMENTS_VERSION) return null;
  return j.answers;
}

function fromSnapshot(s: MatchModelSnapshot): PalpiteModelBase {
  const answers = snapshotAnswers(s);
  return {
    origin: "snapshot",
    snapshotId: s.id,
    modelVersion: s.modelVersion,
    snapshotWeightsVersion: answers ? (s.judgments?.versions.weights ?? null) : null,
    source: s.lambdaSource,
    degraded: s.lambdaDegraded,
    fallbackReason: s.lambdaFallbackReason,
    staleBase: false,
    lambdaHomeBase: s.lambdaHomeBase,
    lambdaAwayBase: s.lambdaAwayBase,
    rho: s.rho,
    jevAnswers: answers,
  };
}

function fromLive(m: ModelScoreline, staleBase: boolean): PalpiteModelBase {
  // Defesa (#594): um modelo EM JOGO tem λ = gols já feitos + μ, que não é base de
  // pré-jogo. A base é o pré-jogo que ele carrega; a transformação em jogo vem depois.
  if (isInPlayScoreline(m)) {
    const pre = m.inPlay.preMatch;
    return {
      origin: "live",
      snapshotId: null,
      modelVersion: null,
      snapshotWeightsVersion: null,
      source: pre.source,
      degraded: m.degraded,
      fallbackReason: m.fallbackReason ?? null,
      staleBase,
      lambdaHomeBase: pre.lambdaHome,
      lambdaAwayBase: pre.lambdaAway,
      rho: pre.rho,
      jevAnswers: null,
    };
  }
  return {
    origin: "live",
    snapshotId: null,
    modelVersion: null,
    snapshotWeightsVersion: null,
    source: m.source,
    degraded: m.degraded,
    fallbackReason: m.fallbackReason ?? null,
    staleBase,
    lambdaHomeBase: m.lambdaHome,
    lambdaAwayBase: m.lambdaAway,
    rho: m.rho ?? null,
    jevAnswers: null,
  };
}

/**
 * Base do modelo pro palpite: a base do jogo quando usável (λ pré-JEV + respostas), senão
 * o cálculo ao vivo da porta única das apostas (resolveSlipModel), sem JEV. Nunca lança;
 * null = sem modelo. `liveModel` deixa a página compartilhar a promise da grade.
 *
 * Corrida aceita: se o cron gravar uma base fresca entre a nossa leitura e a do
 * resolveSlipModel, este devolve o λ pós-JEV tratado como base. A janela é de
 * milissegundos (o cron roda a cada 6h) e o efeito tem o teto do clamp.
 *
 * `asOf` (#591, R10): a base "no apito" para o Seu palpite ao vivo. Passar o kickoff; a
 * usabilidade da base é medida em `asOf − 1 ms` (prevalece sobre `now`) e o fallback
 * pede o mesmo `asOf` a resolveSlipModel.
 */
export async function resolvePalpiteModelBase(
  match: SlipModelMatch,
  opts: {
    now?: Date;
    asOf?: Date;
    liveModel?: () => Promise<ModelScoreline | null>;
  } = {},
): Promise<PalpiteModelBase | null> {
  const { asOf } = opts;
  const now = asOf ? new Date(asOf.getTime() - 1) : (opts.now ?? new Date());
  try {
    const found = await getLatestMatchModelSnapshotWithKickoff(match.id);
    if (found && isSnapshotUsable(found.snapshot, found.kickoffAt, now)) {
      return fromSnapshot(found.snapshot);
    }
    const fallback = asOf
      ? () => resolveSlipModel(match, { asOf })
      : () => resolveSlipModel(match);
    const live = await (opts.liveModel ?? fallback)();
    return live ? fromLive(live, found !== null) : null;
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "user_palpite",
        error: "model_base_failed",
        matchId: match.id,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}

// Os helpers puros de λ moram em ./lambdas (sem banco); reexportados por conveniência.
export { lambdasFor, matrixFor } from "./lambdas";
