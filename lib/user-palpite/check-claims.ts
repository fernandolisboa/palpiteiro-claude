import { describeAbsencePt } from "@/lib/ai/markets/_narrator/labels";
import { previousFixture } from "@/lib/ai/engine/judgment-input";
import {
  restBucket,
  tableInputForLeague,
  tableSituation,
  type JudgmentAbsenceInput,
} from "@/lib/ai/judgments/state";
import type { JudgmentQuestionId, TeamSide } from "@/lib/ai/judgments/types";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { normalizeTeamName } from "@/lib/providers/sports-data/team-names";
import type {
  NormalizedFixture,
  NormalizedStanding,
} from "@/lib/providers/sports-data/types";
import { toFormView } from "@/lib/view/sections";

import type { TeamNames } from "./reading";
import type {
  CheckedClaim,
  Claim,
  ClaimSideCheck,
  ClaimSignal,
  ClaimStatus,
  PlayerCheck,
} from "./types";

// Conferência das afirmações do usuário com os NOSSOS dados (#564, ADR 0054 Decisão 2).
// PURO: os fatos chegam prontos (lib/user-palpite/facts.ts). Cada afirmação sai
// confirmada, contradita ou não verificável, com a evidência em PT-BR citando o dado e
// os sinais que ela manda aos fatores do JEV (lib/user-palpite/evidence.ts). A evidência
// nunca traz nome de jogador: o papel vem de describeAbsencePt (LGPD, como state.ts).

// Disponibilidade explícita: "indisponível" nunca vira lista vazia (senão "time
// completo" seria confirmado em falso).
export type Availability<T> = { available: true; data: T } | { available: false };

// Campo ausente = não buscado (nenhuma afirmação pediu esse dado); conta como indisponível.
export type PalpiteFacts = {
  absences?: Availability<{ home: JudgmentAbsenceInput[]; away: JudgmentAbsenceInput[] }>;
  form?: Availability<{ home: NormalizedFixture[]; away: NormalizedFixture[] }>;
  standings?: Availability<NormalizedStanding>;
};

type SideResult = {
  status: ClaimStatus;
  evidence: string;
  signal: ClaimSignal | null;
};

// ─── Nomes ──────────────────────────────────────────────────────────────────

/** NFD, sem acento, minúsculo, [^a-z0-9] → espaço. */
export function normalizePlayerName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const MIN_TOKEN = 3;

function tokens(s: string): string[] {
  return normalizePlayerName(s).split(" ").filter(Boolean);
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizePlayerName(a);
  const nb = normalizePlayerName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  const lastA = ta[ta.length - 1];
  const lastB = tb[tb.length - 1];
  return (
    (lastA.length >= MIN_TOKEN && tb.includes(lastA)) ||
    (lastB.length >= MIN_TOKEN && ta.includes(lastB))
  );
}

export function matchPlayer(
  claimName: string,
  list: readonly JudgmentAbsenceInput[],
):
  | { kind: "match"; absence: JudgmentAbsenceInput }
  | { kind: "ambiguous" }
  | { kind: "none" } {
  const hits = list.filter((a) => namesMatch(claimName, a.injury.player.name));
  if (hits.length === 1) return { kind: "match", absence: hits[0] };
  return hits.length > 1 ? { kind: "ambiguous" } : { kind: "none" };
}

// Partículas que podem ficar entre os tokens de um nome ("G. de Arrascaeta").
const NAME_PARTICLES = new Set(["de", "da", "do", "dos", "das", "del", "van", "von"]);

/**
 * Tira de `text` os nomes de jogador que o usuário citou (LGPD: a paráfrase vai ao
 * narrador e à tela sem nome). Cada sequência de tokens de nome vira "o jogador citado".
 */
