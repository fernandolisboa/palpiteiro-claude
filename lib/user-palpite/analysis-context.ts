import type { PredictionJudgments } from "@/lib/ai/engine/types";
import type { JudgmentAbsenceInput } from "@/lib/ai/judgments/state";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import type { UserFactorOrigins } from "@/lib/ai/markets/_narrator/types";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import type {
  NormalizedFixture,
  NormalizedStanding,
} from "@/lib/providers/sports-data/types";

import { checkClaims, type PalpiteFacts } from "./check-claims";
import {
  USER_EVIDENCE_VERSION,
  claimEffect,
  combineAnswers,
  evidenceFromClaims,
} from "./evidence";
import type { TeamNames } from "./reading";
import {
  PredictionUserContextSchema,
  type CheckedClaim,
  type Claim,
  type PredictionUserContext,
  type StoredContextClaim,
  type UserEvidence,
} from "./types";

// Contexto extra da análise com IA (#565, emenda ao ADR 0055). PURO: o predict confere
// as afirmações com os dados que ELE buscou e aplica a evidência pelas mesmas regras do
// "Seu palpite" (evidenceFromClaims + combineAnswers). Nada aqui guarda texto livre nem
// nome de jogador.

/** Tira a paráfrase, os nomes e o nome por jogador; fica a contagem e os status. */
export function toStoredContextClaim(c: CheckedClaim): StoredContextClaim {
  const { text: _text, players, playerChecks, ...rest } = c;
  return {
    ...rest,
    ...(players?.length ? { playersCount: players.length } : {}),
    playerChecks: playerChecks.map((p) => ({ status: p.status, questionId: p.questionId })),
  };
}

/**
 * Fatos da conferência a partir do que o predict já buscou: desfalques enriquecidos
 * com a escalação anterior (o mesmo papel que o JEV viu), forma e tabela. Desfalque
 * indisponível no provider vira "indisponível", nunca lista vazia.
 */
export function factsFromAnalysisData(d: {
  absences: { home: JudgmentAbsenceInput[]; away: JudgmentAbsenceInput[] } | null;
  homeForm: readonly NormalizedFixture[];
  awayForm: readonly NormalizedFixture[];
  standings: NormalizedStanding | undefined;
}): PalpiteFacts {
  return {
    absences: d.absences ? { available: true, data: d.absences } : { available: false },
    form: { available: true, data: { home: [...d.homeForm], away: [...d.awayForm] } },
    standings: d.standings ? { available: true, data: d.standings } : { available: false },
  };
}

export type AppliedUserContext = {
  // JEV ∨ usuário: o que TODO mercado do run aplica.
  answers: JudgmentAnswers | null;
  evidence: UserEvidence;
  // Fatores que o usuário moveu e a força do sinal que os moveu (origem nas frases do
  // narrador).
  origins: UserFactorOrigins;
  // Alguma afirmação moveu um fator (tag `user=` no modelVersion).
  moved: boolean;
  stored: PredictionUserContext;
};

export function applyUserClaims(args: {
  claims: readonly Claim[];
  facts: PalpiteFacts;
  teams: TeamNames;
  league: SupportedLeague;
  kickoffAt: Date;
  jev: JudgmentAnswers | null;
  extractionAiCallId: string | null;
  warnings: string[];
  extractVersion: string;
}): AppliedUserContext {
  const checked = checkClaims({
    claims: args.claims,
    facts: args.facts,
    teams: args.teams,
    league: args.league,
    kickoffAt: args.kickoffAt,
  });
  const evidence = evidenceFromClaims(checked, { jevApplied: args.jev !== null });
  // Origem por SINAL, não pelo status da afirmação: "confirmado" só quando foi um sinal
  // de força "confirmed" (posição nossa) que moveu o fator. Desfalque confirmado na
  // nossa lista como meio-campista, com o papel dito pelo usuário, move pelo sinal
  // "unverified" e sai "não conferido".
  const origins: UserFactorOrigins = {};
  for (const c of checked) {
    const byConfirmed = new Set(
      claimEffect({ signals: c.signals.filter((s) => s.strength === "confirmed") }, args.jev)
        .moved,
    );
    for (const q of claimEffect(c, args.jev).moved) {
      origins[q] = origins[q] === "confirmed" || byConfirmed.has(q) ? "confirmed" : "unverified";
    }
  }
  return {
    answers: Object.keys(evidence).length > 0 ? combineAnswers(args.jev, evidence) : args.jev,
    evidence,
    origins,
    moved: Object.keys(origins).length > 0,
    stored: {
      claims: checked.map(toStoredContextClaim),
      evidence,
      extractionAiCallId: args.extractionAiCallId,
      warnings: args.warnings,
      versions: { userEvidence: USER_EVIDENCE_VERSION, extract: args.extractVersion },
    },
  };
}

