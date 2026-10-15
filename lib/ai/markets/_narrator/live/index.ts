import type { FidelityCheck } from "@/lib/ai/palpites/fidelity-validator";

import { toToolDef } from "../../types";
import { PERCENT_RE, PERCENT_TOLERANCE_PP, recommends } from "../fidelity";
import { fmtNumber, selectionAliases } from "../labels";
import { KEY_FACTORS_MAX, RATIONALE_MAX_CHARS } from "../prompt";
import { NarratorOutputSchema, type NarratorOutput } from "../schemas";
import type { NarratorTeams } from "../types";
import {
  LIVE_SYSTEM_PROMPT,
  NARRATOR_LIVE_VERSION,
  SUBMIT_LIVE_NARRATION_TOOL,
} from "./prompt";

// Narrador ao vivo (#594, ADR 0060 §8). A leitura vem do código (modelo em jogo); o
// LLM só escreve. Tudo aqui é puro e sem I/O.

/** Uma seleção lida ao vivo: prob. do modelo para o RESULTADO FINAL. */
export type LiveReadingSelection = {
  key: string;
  label: string;
  modelProbPct: number;
  // O placar já resolveu a seleção (prob. exata 0 ou 100).
  decided: boolean;
};

export type LiveReadingMarket = {
  marketKey: string;
  marketLabel: string;
  line: number | null;
  selections: LiveReadingSelection[];
};

export type LiveSituation = {
  // "aos 63'", "aos 45+2'", "no intervalo".
  moment: string;
  score: { home: number; away: number };
  // Vermelhos por time; null = sem dado de expulsão.
  red: { home: number; away: number } | null;
};

export type LiveNarratorDecision = {
  teams: NarratorTeams;
  situation: LiveSituation;
  // Gols esperados no tempo que falta (μ do modelo em jogo).
  remainingGoals: { home: number; away: number };
  // O mercado narrado vem PRIMEIRO; os demais são contexto da mesma leitura.
  readings: LiveReadingMarket[];
};

export type LiveNarratorContext = { leagueLabel: string };

function pct(n: number): string {
  return `${fmtNumber(n)}%`;
}

function scoreLine(d: LiveNarratorDecision): string {
  return `${d.teams.home} ${d.situation.score.home} × ${d.situation.score.away} ${d.teams.away}`;
}

function redLine(d: LiveNarratorDecision): string {
  const r = d.situation.red;
  if (r === null) return "- Expulsões: sem dado";
  if (r.home === 0 && r.away === 0) return "- Expulsões: nenhuma";
  const parts: string[] = [];
  if (r.home > 0) parts.push(`${d.teams.home} ${r.home}`);
  if (r.away > 0) parts.push(`${d.teams.away} ${r.away}`);
  return `- Expulsões (cartão vermelho): ${parts.join("; ")}`;
}

function selectionText(s: LiveReadingSelection): string {
  return `${s.label} ${pct(s.modelProbPct)}${s.decided ? " (já decidido)" : ""}`;
}

function marketText(m: LiveReadingMarket): string {
  const line = m.line === null ? "" : ` (linha ${fmtNumber(m.line)})`;
  return `- ${m.marketLabel}${line}: ${m.selections.map(selectionText).join("; ")}`;
}

export function buildLiveNarratorMessage(
  decision: LiveNarratorDecision,
  context: LiveNarratorContext
): string {
  const d = decision;
  return [
    "## Situação do jogo",
    `- Jogo: ${d.teams.home} (casa) x ${d.teams.away} (fora) — ${context.leagueLabel}`,
    `- Momento: ${d.situation.moment}`,
    `- Placar: ${scoreLine(d)}`,
    redLine(d),
    "",
    "## Leitura ao vivo (fixa — não altere)",
    "- Decisão: LEITURA SEM APOSTA (sem odd ao vivo, o app não recomenda aposta)",
    "- Chances do modelo para o resultado final, com o placar e o tempo que falta:",
    ...d.readings.map(marketText),
    `- Gols esperados no tempo que falta: ${d.teams.home} ${fmtNumber(d.remainingGoals.home, 2)} × ${fmtNumber(d.remainingGoals.away, 2)} ${d.teams.away}`,
    "",
    "Escreva o racional e os fatores-chave desta leitura via submit_narration.",
  ].join("\n");
}

