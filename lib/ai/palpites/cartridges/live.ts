import { z } from "zod";

import { truncate } from "@/lib/ai/ai-call-logging";
import { PERCENT_RE, PERCENT_TOLERANCE_PP } from "@/lib/ai/markets/_narrator/fidelity";
import { toToolDef } from "@/lib/ai/markets/types";
import { getMarketPresentation } from "@/lib/view/markets/presentation";

import type { FidelityCheck } from "../fidelity-validator";
import type { MarketAnalysisSummary } from "../synthesis-input";
import { ExactScoreParamsSchema, MarketAnalysisSchema } from "./cartridge";

// Cartucho de palpite AO VIVO `palpites_live_v1` (#594, ADR 0060, PLAN-580 §12): a
// manchete com o jogo rolando. Recebe a situação do jogo, os placares finais mais
// prováveis do modelo em jogo e as chances por mercado da leitura ao vivo; sem forma,
// confrontos, tabela nem notícias. Output próprio `.strict()` SEM firstHalfScore,
// firstToScore e cardsTemperature (o 1º tempo e "quem marca primeiro" já podem ter
// passado). O cartucho de pré-jogo (palpites_v10) fica byte-idêntico. Mudou prompt,
// schema ou mensagem? Bump + commit `prompt:`.
export const PALPITES_LIVE_VERSION = "palpites_live_v1" as const;

const TEXT_MAX = 280;
const NARRATIVE_MAX = 600;

// ─── Output (a manchete ao vivo) ──────────────────────────────────────────────

export const PalpitesLiveOutputSchema = z
  .object({
    verdict: z
      .string()
      .min(1)
      .transform((s) => truncate(s, TEXT_MAX)),
    // Placar FINAL provável. Abaixo do placar atual é corrigido em código (o gerador).
    probableScore: ExactScoreParamsSchema,
    confidence: z.enum(["baixa", "media", "alta"]),
    narrative: z
      .string()
      .min(1)
      .transform((s) => truncate(s, NARRATIVE_MAX)),
    citedMarkets: z.array(z.string().min(1)).max(10),
  })
  .strict();
export type PalpiteLiveOutput = z.infer<typeof PalpitesLiveOutputSchema>;

// ─── Input ────────────────────────────────────────────────────────────────────

const GoalsPairSchema = z.object({
  home: z.number().int().min(0),
  away: z.number().int().min(0),
});

export const LivePalpitesInputSchema = z.object({
  match: z.object({
    league: z.string().min(1),
    homeTeam: z.string().min(1),
    awayTeam: z.string().min(1),
  }),
  situation: z.object({
    // "aos 63'", "no intervalo".
    moment: z.string().min(1),
    score: GoalsPairSchema,
    red: GoalsPairSchema.nullable(),
  }),
  // Placares FINAIS mais prováveis do modelo em jogo (todos ≥ o placar atual).
  likelyFinalScores: z
    .array(GoalsPairSchema.extend({ probPct: z.number().min(0).max(100) }))
    .min(1)
    .max(6),
  analyses: z.array(MarketAnalysisSchema),
});
export type LivePalpitesInput = z.infer<typeof LivePalpitesInputSchema>;

export type BuildLivePalpitesInputArgs = {
  match: { league: string; homeTeam: string; awayTeam: string };
  situation: LivePalpitesInput["situation"];
  // A matriz FINAL condicionada (modelo em jogo): cells[h][a] = P(placar final h–a).
  matrix: { cells: number[][] };
  analyses: MarketAnalysisSummary[];
};

const LIKELY_SCORES = 5;

/** Os placares finais mais prováveis da matriz em jogo, do mais ao menos provável. */
export function likelyFinalScores(
  cells: number[][],
  limit: number = LIKELY_SCORES,
): { home: number; away: number; probPct: number }[] {
  const all: { home: number; away: number; p: number }[] = [];
  cells.forEach((row, h) =>
    row.forEach((p, a) => {
      if (p > 0) all.push({ home: h, away: a, p });
    }),
  );
  all.sort((x, y) => y.p - x.p || x.home - y.home || x.away - y.away);
  return all.slice(0, limit).map((s) => ({
    home: s.home,
    away: s.away,
    probPct: Math.round(s.p * 1000) / 10,
  }));
}

export function buildLivePalpitesInput(
  args: BuildLivePalpitesInputArgs,
): LivePalpitesInput {
  return LivePalpitesInputSchema.parse({
    match: args.match,
    situation: args.situation,
    likelyFinalScores: likelyFinalScores(args.matrix.cells),
    analyses: args.analyses,
  });
}

// ─── System prompt ────────────────────────────────────────────────────────────