type HistoryRow = {
  marketKey: string | null;
  prediction: {
    createdAt: Date;
    judgments: PredictionJudgments | null;
    isLive?: boolean;
  };
};

/**
 * O contexto exibido na página: a row `code_jev` mais nova entre as ÚLTIMAS de pré-jogo
 * por mercado (as que aparecem nas seções; leituras ao vivo ficam de fora), com o
 * `userContext` DELA ou nada. Não filtra antes de
 * escolher: uma reanálise sem contexto esconde o contexto do run anterior. Histórico em
 * ordem desc(createdAt), como a página recebe.
 */
export function pickUserContext(
  rows: readonly HistoryRow[],
): { context: PredictionUserContext; jevAnswers: JudgmentAnswers | null; createdAt: Date } | null {
  const seen = new Set<string>();
  let newest: HistoryRow | null = null;
  for (const row of rows) {
    // Leitura ao vivo (#594): sem judgments nem contexto extra; não ocupa o mercado
    // (senão a leitura das 16h esconderia o contexto da análise de pré-jogo).
    if (row.prediction.isLive === true) continue;
    const marketKey = row.marketKey ?? "over_under";
    if (seen.has(marketKey)) continue;
    seen.add(marketKey);
    if (row.prediction.judgments?.engine !== "code_jev") continue;
    if (!newest || row.prediction.createdAt > newest.prediction.createdAt) newest = row;
  }
  const judgments = newest?.prediction.judgments;
  if (!newest || !judgments?.userContext) return null;
  const parsed = PredictionUserContextSchema.safeParse(judgments.userContext);
  if (!parsed.success || parsed.data.claims.length === 0) return null;
  return {
    context: parsed.data,
    jevAnswers: judgments.answers ?? null,
    createdAt: newest.prediction.createdAt,
  };
}

// ─── Aviso do HERO (depois do fan-out) ───────────────────────────────────────

export const CONTEXT_APPLIED_NOTICE =
  'Conferimos o seu contexto extra e ele entrou na análise. Veja o que entrou em "Ler análise completa".';
export const CONTEXT_NO_EFFECT_NOTICE =
  'Conferimos o seu contexto extra, mas ele não mudou a análise: o que você contou foi contradito pelos nossos dados, o modelo já considerava, ou não é um tipo que a gente confere. Veja em "Ler análise completa".';
export const CONTEXT_EMPTY_NOTICE =
  "Não achamos no seu contexto extra nenhuma afirmação de fato pra conferir; a análise seguiu sem ele.";
export const CONTEXT_FAILED_NOTICE =
  "Não consegui ler o seu contexto extra agora; a análise seguiu sem ele.";
export const CONTEXT_NOT_USED_NOTICE =
  "Não deu pra usar o seu contexto extra nesta análise; ela seguiu sem ele.";
export const CONTEXT_UNAVAILABLE_NOTICE =
  "O contexto extra não está disponível agora; a análise seguiu sem ele.";

export type ContextExtraction =
  | { ok: true; claims: readonly unknown[]; warnings: readonly string[] }
  | { ok: false };

/**
 * O que de fato aconteceu com o contexto no run: extração (falhou, vazia) e, quando
 * houve afirmação, se alguma row `code_jev` gravada levou o contexto e se alguma
 * afirmação moveu um fator. `extraction` null = extração estourou o teto.
 */
export function analysisContextNotice(
  extraction: ContextExtraction | null,
  judgments: readonly (PredictionJudgments | null | undefined)[],
): string {
  if (!extraction?.ok) return CONTEXT_FAILED_NOTICE;
  if (extraction.claims.length === 0) return CONTEXT_EMPTY_NOTICE;
  const withContext = judgments.filter(
    (j): j is PredictionJudgments & { userContext: PredictionUserContext } =>
      j?.userContext !== undefined,
  );
  const base =
    withContext.length === 0
      ? CONTEXT_NOT_USED_NOTICE
      : withContext.some((j) =>
            j.userContext.claims.some((c) => claimEffect(c, j.answers).moved.length > 0),
          )
        ? CONTEXT_APPLIED_NOTICE
        : CONTEXT_NO_EFFECT_NOTICE;
  return [base, ...new Set(extraction.warnings)].join(" ");
}
