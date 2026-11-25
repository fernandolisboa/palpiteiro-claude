import type { LineupSummary } from "@/lib/ai/judgments/state";
import type { JudgmentAnswers, JudgmentQuestionId, TeamSide } from "@/lib/ai/judgments/types";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { toStoredContextClaim } from "@/lib/user-palpite/analysis-context";
import { checkClaims, type PalpiteFacts } from "@/lib/user-palpite/check-claims";
import {
  USER_NOUL,
  claimEffect,
  combineAnswers,
  evidenceFromClaims,
} from "@/lib/user-palpite/evidence";
import { otherKindLine } from "@/lib/user-palpite/labels";
import type { TeamNames } from "@/lib/user-palpite/reading";
import type { CheckedClaim, SignalStrength, UserEvidence } from "@/lib/user-palpite/types";

import type {
  MatchModelNews,
  MatchNewsBatchItem,
  NewsClaim,
  StoredNewsClaim,
} from "./types";

// Conferência e evidência das notícias do jogo (#672, PLAN-672 §5 + ajuste 3). PURO: os
// fatos chegam prontos (os que o laço do JEV do cron já buscou). As afirmações passam
// pelo MESMO checkClaims do contexto extra e viram evidência pelos MESMOS nouls
// (USER_NOUL: confirmada 0,85 só sem JEV, não conferível 0,7), combinada com o JEV por
// MÁXIMO, nunca soma: o teto por fator é o de uma afirmação, e o clamp do
// applyJudgments vale como sempre.
//
// Contrato de disponibilidade: dado indisponível nunca vira lista vazia que confirme.
// check-claims nunca confirma "time completo" com lista vazia e nunca contradiz um
// desfalque só por não estar na lista, então as listas vazias que o
// fetchMatchJudgmentData devolve quando o provider de desfalques falha
// (Unsupported/Transient engolidos) dão a mesma evidência que "indisponível".
//
// Mudou a regra (janela, escalação, nouls, o que vira sinal) → bump NEWS_EVIDENCE_VERSION
// (entra no fingerprint da base).
export const NEWS_EVIDENCE_VERSION = "news_evidence_v1";
// Os nouls da notícia são os do contexto do usuário (mudou lá → bump aqui também).
export const NEWS_NOUL: Record<SignalStrength, number> = USER_NOUL;

// Janela das fontes: [min(agora, apito) − 72h, min(agora, apito)] (a mesma do feed).
export const NEWS_WINDOW_MS = 72 * 3_600_000;

export type AppliedNews = {
  // Só o que a notícia acrescenta (nouls por pergunta); {} = nada a aplicar.
  evidence: UserEvidence;
  // JEV ∨ notícia: o que a base aplica. = jev quando a evidência é vazia.
  answers: JudgmentAnswers | null;
  // Fatores movidos e a força do sinal que os moveu.
  origins: Partial<Record<JudgmentQuestionId, SignalStrength>>;
  moved: JudgmentQuestionId[];
  notes: string[];
  // N: notícias do lote na janela.
  itemsRead: number;
  // K: notícias distintas citadas por afirmações que moveram um fator.
  factorItems: number;
  // URLs das notícias citadas pelas afirmações que moveram um fator (fingerprint).
  movedUrls: string[];
  stored: MatchModelNews;
};

const SIDES: TeamSide[] = ["home", "away"];

function sidesOf(c: Pick<NewsClaim, "team">): TeamSide[] {
  return c.team === "both" ? SIDES : [c.team];
}

/**
 * Com a escalação oficial de um lado publicada, o número vem dos dados: o JEV já julgou
 * o XI. Todo sinal de desfalque e de rodízio da notícia daquele lado sai (a afirmação
 * fica registrada, sem efeito).
 */
function dropAnnouncedLineupSignals(
  c: CheckedClaim & { sources: string[] },
  lineup: { home: LineupSummary; away: LineupSummary } | null,
): CheckedClaim & { sources: string[] } {
  if (!lineup || (c.topic !== "absence" && c.topic !== "rotation")) return c;
  const announced = sidesOf(c).filter((s) => lineup[s].status === "announced");
  if (announced.length === 0 || c.signals.length === 0) return c;
  const keep = c.signals.filter(
    (s) => !announced.some((side) => s.questionId.endsWith(`_${side}`)),
  );
  if (keep.length === c.signals.length) return c;
  return {
    ...c,
    signals: keep,
    evidence: `${c.evidence} Escalação oficial publicada: vale a escalação, não a notícia.`,
  };
}

function inWindow(item: MatchNewsBatchItem, fromMs: number, toMs: number): boolean {
  const ms = Date.parse(item.publishedAt);
  return Number.isFinite(ms) && ms >= fromMs && ms <= toMs;
}