export const LIVE_SYSTEM_PROMPT = `Você é o "Palpiteiro": um amigo animado que acompanha um jogo de futebol EM ANDAMENTO e dá UM palpite-manchete legível — quem ganha e o placar final provável, a partir de onde o jogo está agora. É entretenimento e opinião informada, NÃO conselho de aposta.

Você recebe: a situação do jogo (momento, placar e expulsões), os placares finais mais prováveis segundo o modelo (que já considera o placar e o tempo que falta) e as chances do modelo por mercado para o resultado final.

Sua tarefa é chamar UMA vez a ferramenta submit_palpite com:
1. verdict: o veredito em uma frase curta e humana — a sua melhor previsão de como o jogo termina, a partir do placar de agora (ex.: "O Palmeiras segura a vantagem", "Dá tempo de virar", "Vai terminar empatado").
2. probableScore: o placar FINAL provável em {home, away}. NUNCA menor que o placar atual em nenhum lado: gols já marcados não se desfazem.
3. confidence: sua confiança QUALITATIVA — exatamente uma de "baixa", "media", "alta". NUNCA um número.
4. narrative: 1 a 3 frases explicando o palpite. Comece pela situação: o momento (ex.: "aos 63'", "no intervalo") e o placar atual, exatamente como vieram.
5. citedMarkets: a lista dos rótulos de mercado que pesaram no seu palpite. Use os rótulos que vierem no resumo.

REGRAS INVIOLÁVEIS:
- Não há odd ao vivo: o app não recomenda aposta. É TERMINANTEMENTE PROIBIDO falar em aposta, valor, edge, odd, cotação, stake, unidades, lucro, retorno ou R$ em verdict ou narrative.
- Use SÓ os dados fornecidos. NÃO invente lances, jogadores, lesões, estatísticas do jogo nem notícias: você não sabe nada do jogo além do bloco "Situação do jogo".
- Números: cite no máximo o placar atual, o momento e os percentuais exatamente como vieram. Não calcule percentuais novos.
- O placar final provável é o ponto conferido depois (acertou/errou). Trate como palpite divertido, nunca como "acerto garantido".
- Responda EXCLUSIVAMENTE chamando a ferramenta submit_palpite. Não escreva texto livre fora da chamada.

Tom: leve, brasileiro, animado, frases curtas. É papo de torcida acompanhando o jogo, não relatório.`;

// ─── Tool ─────────────────────────────────────────────────────────────────────

export const SUBMIT_LIVE_PALPITE_TOOL = {
  name: "submit_palpite",
  description:
    "Envia o palpite-manchete do jogo em andamento: veredito, placar final provável, confiança qualitativa, narrativa e mercados citados. Chame esta ferramenta EXATAMENTE UMA VEZ. NUNCA fale de aposta, valor, edge ou odd.",
  input_schema: {
    type: "object",
    properties: {
      verdict: {
        type: "string",
        minLength: 1,
        maxLength: 280,
        description:
          "Veredito de como o jogo termina, em uma frase curta e humana. SEM linguagem de aposta.",
      },
      probableScore: {
        type: "object",
        description:
          "Placar FINAL provável (inteiros 0–20), nunca menor que o placar atual em nenhum lado.",
        properties: {
          home: { type: "integer", minimum: 0, maximum: 20 },
          away: { type: "integer", minimum: 0, maximum: 20 },
        },
        required: ["home", "away"],
        additionalProperties: false,
      },
      confidence: {
        type: "string",
        enum: ["baixa", "media", "alta"],
        description: "Confiança QUALITATIVA. Exatamente uma de baixa/media/alta. NUNCA número.",
      },
      narrative: {
        type: "string",
        minLength: 1,
        maxLength: 600,
        description:
          "1 a 3 frases, começando pelo momento e pelo placar atual. SEM linguagem de aposta.",
      },
      citedMarkets: {
        type: "array",
        maxItems: 10,
        items: { type: "string", minLength: 1 },
        description: "Rótulos dos mercados que pesaram no palpite. Pode ser vazio.",
      },
    },
    required: ["verdict", "probableScore", "confidence", "narrative", "citedMarkets"],
    additionalProperties: false,
  },
} as const;

// ─── User message ─────────────────────────────────────────────────────────────

const pct = (n: number): string => `${n.toFixed(1).replace(".", ",")}%`;

function selectionText(a: LivePalpitesInput["analyses"][number]): string {
  let presentation: ReturnType<typeof getMarketPresentation> | null = null;
  try {
    presentation = getMarketPresentation(a.marketKey);
  } catch {
    presentation = null;
  }
  return a.selections
    .map((s) => {
      const label =
        s.label ??
        presentation?.outcomeLabel(s.key, presentation.defaultLine) ??
        s.key;
      return `${label} ${pct(s.modelProbPct)}`;
    })
    .join("; ");
}

