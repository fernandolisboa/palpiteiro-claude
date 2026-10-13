import type { UserPalpiteAnalysisRecord } from "@/lib/db/queries/user-palpite-analyses";
import { formatRelativeAgoLabel } from "@/lib/format";
import { claimEffect } from "@/lib/user-palpite/evidence";
import {
  effectLabel,
  modelLabel,
  STATUS_LABEL,
  TOPIC_LABEL,
} from "@/lib/user-palpite/labels";
import { lambdasFor } from "@/lib/user-palpite/lambdas";
import type { PalpiteModelBase } from "@/lib/user-palpite/model-base";
import {
  palpiteLabel,
  ptPct,
  readingSentence,
  resultOf,
  type TeamNames,
} from "@/lib/user-palpite/reading";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import type {
  CheckedClaim,
  ClaimStatus,
  NarrationSource,
  PalpiteReading,
  PalpiteVerdict,
  UserPalpite,
} from "@/lib/user-palpite/types";

// Mappers PUROS do bloco "Seu palpite" (#564). Seguros no cliente: o componente usa
// `toReadingRowsView` na leitura grátis pelos botões e a página/action usam os demais
// com os MESMOS textos. Nada aqui fala de odd, edge ou stake (envelope legal).

// ─── Modelo serializado pro cliente ─────────────────────────────────────────

// λ/ρ da leitura "sem o seu contexto" (base × JEV). O cliente refaz a matriz com
// readingMatrix e lê com readPalpite: os mesmos números da análise gravada.
export type SeuPalpiteModelView = {
  lambdaHome: number;
  lambdaAway: number;
  rho: number | null;
  modelLabel: string;
  jevApplied: boolean;
};

export type SeuPalpiteData = {
  model: SeuPalpiteModelView | null;
  latest: UserPalpiteAnalysisView | null;
};

export function toSeuPalpiteModelView(base: PalpiteModelBase): SeuPalpiteModelView {
  const l = lambdasFor(base, base.jevAnswers);
  const jevApplied = base.jevAnswers !== null;
  return {
    lambdaHome: l.lambdaHome,
    lambdaAway: l.lambdaAway,
    rho: base.rho,
    modelLabel: modelLabel({ ...base, jevApplied }),
    jevApplied,
  };
}

/**
 * Dados do bloco na página, cada metade com a sua falha: a última análise gravada que
 * não carrega (query, row) NÃO esconde a leitura grátis pelos botões, e vice-versa.
 */
export async function loadSeuPalpiteData(input: {
  base: () => Promise<PalpiteModelBase | null>;
  latest: () => Promise<UserPalpiteAnalysisRecord | null>;
  teams: TeamNames;
  now: Date;
  onError: (error: "seu_palpite_failed" | "seu_palpite_latest_failed", err: unknown) => void;
}): Promise<SeuPalpiteData> {
  const [model, latest] = await Promise.all([
    Promise.resolve()
      .then(input.base)
      .then((b) => (b ? toSeuPalpiteModelView(b) : null))
      .catch((err: unknown) => {
        input.onError("seu_palpite_failed", err);
        return null;
      }),
    Promise.resolve()
      .then(input.latest)
      .then((r) => (r ? toUserPalpiteAnalysisView(r, input.teams, input.now) : null))
      .catch((err: unknown) => {
        input.onError("seu_palpite_latest_failed", err);
        return null;
      }),
  ]);
  return { model, latest };
}

// ─── Linhas de uma leitura ──────────────────────────────────────────────────

export type ReadingRowsView = {
  // "Chance desse placar" | "Chance de vitória do X" | "Chance de empate"
  palpiteTitle: string;
  palpitePct: string;
  // "4º placar mais provável" (só placar exato dentro da matriz)
  rank: string | null;
  // Só no placar exato: a chance do resultado que ele implica.
  result: { title: string; pct: string } | null;
  oneXTwo: { home: string; draw: string; away: string };
  topTitle: string;
  top: { label: string; pct: string; isPalpite: boolean }[];
  sentence: string;
};

function resultChanceTitle(p: UserPalpite, teams: TeamNames): string {
  const r = resultOf(p);
  if (r === "draw") return "Chance de empate";
  return `Chance de vitória do ${r === "home" ? teams.home : teams.away}`;
}

function rankLabel(rank: number): string {
  return rank === 1 ? "placar mais provável" : `${rank}º placar mais provável`;
}

export function toReadingRowsView(
  r: PalpiteReading,
  p: UserPalpite,
  teams: TeamNames,
): ReadingRowsView {
  const cells = p.kind === "result" ? r.topWithinResult : r.topScorelines;
  return {
    palpiteTitle: p.kind === "score" ? "Chance desse placar" : resultChanceTitle(p, teams),
    palpitePct: ptPct(r.palpitePct),
    rank: p.kind === "score" && r.scoreRank !== null ? rankLabel(r.scoreRank) : null,
    result:
      p.kind === "score"
        ? { title: resultChanceTitle(p, teams), pct: ptPct(r.resultPct) }
        : null,
    oneXTwo: {
      home: ptPct(r.oneXTwo.home),
      draw: ptPct(r.oneXTwo.draw),
      away: ptPct(r.oneXTwo.away),
    },
    topTitle:
      p.kind === "result" ? "placares mais prováveis nesse resultado" : "placares mais prováveis",
    top: cells.map((c) => ({
      label: `${c.home} × ${c.away}`,
      pct: ptPct(c.pct),
      isPalpite: p.kind === "score" && c.home === p.home && c.away === p.away,
    })),
    sentence: readingSentence(r, p, teams),
  };
}