export function stripPlayerNames(text: string, players: readonly string[]): string {
  const nameTokens = new Set(
    players.flatMap((p) => tokens(p)).filter((t) => t.length >= MIN_TOKEN),
  );
  if (nameTokens.size === 0) return text;
  // Palavras nas posições ímpares, separadores nas pares.
  const parts = text.split(/([\p{L}\p{N}][\p{L}\p{N}'’-]*)/u);
  const isNameWord = (w: string) =>
    normalizePlayerName(w)
      .split(" ")
      .some((t) => nameTokens.has(t));
  // Inicial ("G") ou partícula ("de") colada antes de uma palavra de nome.
  const isJoiner = (w: string) =>
    NAME_PARTICLES.has(normalizePlayerName(w)) || /^\p{Lu}$/u.test(w);
  const isGlue = (sep: string) => /^[\s.]+$/.test(sep);

  const inName = parts.map((p, i) => i % 2 === 1 && isNameWord(p));
  for (let i = 1; i < parts.length; i += 2) {
    if (!inName[i]) continue;
    for (let j = i - 2; j >= 1 && !inName[j]; j -= 2) {
      if (!isGlue(parts[j + 1]) || !isJoiner(parts[j])) break;
      inName[j] = true;
    }
  }

  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const glued = (k: number) => k >= 1 && inName[k] && isGlue(parts[k + 1] ?? "");
    if (i % 2 === 1) {
      if (!inName[i]) out.push(parts[i]);
      else if (!glued(i - 2)) out.push("o jogador citado");
    } else if (!(inName[i - 1] && inName[i + 1] && isGlue(parts[i]))) {
      out.push(parts[i]);
    }
  }
  return out.join("").replace(/\s{2,}/g, " ").trim();
}

// ─── Regras por tópico ─────────────────────────────────────────────────────

function teamName(side: TeamSide, teams: TeamNames): string {
  return side === "home" ? teams.home : teams.away;
}

function sidesOf(c: Claim): TeamSide[] {
  return c.team === "both" ? ["home", "away"] : [c.team];
}

function roleQuestion(
  role: Claim["role"],
  side: TeamSide,
): JudgmentQuestionId | null {
  if (role === "attack") return `attack_weakened_${side}`;
  if (role === "defense" || role === "goalkeeper") return `defense_weakened_${side}`;
  return null;
}

function absenceCheck(
  name: string,
  claim: Claim,
  side: TeamSide,
  facts: PalpiteFacts,
  teams: TeamNames,
): { check: PlayerCheck; evidence: string; signal: ClaimSignal | null } {
  const fromClaim = roleQuestion(claim.role, side);
  const unverified = (evidence: string) => ({
    check: { name, status: "unverifiable" as const, questionId: fromClaim },
    evidence,
    signal: fromClaim ? { questionId: fromClaim, strength: "unverified" as const } : null,
  });
  const absences = facts.absences;
  if (!absences?.available) {
    return unverified("Não temos a lista de desfalques deste jogo.");
  }
  const team = teamName(side, teams);
  const hit = matchPlayer(name, absences.data[side]);
  if (hit.kind === "ambiguous") {
    return unverified(
      `Mais de um nome da nossa lista do ${team} combina com o citado; não deu pra conferir.`,
    );
  }
  if (hit.kind === "none") {
    return unverified(
      `Não está na nossa lista de desfalques do ${team}; pode ser informação mais nova que a nossa.`,
    );
  }
  const a = hit.absence;
  if (a.injury.status === "doubtful") {
    return unverified("Na nossa lista aparece como dúvida, não como fora.");
  }
  if (a.isRegularStarter === false) {
    return {
      check: { name, status: "confirmed", questionId: null },
      evidence: "Está na nossa lista, mas foi reserva no último jogo: sem efeito no modelo.",
      signal: null,
    };
  }
  // Posição nossa (forward/defensor/goleiro) → sinal confirmado; meio-campista ou sem
  // posição → papel dito pelo usuário, com o peso de não verificável.
  const ours: JudgmentQuestionId | null =
    a.position === "forward"
      ? `attack_weakened_${side}`
      : a.position === "defender" || a.position === "goalkeeper"
        ? `defense_weakened_${side}`
        : null;
  const questionId = ours ?? fromClaim;
  return {
    check: { name, status: "confirmed", questionId },
    evidence: `Está na nossa lista de desfalques do ${team}: ${describeAbsencePt(a)}.`,
    signal: questionId
      ? { questionId, strength: ours ? "confirmed" : "unverified" }
      : null,
  };
}

function fullSquadSide(
  claim: Claim,
  side: TeamSide,
  facts: PalpiteFacts,
  teams: TeamNames,
): SideResult {
  const absences = facts.absences;
  if (!absences?.available) {
    return {
      status: "unverifiable",
      evidence: "Não temos a lista de desfalques deste jogo.",
      signal: null,
    };
  }
  const team = teamName(side, teams);
  const list = absences.data[side];
  // Lista vazia nunca confirma: o provider devolve vazio quando o jogo não casa ou a
  // liga não tem cobertura.
  if (list.length === 0) {
    return {
      status: "unverifiable",
      evidence: `A nossa lista não tem desfalques do ${team}; pode estar incompleta.`,
      signal: null,
    };
  }
  const scope = claim.scope ?? "all";
  const out = list.filter(
    (a) =>
      (scope !== "suspensions" && a.injury.status === "injured") ||
      (scope !== "injuries" && a.injury.status === "suspended"),
  );
  if (out.length === 0) {
    return {
      status: "confirmed",
      evidence: `Na nossa lista o ${team} só tem dúvidas, ninguém fora.`,
      signal: null,
    };
  }
  return {
    status: "contradicted",
    evidence: `A nossa lista tem ${out.length} fora no ${team}: ${out.map(describeAbsencePt).join(", ")}.`,
    signal: null,
  };
}

const MIN_FORM_GAMES = 3;

function formSide(
  claim: Claim,
  side: TeamSide,
  facts: PalpiteFacts,
  teams: TeamNames,
): SideResult {
  const team = teamName(side, teams);
  const form = facts.form;
  if (!form?.available) {
    return {
      status: "unverifiable",
      evidence: `Não temos os últimos jogos do ${team}.`,
      signal: null,
    };
  }
  const view = toFormView({
    homeTeam: teams.home,
    awayTeam: teams.away,
    homeForm: form.data.home,
    awayForm: form.data.away,
  });
  const results = view[side].results;
  if (results.length < MIN_FORM_GAMES) {
    return {
      status: "unverifiable",
      evidence: `Temos só ${results.length} jogo(s) recente(s) do ${team} com placar.`,
      signal: null,
    };
  }
  const w = results.filter((r) => r === "W").length;
  const d = results.filter((r) => r === "D").length;
  const l = results.filter((r) => r === "L").length;
  const evidence = `Últimos ${results.length} jogos do ${team}: ${w}V ${d}E ${l}D.`;
  const hits = claim.direction === "bad" ? l : w;
  const status: ClaimStatus =
    hits >= 3 ? "confirmed" : hits <= 1 ? "contradicted" : "unverifiable";
  return { status, evidence, signal: null };
}

function rotationSide(
  side: TeamSide,
  facts: PalpiteFacts,
  teams: TeamNames,
  kickoffAt: Date,
): SideResult {
  const team = teamName(side, teams);
  const questionId: JudgmentQuestionId = `rotation_risk_${side}`;
  const form = facts.form;
  const prev = form?.available
    ? previousFixture(form.data[side], kickoffAt.getTime())
    : undefined;
  const bucket = restBucket(prev?.kickoffAt, kickoffAt.toISOString());
  if (bucket === "short rest (<72h)") {
    return {
      status: "confirmed",
      evidence: `O ${team} jogou há menos de 72h.`,
      signal: { questionId, strength: "confirmed" },
    };
  }
  return {
    status: "unverifiable",
    evidence: prev
      ? `Pelos nossos dados o ${team} não jogou nas últimas 72h, e o próximo jogo dele não está na nossa base.`
      : `Não sabemos quando o ${team} jogou pela última vez.`,
    signal: { questionId, strength: "unverified" },
  };
}

const HIGH_STAKES = new Set([
  "title race",
  "continental qualification race",
  "relegation zone",
  "relegation battle",
]);
const LOW_STAKES = new Set(["safe mid-table", "secure in continental places"]);

const SITUATION_PT: Record<string, string> = {
  "title race": "briga pelo título",
  "continental qualification race": "briga por vaga continental",
  "relegation zone": "zona de rebaixamento",
  "relegation battle": "briga contra o rebaixamento",
  "safe mid-table": "meio da tabela, sem risco",
  "secure in continental places": "vaga continental bem encaminhada",
  "early season (table not settled)": "início de campeonato",
};

function stakesSide(
  claim: Claim,
  side: TeamSide,
  facts: PalpiteFacts,
  teams: TeamNames,
  league: SupportedLeague,
): SideResult {
  const team = teamName(side, teams);
  const good = claim.direction !== "bad";
  const questionId: JudgmentQuestionId = `high_stakes_${side}`;
  const unverified = (evidence: string): SideResult => ({
    status: "unverifiable",
    evidence,
    signal: good ? { questionId, strength: "unverified" } : null,
  });
  const standings = facts.standings;
  const table = tableInputForLeague(
    league,
    standings?.available ? standings.data : undefined,
  );
  if (!table) {
    return unverified("Não temos tabela de pontos corridos desta competição.");
  }
  const situation = tableSituation(table, team);
  const norm = normalizeTeamName(team);
  const row =
    table.rows.find((r) => r.team === team) ??
    table.rows.find((r) => normalizeTeamName(r.team) === norm);
  const label = SITUATION_PT[situation];
  if (!row || !label) {
    return unverified(`Não achamos o ${team} na tabela.`);
  }
  const evidence = `Na tabela: ${row.position}º com ${row.points} pontos (${label}).`;
  if (HIGH_STAKES.has(situation)) {
    return good
      ? { status: "confirmed", evidence, signal: { questionId, strength: "confirmed" } }
      : { status: "contradicted", evidence, signal: null };
  }
  if (LOW_STAKES.has(situation)) {
    return good
      ? { status: "contradicted", evidence, signal: null }
      : { status: "confirmed", evidence, signal: null };
  }
  return unverified(evidence);
}

function aggregate(statuses: readonly ClaimStatus[]): ClaimStatus {
  if (statuses.some((s) => s === "contradicted")) return "contradicted";
  if (statuses.length > 0 && statuses.every((s) => s === "confirmed")) return "confirmed";
  return "unverifiable";
}

function prefixed(i: number, total: number, sentence: string): string {
  return total > 1 ? `${i + 1}º citado: ${sentence}` : sentence;
}

function checkOne(
  claim: Claim,
  index: number,
  input: { facts: PalpiteFacts; teams: TeamNames; league: SupportedLeague; kickoffAt: Date },
): CheckedClaim {
  const { facts, teams, league, kickoffAt } = input;
  const base = { ...claim, index, playerChecks: [] as PlayerCheck[] };

  if (claim.topic === "absence") {
    const side = sidesOf(claim)[0];
    const players = claim.players ?? [];
    const results = players.map((name) => absenceCheck(name, claim, side, facts, teams));
    // Desfalque nunca é "contradito": não estar na nossa lista não prova que joga.
    const status: ClaimStatus = results.every((r) => r.check.status === "confirmed")
      ? "confirmed"
      : "unverifiable";
    return {
      ...base,
      status,
      evidence: results
        .map((r, i) => prefixed(i, results.length, r.evidence))
        .join(" "),
      sides: [{ side, status }],
      playerChecks: results.map((r) => r.check),
      signals: dedupeSignals(results.flatMap((r) => (r.signal ? [r.signal] : []))),
    };
  }

  if (claim.topic === "other") {
    return {
      ...base,
      status: "unverifiable",
      evidence:
        "Não conferimos esse tipo de informação; fica como contexto, sem efeito no modelo.",
      sides: sidesOf(claim).map((side) => ({ side, status: "unverifiable" })),
      signals: [],
    };
  }

  const perSide = sidesOf(claim).map((side) => ({
    side,
    r:
      claim.topic === "full_squad"
        ? fullSquadSide(claim, side, facts, teams)
        : claim.topic === "form"
          ? formSide(claim, side, facts, teams)
          : claim.topic === "rotation"
            ? rotationSide(side, facts, teams, kickoffAt)
            : stakesSide(claim, side, facts, teams, league),
  }));
  const sides: ClaimSideCheck[] = perSide.map(({ side, r }) => ({ side, status: r.status }));
  // Lado contradito não manda sinal (o switch acima já não emite); os demais, sim.
  const signals = perSide.flatMap(({ r }) =>
    r.signal && r.status !== "contradicted" ? [r.signal] : [],
  );
  const evidence = perSide
    .map(({ r }) => r.evidence)
    .filter((e, i, all) => all.indexOf(e) === i)
    .join(" ");
  return {
    ...base,
    status: aggregate(sides.map((s) => s.status)),
    evidence,
    sides,
    signals: dedupeSignals(signals),
  };
}

// Só tira repetidos idênticos: um "confirmed" e um "unverified" na mesma pergunta pesam
// diferente com JEV presente (evidence.ts), então os dois ficam.
function dedupeSignals(signals: readonly ClaimSignal[]): ClaimSignal[] {
  const seen = new Set<string>();
  return signals.filter((s) => {
    const key = `${s.questionId}:${s.strength}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function checkClaims(input: {
  claims: readonly Claim[];
  facts: PalpiteFacts;
  teams: TeamNames;
  league: SupportedLeague;
  kickoffAt: Date;
}): CheckedClaim[] {
  return input.claims.map((c, i) => checkOne(c, i, input));
}

/** Lados que precisam de dado pra conferir; o resto não gasta chamada. */
export function factsNeeded(claims: readonly Claim[]): {
  absences: boolean;
  form: boolean;
  standings: boolean;
} {
  const topics = new Set(claims.map((c) => c.topic));
  return {
    absences: topics.has("absence") || topics.has("full_squad"),
    form: topics.has("form") || topics.has("rotation"),
    standings: topics.has("stakes"),
  };
}


// ─── Resumo dos fatos pro narrador ───────────────────────────────────────────

const REST_PT: Record<string, string> = {
  "short rest (<72h)": "jogou há menos de 72h",
  "normal rest": "descanso normal",
  "long rest (>7 days)": "mais de 7 dias sem jogar",
};

const RESULT_PT: Record<string, string> = { W: "V", D: "E", L: "D" };

/**
 * Linhas em PT-BR só com o que foi buscado (o narrador não vê o resto). Desfalques por
 * função, nunca por nome.
 */
export function summarizeFacts(input: {
  facts: PalpiteFacts;
  teams: TeamNames;
  league: SupportedLeague;
  kickoffAt: Date;
}): string[] {
  const { facts, teams, league, kickoffAt } = input;
  const lines: string[] = [];
  const both = (f: (side: TeamSide) => string) =>
    `${teams.home}: ${f("home")}; ${teams.away}: ${f("away")}`;

  if (facts.form) {
    const form = facts.form;
    if (form.available) {
      const view = toFormView({
        homeTeam: teams.home,
        awayTeam: teams.away,
        homeForm: form.data.home,
        awayForm: form.data.away,
      });
      lines.push(
        `Forma (últimos jogos, do mais recente): ${both((s) =>
          view[s].results.length > 0
            ? view[s].results.map((r) => RESULT_PT[r]).join(" ")
            : "sem jogos com placar",
        )}`,
      );
      lines.push(
        `Descanso: ${both((s) => {
          const prev = previousFixture(form.data[s], kickoffAt.getTime());
          return REST_PT[restBucket(prev?.kickoffAt, kickoffAt.toISOString())] ?? "desconhecido";
        })}`,
      );
    } else {
      lines.push("Forma e descanso: indisponíveis");
    }
  }

  if (facts.standings) {
    const table = tableInputForLeague(
      league,
      facts.standings.available ? facts.standings.data : undefined,
    );
    if (!table) {
      lines.push("Tabela: sem tabela de pontos corridos");
    } else {
      lines.push(
        `Tabela: ${both((s) => {
          const team = teamName(s, teams);
          const norm = normalizeTeamName(team);
          const row =
            table.rows.find((r) => r.team === team) ??
            table.rows.find((r) => normalizeTeamName(r.team) === norm);
          const label = SITUATION_PT[tableSituation(table, team)];
          return row
            ? `${row.position}º, ${row.points} pts${label ? ` (${label})` : ""}`
            : "fora da tabela";
        })}`,
      );
    }
  }

  if (facts.absences) {
    const absences = facts.absences;
    lines.push(
      absences.available
        ? `Desfalques: ${both((s) =>
            absences.data[s].length > 0
              ? absences.data[s].map(describeAbsencePt).join(", ")
              : "nenhum na nossa lista",
          )}`
        : "Desfalques: lista indisponível",
    );
  }
  return lines;
}