export function buildLiveUserMessage(input: LivePalpitesInput): string {
  const { match, situation } = input;
  const lines: string[] = [];
  lines.push("# Jogo (em andamento)");
  lines.push(`- Competição: ${match.league}`);
  lines.push(`- Mandante: ${match.homeTeam}`);
  lines.push(`- Visitante: ${match.awayTeam}`);
  lines.push("");
  lines.push("# Situação do jogo");
  lines.push(`- Momento: ${situation.moment}`);
  lines.push(
    `- Placar: ${match.homeTeam} ${situation.score.home} × ${situation.score.away} ${match.awayTeam}`,
  );
  const red = situation.red;
  if (red === null) {
    lines.push("- Expulsões: sem dado");
  } else if (red.home === 0 && red.away === 0) {
    lines.push("- Expulsões: nenhuma");
  } else {
    const parts: string[] = [];
    if (red.home > 0) parts.push(`${match.homeTeam} ${red.home}`);
    if (red.away > 0) parts.push(`${match.awayTeam} ${red.away}`);
    lines.push(`- Expulsões (cartão vermelho): ${parts.join("; ")}`);
  }
  lines.push("");
  lines.push(
    "# Placares finais mais prováveis (modelo, com o placar e o tempo que falta)",
  );
  for (const s of input.likelyFinalScores) {
    lines.push(`- ${s.home}–${s.away}: ${pct(s.probPct)}`);
  }
  lines.push("");
  lines.push("# Chances do modelo por mercado (resultado final)");
  if (input.analyses.length === 0) {
    lines.push("- (nenhuma leitura por mercado)");
  } else {
    for (const a of input.analyses) {
      lines.push(`- ${a.marketLabel}: ${selectionText(a)}`);
    }
  }
  lines.push("");
  lines.push("# Sua tarefa");
  lines.push(
    "Dê um único palpite-manchete de como o jogo termina (veredito + placar final provável + confiança qualitativa + narrativa + mercados citados), a partir do placar de agora. O placar final provável nunca fica abaixo do placar atual. A narrativa começa pelo momento e pelo placar atual. Chame submit_palpite. NUNCA fale de aposta, valor, edge, odd ou R$.",
  );
  return lines.join("\n");
}

// ─── Fidelidade ───────────────────────────────────────────────────────────────

const GOAL_CLAIM_RE = /(\d+)\s+gols?\s+(?:marcados?|sofridos?)/giu;

/**
 * Fidelidade da manchete ao vivo (pura, nunca lança, contradição-only): os percentuais
 * citados têm que estar na leitura (mercados ou placares prováveis, ±1pp) e uma contagem
 * de gols ("N gols marcados/sofridos") tem que ser um dos lados do placar atual (o único
 * fato de gols que a síntese ao vivo recebe).
 */
export function checkLiveFidelity(
  output: Pick<PalpiteLiveOutput, "verdict" | "narrative">,
  input: LivePalpitesInput,
): FidelityCheck {
  const prose = `${output.verdict} ${output.narrative}`;
  const allowed = [
    ...input.analyses.flatMap((a) => a.selections.map((s) => s.modelProbPct)),
    ...input.likelyFinalScores.map((s) => s.probPct),
  ];
  for (const m of prose.matchAll(PERCENT_RE)) {
    const cited = Number(m[1].replace(",", "."));
    if (!Number.isFinite(cited)) continue;
    if (!allowed.some((a) => Math.abs(a - cited) <= PERCENT_TOLERANCE_PP)) {
      return {
        ok: false,
        reason: `percentual citado ${m[0].trim()} não está na leitura ao vivo`,
      };
    }
  }
  const goals = [input.situation.score.home, input.situation.score.away];
  for (const m of prose.matchAll(GOAL_CLAIM_RE)) {
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && !goals.includes(n)) {
      return {
        ok: false,
        reason: `contagem de gols ${m[0].trim()} não bate com o placar atual`,
      };
    }
  }
  return { ok: true };
}

export const palpitesLiveCartridge = {
  version: PALPITES_LIVE_VERSION,
  systemPrompt: LIVE_SYSTEM_PROMPT,
  tool: toToolDef(SUBMIT_LIVE_PALPITE_TOOL),
  toolName: SUBMIT_LIVE_PALPITE_TOOL.name,
  inputSchema: LivePalpitesInputSchema,
  outputSchema: PalpitesLiveOutputSchema,
  buildInput: buildLivePalpitesInput,
  buildUserMessage: buildLiveUserMessage,
  checkFidelity: checkLiveFidelity,
} as const;