// ─── Análise gravada ────────────────────────────────────────────────────────

export const VERDICT_LABEL: Record<PalpiteVerdict, string> = {
  concordo: "o modelo concorda",
  discordo: "o modelo discorda",
  em_parte: "o modelo concorda em parte",
};

export type PalpiteClaimView = {
  index: number;
  text: string;
  topicLabel: string;
  status: ClaimStatus;
  statusLabel: string;
  evidence: string;
  // "efeito no modelo: …" | "já considerado pelo modelo" | "sem efeito no modelo"
  effect: string;
  // Resultado por jogador (nomes digitados pelo usuário), só com 2+ jogadores.
  players: { name: string; statusLabel: string }[];
};

export type UserPalpiteAnalysisView = {
  id: string;
  createdAgo: string;
  palpite: UserPalpite;
  palpiteLabel: string;
  // O veredito que vale é o do código; o do LLM fica no registro.
  verdict: PalpiteVerdict;
  verdictLabel: string;
  verdictHeadline: string;
  resumo: string;
  pontos: string[];
  discordancias: { claimText: string; texto: string }[];
  claims: PalpiteClaimView[];
  without: ReadingRowsView;
  with: ReadingRowsView;
  changed: boolean;
  modelLabel: string;
  jevApplied: boolean;
  narrationSource: NarrationSource;
  showFullSquadNote: boolean;
  showUnverifiedNote: boolean;
  warnings: string[];
};

/** "Flamengo 2 × 0 Palmeiras está entre os 3 placares mais prováveis (9,1%)". */
export function verdictHeadline(
  r: PalpiteReading,
  p: UserPalpite,
  teams: TeamNames,
): string {
  const label = palpiteLabel(p, teams);
  const pct = ptPct(r.palpitePct);
  if (p.kind === "result") return `${label}: ${pct}`;
  if (r.scoreRank === null) return `${label}: ${pct}`;
  if (r.scoreRank <= 3) return `${label} está entre os 3 placares mais prováveis (${pct})`;
  return `${label} é o ${rankLabel(r.scoreRank)} (${pct})`;
}

function sameReading(a: PalpiteReading, b: PalpiteReading): boolean {
  return (
    a.palpitePct === b.palpitePct &&
    a.resultPct === b.resultPct &&
    a.oneXTwo.home === b.oneXTwo.home &&
    a.oneXTwo.draw === b.oneXTwo.draw &&
    a.oneXTwo.away === b.oneXTwo.away
  );
}

/**
 * O que a afirmação fez no modelo, em PT-BR. O mesmo texto no "Seu palpite" (#564) e no
 * "o que você acrescentou" da análise com IA (#565). `jev` null = o JEV não rodou.
 */
export function claimEffectText(
  c: Pick<CheckedClaim, "signals">,
  jev: JudgmentAnswers | null,
  teams: TeamNames,
): string {
  const eff = claimEffect(c, jev);
  return eff.moved.length > 0
    ? `efeito no modelo: ${eff.moved.map((q) => effectLabel(q, teams)).join("; ")}`
    : eff.alreadyConsidered
      ? "já considerado pelo modelo"
      : "sem efeito no modelo";
}

export function toUserPalpiteAnalysisView(
  r: UserPalpiteAnalysisRecord,
  teams: TeamNames,
  now: Date,
): UserPalpiteAnalysisView {
  const { model, reading, narration } = r;
  const claims: PalpiteClaimView[] = r.claims.map((c) => {
    return {
      index: c.index,
      text: c.text,
      topicLabel: TOPIC_LABEL[c.topic],
      status: c.status,
      statusLabel: STATUS_LABEL[c.status],
      evidence: c.evidence,
      effect: claimEffectText(c, model.jevAnswers, teams),
      players:
        c.playerChecks.length > 1
          ? c.playerChecks.map((pc) => ({
              name: pc.name,
              statusLabel: STATUS_LABEL[pc.status],
            }))
          : [],
    };
  });
  const byIndex = new Map(r.claims.map((c) => [c.index, c.text]));
  return {
    id: r.id,
    createdAgo: formatRelativeAgoLabel(r.createdAt, now),
    palpite: r.palpite,
    palpiteLabel: palpiteLabel(r.palpite, teams),
    verdict: narration.codeVerdict,
    verdictLabel: VERDICT_LABEL[narration.codeVerdict],
    verdictHeadline: verdictHeadline(reading.with, r.palpite, teams),
    resumo: narration.resumo,
    pontos: narration.pontos,
    discordancias: narration.discordancias.flatMap((d) => {
      const claimText = byIndex.get(d.claimIndex);
      return claimText === undefined ? [] : [{ claimText, texto: d.texto }];
    }),
    claims,
    without: toReadingRowsView(reading.without, r.palpite, teams),
    with: toReadingRowsView(reading.with, r.palpite, teams),
    changed: !sameReading(reading.without, reading.with),
    modelLabel: model.modelLabel,
    jevApplied: model.jevApplied,
    narrationSource: r.narrationSource,
    showFullSquadNote: r.claims.some((c) => c.topic === "full_squad"),
    showUnverifiedNote: r.claims.some(
      (c) =>
        c.status === "unverifiable" &&
        claimEffect(c, model.jevAnswers).moved.length > 0,
    ),
    warnings: narration.warnings,
  };
}