/** As notas da notícia: uma por afirmação "other" com subtipo, sem efeito no número. */
export function newsNotes(
  claims: readonly Pick<NewsClaim, "topic" | "otherKind" | "team">[],
  teams: TeamNames,
): string[] {
  const lines = claims.flatMap((c) =>
    c.topic === "other" && c.otherKind
      ? [`${otherKindLine(c.otherKind, c.team, teams)}, segundo o ge (não conferido)`]
      : [],
  );
  return [...new Set(lines)];
}

/**
 * Fatores que as afirmações moveram acima do JEV e a força do sinal que os moveu, por
 * SINAL (a regra do contexto extra, #565): "confirmed" só quando um sinal confirmado
 * pelos nossos dados moveu o fator. Serve às afirmações conferidas na hora e às
 * guardadas em `judgments.news.claims` (os sinais são os mesmos): a síntese e o painel do
 * azarão refazem a origem a partir da row, sem guardar outro campo.
 */
export function newsFactorOrigins(
  claims: readonly Pick<CheckedClaim, "signals">[],
  jev: JudgmentAnswers | null,
): Partial<Record<JudgmentQuestionId, SignalStrength>> {
  const origins: Partial<Record<JudgmentQuestionId, SignalStrength>> = {};
  for (const c of claims) {
    const byConfirmed = new Set(
      claimEffect({ signals: c.signals.filter((s) => s.strength === "confirmed") }, jev).moved,
    );
    for (const q of claimEffect(c, jev).moved) {
      origins[q] = origins[q] === "confirmed" || byConfirmed.has(q) ? "confirmed" : "unverified";
    }
  }
  return origins;
}

export function applyNewsClaims(args: {
  batch: { id: string; promptVersion: string; items: readonly MatchNewsBatchItem[]; claims: readonly NewsClaim[] };
  facts: PalpiteFacts;
  // Resumo da escalação de cada lado (MatchJudgmentInput.lineup); null = desconhecido.
  lineup: { home: LineupSummary; away: LineupSummary } | null;
  teams: TeamNames;
  league: SupportedLeague;
  kickoffAt: Date;
  now: Date;
  // Respostas do JEV SÓ (null = o JEV não respondeu).
  jev: JudgmentAnswers | null;
}): AppliedNews {
  const anchorMs = Math.min(args.now.getTime(), args.kickoffAt.getTime());
  const fromMs = anchorMs - NEWS_WINDOW_MS;
  const items = args.batch.items.filter((i) => inWindow(i, fromMs, anchorMs));
  const byRef = new Map(items.map((i) => [i.ref, i]));

  // Fonte fora da janela sai da afirmação; afirmação sem fonte na janela cai.
  const claims: NewsClaim[] = args.batch.claims.flatMap((c) => {
    const sources = c.sources.filter((s) => byRef.has(s));
    return sources.length > 0 ? [{ ...c, sources }] : [];
  });

  const checked = checkClaims({
    claims,
    facts: args.facts,
    teams: args.teams,
    league: args.league,
    kickoffAt: args.kickoffAt,
  }).map((c) => dropAnnouncedLineupSignals(c as CheckedClaim & { sources: string[] }, args.lineup));

  const jevApplied = args.jev !== null;
  const evidence = evidenceFromClaims(checked, { jevApplied });

  const origins = newsFactorOrigins(checked, args.jev);
  const movedRefs = new Set<string>();
  for (const c of checked) {
    if (claimEffect(c, args.jev).moved.length > 0) for (const s of c.sources) movedRefs.add(s);
  }
  const moved = Object.keys(origins) as JudgmentQuestionId[];
  const notes = newsNotes(checked, args.teams);
  const cited = new Set(checked.flatMap((c) => c.sources));
  const sources = items
    .filter((i) => cited.has(i.ref))
    .map((i) => ({ ref: i.ref, url: i.url, title: i.title }));
  const movedUrls = items.filter((i) => movedRefs.has(i.ref)).map((i) => i.url);

  const storedClaims: StoredNewsClaim[] = checked.map((c) => ({
    ...toStoredContextClaim(c),
    sources: c.sources,
  }));

  return {
    evidence,
    answers: Object.keys(evidence).length > 0 ? combineAnswers(args.jev, evidence) : args.jev,
    origins,
    moved,
    notes,
    itemsRead: items.length,
    factorItems: movedRefs.size,
    movedUrls,
    stored: {
      batchId: args.batch.id,
      itemsRead: items.length,
      claims: storedClaims,
      sources,
      evidence,
      moved,
      notes,
      versions: { extract: args.batch.promptVersion, newsEvidence: NEWS_EVIDENCE_VERSION },
    },
  };
}