// Termos de aposta que a leitura ao vivo nunca usa (regra 5 do prompt).
const FORBIDDEN_LIVE_TERMS: RegExp[] = [
  /\baposte\b/iu,
  /\bvalor\b/iu,
  /\bedge\b/iu,
  /\bstake\b/iu,
  /\blucros?\b/iu,
];

function allowedLivePercents(d: LiveNarratorDecision): number[] {
  return d.readings.flatMap((m) => m.selections.map((s) => s.modelProbPct));
}

/**
 * Fidelidade da narração ao vivo, no espírito da de pré-jogo: pura, nunca lança.
 * Reprova quando (1) cita um percentual fora da leitura (±1pp), (2) recomenda qualquer
 * seleção (a leitura nunca é aposta) ou (3) usa termo de aposta proibido.
 */
export function checkLiveNarrationFidelity(
  output: NarratorOutput,
  decision: LiveNarratorDecision
): FidelityCheck {
  const text = [output.rationale, ...output.key_factors].join(" \n ");

  const allowed = allowedLivePercents(decision);
  for (const m of text.matchAll(PERCENT_RE)) {
    const cited = Number(m[1].replace(",", "."));
    if (!Number.isFinite(cited)) continue;
    if (!allowed.some((a) => Math.abs(a - cited) <= PERCENT_TOLERANCE_PP)) {
      return {
        ok: false,
        reason: `percentual citado ${m[0].trim()} não está na leitura ao vivo`,
      };
    }
  }

  for (const re of FORBIDDEN_LIVE_TERMS) {
    const hit = text.match(re);
    if (hit) {
      return { ok: false, reason: `termo de aposta '${hit[0]}' na leitura ao vivo` };
    }
  }

  for (const market of decision.readings) {
    for (const s of market.selections) {
      for (const alias of selectionAliases(
        market.marketKey,
        s.key,
        decision.teams,
        market.line
      )) {
        if (recommends(text, alias)) {
          return {
            ok: false,
            reason: `texto recomenda '${s.key}' numa leitura sem aposta`,
          };
        }
      }
    }
  }
  return { ok: true };
}

/**
 * Racional NEUTRO templado em código para UM mercado (o primeiro de `readings`): o
 * fallback da narração paga e o texto dos mercados que não são narrados. Só os números
 * da leitura.
 */
export function templatedLiveNarration(d: LiveNarratorDecision): NarratorOutput {
  const market = d.readings[0];
  const situation = `${capitalize(d.situation.moment)}, ${scoreLine(d)}.`;
  const chances = market
    ? ` Pelo modelo, com o placar e o tempo que falta, ${market.marketLabel.toLowerCase()}${market.line === null ? "" : ` (linha ${fmtNumber(market.line)})`}: ${market.selections.map(selectionText).join("; ")}.`
    : "";
  const rationale = `${situation} Sem odd ao vivo, o app não recomenda aposta.${chances}`;
  const factors = [
    `Placar ${d.situation.score.home} × ${d.situation.score.away} ${d.situation.moment}`,
    `Gols esperados no tempo que falta: ${fmtNumber(d.remainingGoals.home, 2)} × ${fmtNumber(d.remainingGoals.away, 2)}`,
  ];
  const red = d.situation.red;
  if (red && (red.home > 0 || red.away > 0)) {
    factors.push(redLine(d).replace(/^- /, ""));
  }
  return {
    rationale: rationale.slice(0, RATIONALE_MAX_CHARS),
    key_factors: factors.slice(0, KEY_FACTORS_MAX),
  };
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

export const liveNarratorCartridge = {
  version: NARRATOR_LIVE_VERSION,
  systemPrompt: LIVE_SYSTEM_PROMPT,
  tool: toToolDef(SUBMIT_LIVE_NARRATION_TOOL),
  toolName: SUBMIT_LIVE_NARRATION_TOOL.name,
  outputSchema: NarratorOutputSchema,
  buildUserMessage: buildLiveNarratorMessage,
  checkFidelity: checkLiveNarrationFidelity,
  fallback: templatedLiveNarration,
} as const;

export { LIVE_SYSTEM_PROMPT, NARRATOR_LIVE_VERSION, SUBMIT_LIVE_NARRATION_TOOL };
