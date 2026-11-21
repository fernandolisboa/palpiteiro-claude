// Conferência do texto contra o palpite decidido em código (#668, ADR 0072). PURA.
//
// O LLM escreve o veredito pro resultado fixado e devolve `verdictOutcome` (o resultado
// que ele acha que escreveu). A conferência é ESTRUTURAL primeiro (verdictOutcome ≠ o
// resultado do palpite) e depois por sinais de alta precisão SÓ no veredito:
//   - cita só o outro time quando o palpite é vitória (tokens comuns aos dois nomes,
//     como "Atlético" ou "Man", não contam);
//   - um placar diferente do palpite ("2 x 1", "1–0", "2 a 1"), em qualquer ordem;
//   - "empate" quando o palpite é vitória e o veredito nem cita o vencedor.
// Contradição-only: o que a regex não pega passa (falso negativo, sem dano); um falso
// positivo troca o veredito pelo de template, que é seguro. A narrativa não passa por
// checagem de resultado (é prosa longa, cheia de "o Flamengo assusta"). Sem regra de
// "zebra": a palavra aparece em veredito coerente ("Sem zebra: Palmeiras vence").

import type { MatchOutcome } from "@/lib/quant/scoreline-model";

export type CoherenceTeams = {
  // Nomes de exibição (os do template).
  home: string;
  away: string;
  // Outras grafias do mesmo time (o nome do provedor), pros apelidos.
  homeAliases?: readonly string[];
  awayAliases?: readonly string[];
};

type PickForText = {
  outcome: MatchOutcome;
  score: { home: number; away: number };
};

export type CoherenceCheck = { ok: true } | { ok: false; reason: string };

// Tokens que não identificam um time (sufixos de clube, preposições).
const STOP_TOKENS = new Set([
  "fc", "ec", "sc", "cr", "se", "ac", "afc", "cf", "ca", "cd", "rj", "sp", "mg",
  "club", "clube", "de", "do", "da", "dos", "das", "del", "the", "futebol",
  "esporte", "regatas", "associacao", "sociedade", "esportiva", "football",
]);
const MIN_TOKEN = 3;

export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokensOf(names: readonly string[]): Set<string> {
  return new Set(names.flatMap((n) => normalizeText(n).split(" ").filter(Boolean)));
}

/**
 * Apelidos de UM time pra procurar no texto: cada nome inteiro normalizado, mais os
 * tokens que o identificam (≥ 3 letras, fora da lista de sufixos e AUSENTES no nome do
 * outro time). Atlético-MG × Atlético-GO: "atletico" sai, sobra o nome inteiro.
 */
export function teamAliases(
  names: readonly string[],
  otherNames: readonly string[],
): string[] {
  const other = tokensOf(otherNames);
  const full = names.map(normalizeText).filter((n) => n.length > 0);
  const tokens = [...tokensOf(names)].filter(
    (t) => t.length >= MIN_TOKEN && !STOP_TOKENS.has(t) && !other.has(t) && !/^\d+$/.test(t),
  );
  return [...new Set([...full, ...tokens])];
}

function mentions(normalizedText: string, aliases: readonly string[]): boolean {
  const padded = ` ${normalizedText} `;
  return aliases.some((a) => a.length > 0 && padded.includes(` ${a} `));
}

// Placar no veredito: "2 x 1", "2x1", "1–0", "1 - 0", "2 a 1". Sem dígito colado dos
// lados (nada de "1,5" ou "2025").
const SCORE_RE = /(?<![\w.,])(\d{1,2})(?:\s*[x×–—-]\s*|\s+a\s+)(\d{1,2})(?![\w.,])/giu;

const DRAW_RE = /\bempat(?:e|es|a|ar|ou|am|ando)\b/;
const DRAW_NEGATED_RE = /\b(?:sem|nada de|nem|longe de|longe do|evita|evitar|foge do|fugir do)\s+(?:o\s+|um\s+)?empat/;

function teamNames(teams: CoherenceTeams, side: "home" | "away"): string[] {
  return side === "home"
    ? [teams.home, ...(teams.homeAliases ?? [])]
    : [teams.away, ...(teams.awayAliases ?? [])];
}

/**
 * Confere o veredito contra o palpite. `verdictOutcome` é o campo estruturado do v13.
 */
export function checkVerdictCoherence(
  verdict: string,
  verdictOutcome: MatchOutcome,
  pick: PickForText,
  teams: CoherenceTeams,
): CoherenceCheck {
  if (verdictOutcome !== pick.outcome) {
    return {
      ok: false,
      reason: `verdictOutcome ${verdictOutcome} ≠ resultado do palpite ${pick.outcome}`,
    };
  }

  for (const m of verdict.matchAll(SCORE_RE)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const { home, away } = pick.score;
    const same = (a === home && b === away) || (a === away && b === home);
    if (!same) {
      return { ok: false, reason: `veredito cita o placar ${a}–${b}, palpite ${home}–${away}` };
    }
  }

  if (pick.outcome === "draw") return { ok: true };

  const text = normalizeText(verdict);
  const winner = pick.outcome;
  const loser = winner === "home" ? "away" : "home";
  const winnerAliases = teamAliases(teamNames(teams, winner), teamNames(teams, loser));
  const loserAliases = teamAliases(teamNames(teams, loser), teamNames(teams, winner));
  const citesWinner = mentions(text, winnerAliases);
  const citesLoser = mentions(text, loserAliases);

  if (citesLoser && !citesWinner) {
    return { ok: false, reason: `veredito cita só o ${loser === "home" ? "mandante" : "visitante"}` };
  }
  if (DRAW_RE.test(text) && !DRAW_NEGATED_RE.test(text) && !citesWinner) {
    return { ok: false, reason: "veredito fala em empate num palpite de vitória" };
  }
  return { ok: true };
}

// ─── Templates (sem %, sem termo de valor) ──────────────────────────────────

export function templateVerdict(pick: PickForText, teams: CoherenceTeams): string {
  if (pick.outcome === "home") return `Vai dar ${teams.home}`;
  if (pick.outcome === "away") return `Vai dar ${teams.away}`;
  return `Empate entre ${teams.home} e ${teams.away}`;
}

export function templateNarrative(pick: PickForText, teams: CoherenceTeams): string {
  const score = `${pick.score.home}–${pick.score.away}`;
  if (pick.outcome === "draw") {
    return `O empate é o resultado mais provável deste jogo, e o placar que mais aparece é ${score}.`;
  }
  const team = pick.outcome === "home" ? teams.home : teams.away;
  return `A vitória do ${team} é o resultado mais provável deste jogo, e o placar que mais aparece é ${score}.`;
}
