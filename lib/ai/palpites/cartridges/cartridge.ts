import { z } from "zod";

import { truncate } from "@/lib/ai/ai-call-logging";
import { toToolDef } from "@/lib/ai/markets/types";
import type {
  NormalizedFixture,
  NormalizedH2H,
  NormalizedStanding,
} from "@/lib/providers/sports-data/types";
import type {
  DbMatch,
} from "@/lib/db/queries/predictions";
import type { PalpiteSetWithLines } from "@/lib/db/queries/palpites";

import type { PalpiteCartridge } from "../types";

// Versão do cartucho de palpites (ADR 0017). v1 = o MIX (exatamente um exact_score
// settleable + 1–3 linhas fun red_card/corners). BUMP MANUAL (commit `prompt:`) em
// QUALQUER mudança de prompt/schema; um TIPO novo ou uma REGRA de settlement nova = v2.
export const PALPITES_VERSION = "palpites_v1" as const;

const TEXT_MAX = 280;

// ─── Output schema (discriminated union — settleable NUNCA vem do LLM) ─────────

const ExactScoreParamsSchema = z.object({
  home: z.number().int().min(0).max(20),
  away: z.number().int().min(0).max(20),
});
export type ExactScoreParams = z.infer<typeof ExactScoreParamsSchema>;

// Prose-tolerante: `text` >280 é TRUNCADO (não rejeitado) — uma frase longa nunca
// derruba um set válido (gotcha de prosa). `.min(1)` continua barrando texto vazio.
const palpiteText = z
  .string()
  .min(1)
  .transform((s) => truncate(s, TEXT_MAX));

// Discriminated union por `type`: SÓ exact_score carrega `params`; uma red_card/corners
// COM params é falha de Zod (não removida em silêncio). O output NÃO declara `settleable`
// (derivado no boundary de escrita) e o objeto externo é `.strict()` → um settleable
// parasita do LLM é REJEITADO.
const PalpiteLineSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("exact_score"),
    text: palpiteText,
    params: ExactScoreParamsSchema,
  }),
  z.object({
    type: z.literal("red_card"),
    text: palpiteText,
    params: z.null().optional(),
  }),
  z.object({
    type: z.literal("corners"),
    text: palpiteText,
    params: z.null().optional(),
  }),
]);

export const PalpitesOutputSchema = z
  .object({
    palpites: z.array(PalpiteLineSchema).min(2).max(4),
  })
  .strict();
export type PalpitesOutput = z.infer<typeof PalpitesOutputSchema>;
export { ExactScoreParamsSchema };

// ─── Input schema ─────────────────────────────────────────────────────────────

const FormSummarySchema = z.object({
  team: z.string().min(1),
  gamesConsidered: z.number().int().nonnegative(),
  avgGoalsFor: z.number().nonnegative(),
  avgGoalsAgainst: z.number().nonnegative(),
  results: z.array(z.enum(["W", "D", "L"])),
});

const H2HEntrySchema = z.object({
  date: z.string(),
  home: z.string().min(1),
  away: z.string().min(1),
  scoreHome: z.number().int().nonnegative(),
  scoreAway: z.number().int().nonnegative(),
});

const StandingLineSchema = z.object({
  team: z.string().min(1),
  position: z.number().int().positive(),
  points: z.number().int().nonnegative(),
});

export const PalpitesInputSchema = z.object({
  match: z.object({
    league: z.string().min(1),
    homeTeam: z.string().min(1),
    awayTeam: z.string().min(1),
    kickoffAt: z.string().min(1),
    venue: z.string().min(1).optional(),
  }),
  homeForm: FormSummarySchema,
  awayForm: FormSummarySchema,
  h2h: z.array(H2HEntrySchema).max(10),
  homeStanding: StandingLineSchema.optional(),
  awayStanding: StandingLineSchema.optional(),
  // Contexto de EXCLUSÃO (regen sem repetir, §2.5). Vazios na 1ª geração.
  excludedScores: z.array(ExactScoreParamsSchema),
  excludedFunIdeas: z.array(
    z.object({ type: z.enum(["red_card", "corners"]), text: z.string() }),
  ),
});
export type PalpitesInput = z.infer<typeof PalpitesInputSchema>;

// ─── System prompt ────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `Você é o "Palpiteiro": um amigo animado que arrisca palpites divertidos sobre um jogo de futebol, só pela diversão e pelo engajamento. NÃO é análise de aposta de valor.

Sua tarefa é emitir EXATAMENTE este conjunto (o "mix"), chamando UMA vez a ferramenta submit_palpites:
1. EXATAMENTE UM palpite de PLACAR EXATO (type "exact_score"), com os gols de mandante e visitante em params {home, away} (inteiros de 0 a 20) e uma frase curta e humana no campo text (ex.: "Acho que sai um 2 a 1 pro mandante, jogo aberto!").
2. DE 1 A 3 linhas de DIVERSÃO, cada uma com type "red_card" (vai rolar cartão vermelho?) OU "corners" (muito escanteio?) e SÓ o campo text (uma frase curta e leve). NÃO mande params nessas linhas.

Total: de 2 a 4 linhas (1 placar + 1 a 3 linhas fun).

REGRAS INVIOLÁVEIS:
- PROIBIDO mencionar, em QUALQUER campo text (inclusive nas linhas fun), qualquer linguagem de VALOR: nada de odd, porcentagem, "%", chance numérica, probabilidade, edge, stake, retorno, "value", lucro ou "Yield" — nem como número, nem como palavra. Escreva como um torcedor empolgado palpitando, não como um analista. (Ex. PROIBIDO: "70% de chance de cartão". Ex. OK: "Esse clássico pega fogo, não duvido de um vermelho!").
- Apenas o PLACAR EXATO é conferido depois (acertou/errou). As linhas de cartão e escanteio são DIVERSÃO PURA, sem placar e sem conferência — NÃO prometa "acerto garantido" nem trate como aposta.
- Use SÓ os dados fornecidos (forma recente, médias de gols, confrontos diretos, posição na tabela). NÃO invente jogadores, lesões, números ou tendências.
- NÃO repita nenhum placar exato nem nenhuma ideia de diversão que já tenham sido sugeridos antes (a lista vem na seção "Não repita", quando houver).
- Responda EXCLUSIVAMENTE chamando a ferramenta submit_palpites com os campos do schema. Não escreva texto livre fora da chamada.

Tom: leve, brasileiro, animado, frases curtas. É papo de torcida, não relatório.`;

// ─── Tool (ToolDef NEUTRO, ADR 0027) — espelha o Zod acima ────────────────────

// O inputSchema (JSON Schema pro LLM) espelha a discriminated union do Zod: oneOf
// por `type`, com `params` obrigatório SÓ no exact_score. Sem campo `settleable`.
const SUBMIT_PALPITES_TOOL = {
  name: "submit_palpites",
  description:
    "Envia o mix de palpites do jogo: EXATAMENTE um placar exato (exact_score) + 1 a 3 linhas de diversão (red_card/corners). Chame esta ferramenta EXATAMENTE UMA VEZ.",
  input_schema: {
    type: "object",
    properties: {
      palpites: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        description:
          "De 2 a 4 linhas: exatamente uma do tipo exact_score (com params) + de 1 a 3 linhas fun (red_card/corners, sem params).",
        items: {
          oneOf: [
            {
              type: "object",
              description: "Palpite de placar exato (conferido depois).",
              properties: {
                type: { type: "string", enum: ["exact_score"] },
                text: {
                  type: "string",
                  minLength: 1,
                  maxLength: 280,
                  description:
                    "Frase curta e humana sobre o placar. SEM linguagem de valor (odd/%/edge/etc.).",
                },
                params: {
                  type: "object",
                  description: "Gols de mandante e visitante (inteiros 0–20).",
                  properties: {
                    home: { type: "integer", minimum: 0, maximum: 20 },
                    away: { type: "integer", minimum: 0, maximum: 20 },
                  },
                  required: ["home", "away"],
                  additionalProperties: false,
                },
              },
              required: ["type", "text", "params"],
              additionalProperties: false,
            },
            {
              type: "object",
              description:
                "Linha de diversão (cartão vermelho ou escanteios). SEM params, SEM conferência.",
              properties: {
                type: { type: "string", enum: ["red_card", "corners"] },
                text: {
                  type: "string",
                  minLength: 1,
                  maxLength: 280,
                  description:
                    "Frase curta e leve. SEM linguagem de valor (odd/%/edge/probabilidade/etc.).",
                },
              },
              required: ["type", "text"],
              additionalProperties: false,
            },
          ],
        },
      },
    },
    required: ["palpites"],
    additionalProperties: false,
  },
} as const;

export { SUBMIT_PALPITES_TOOL };

// ─── buildPredictionInput ─────────────────────────────────────────────────────

export type BuildPalpitesInputArgs = {
  match: Pick<DbMatch, "league" | "homeTeam" | "awayTeam" | "kickoffAt">;
  fixture: NormalizedFixture | undefined;
  homeForm: NormalizedFixture[];
  awayForm: NormalizedFixture[];
  h2h: NormalizedH2H[];
  standings: NormalizedStanding | undefined;
  previousSets: PalpiteSetWithLines[];
};

// Resume a forma de UM time a partir das fixtures recentes (já desc do adapter):
// médias de gols PRÓ/CONTRA na perspectiva do time + a sequência de resultados.
function summarizeForm(
  team: string,
  fixtures: NormalizedFixture[],
): z.infer<typeof FormSummarySchema> {
  const results: ("W" | "D" | "L")[] = [];
  let goalsFor = 0;
  let goalsAgainst = 0;
  let counted = 0;
  for (const fx of fixtures) {
    const isHome = fx.homeTeam === team;
    const gf = isHome ? fx.score.home : fx.score.away;
    const ga = isHome ? fx.score.away : fx.score.home;
    if (gf === null || ga === null) continue;
    goalsFor += gf;
    goalsAgainst += ga;
    counted += 1;
    results.push(gf > ga ? "W" : gf < ga ? "L" : "D");
  }
  return {
    team,
    gamesConsidered: counted,
    avgGoalsFor: counted ? goalsFor / counted : 0,
    avgGoalsAgainst: counted ? goalsAgainst / counted : 0,
    results,
  };
}

function findStanding(
  standings: NormalizedStanding | undefined,
  team: string,
): z.infer<typeof StandingLineSchema> | undefined {
  if (!standings) return undefined;
  for (const table of standings.tables) {
    const row = table.teams.find((t) => t.team === team);
    if (row)
      return { team: row.team, position: row.position, points: row.points };
  }
  return undefined;
}

// Achata o histórico prévio em DUAS listas de exclusão (§2.5): placares já chutados
// (linhas exact_score com params) E ideias fun já usadas (linhas red_card/corners).
// Necessário separar porque as linhas fun não têm `params` para achatar.
function buildExclusions(previousSets: PalpiteSetWithLines[]): {
  excludedScores: ExactScoreParams[];
  excludedFunIdeas: { type: "red_card" | "corners"; text: string }[];
} {
  const excludedScores: ExactScoreParams[] = [];
  const excludedFunIdeas: { type: "red_card" | "corners"; text: string }[] = [];
  for (const set of previousSets) {
    for (const line of set.palpites) {
      if (line.type === "exact_score" && line.params) {
        excludedScores.push({ home: line.params.home, away: line.params.away });
      } else if (line.type === "red_card" || line.type === "corners") {
        excludedFunIdeas.push({ type: line.type, text: line.text });
      }
    }
  }
  return { excludedScores, excludedFunIdeas };
}

export function buildPredictionInput(args: BuildPalpitesInputArgs): PalpitesInput {
  const { excludedScores, excludedFunIdeas } = buildExclusions(args.previousSets);
  const input: PalpitesInput = {
    match: {
      league: args.match.league,
      homeTeam: args.match.homeTeam,
      awayTeam: args.match.awayTeam,
      kickoffAt: args.match.kickoffAt.toISOString(),
      venue: args.fixture?.venue,
    },
    homeForm: summarizeForm(args.match.homeTeam, args.homeForm),
    awayForm: summarizeForm(args.match.awayTeam, args.awayForm),
    h2h: args.h2h.slice(0, 10).map((m) => ({
      date: m.kickoffAt.slice(0, 10),
      home: m.homeTeam,
      away: m.awayTeam,
      scoreHome: m.score.home ?? 0,
      scoreAway: m.score.away ?? 0,
    })),
    homeStanding: findStanding(args.standings, args.match.homeTeam),
    awayStanding: findStanding(args.standings, args.match.awayTeam),
    excludedScores,
    excludedFunIdeas,
  };
  // Valida no boundary de montagem (fronteira do CLAUDE.md p/ o input do LLM).
  return PalpitesInputSchema.parse(input);
}

// ─── buildUserMessage ─────────────────────────────────────────────────────────

const fmt1 = (n: number): string => (Number.isFinite(n) ? n.toFixed(1) : "n/a");

export function buildUserMessage(
  input: PalpitesInput,
  ctx: { daysToKickoff: number },
): string {
  const lines: string[] = [];
  lines.push("# Jogo");
  lines.push(`- Competição: ${input.match.league}`);
  lines.push(`- Mandante: ${input.match.homeTeam}`);
  lines.push(`- Visitante: ${input.match.awayTeam}`);
  lines.push(`- Kickoff (UTC): ${input.match.kickoffAt}`);
  if (input.match.venue) lines.push(`- Local: ${input.match.venue}`);
  lines.push(`- Dias até o jogo: ${ctx.daysToKickoff}`);

  for (const side of ["home", "away"] as const) {
    const form = side === "home" ? input.homeForm : input.awayForm;
    const standing = side === "home" ? input.homeStanding : input.awayStanding;
    const label = side === "home" ? "Mandante" : "Visitante";
    lines.push("");
    lines.push(`# ${label} — ${form.team}`);
    if (standing) {
      lines.push(`- Posição: ${standing.position}º (${standing.points} pts)`);
    }
    lines.push(
      `- Forma recente (${form.gamesConsidered} jogos): ${
        form.results.join("") || "(sem dados)"
      }`,
    );
    lines.push(
      `- Média de gols: ${fmt1(form.avgGoalsFor)} marcados / ${fmt1(
        form.avgGoalsAgainst,
      )} sofridos por jogo`,
    );
  }

  lines.push("");
  lines.push("# Confrontos diretos (H2H)");
  if (input.h2h.length === 0) {
    lines.push("- (sem histórico fornecido)");
  } else {
    for (const m of input.h2h) {
      lines.push(`- ${m.date}: ${m.home} ${m.scoreHome}-${m.scoreAway} ${m.away}`);
    }
  }

  // Seção "Não repita" — lista AMBOS (placares e ideias fun) quando não-vazios;
  // omite a sub-seção vazia. Contrato de regen sem repetição.
  if (input.excludedScores.length > 0 || input.excludedFunIdeas.length > 0) {
    lines.push("");
    lines.push("# Não repita (já sugerido antes)");
    if (input.excludedScores.length > 0) {
      lines.push("## Placares já sugeridos");
      for (const s of input.excludedScores) {
        lines.push(`- ${s.home}-${s.away}`);
      }
    }
    if (input.excludedFunIdeas.length > 0) {
      lines.push("## Ideias fun já usadas");
      for (const f of input.excludedFunIdeas) {
        lines.push(`- (${f.type}) ${f.text}`);
      }
    }
  }

  lines.push("");
  lines.push("# Sua tarefa");
  lines.push(
    "Emita o mix: EXATAMENTE um placar exato + 1 a 3 linhas de diversão (cartão/escanteio). Chame submit_palpites. Tom de torcida, sem linguagem de valor.",
  );

  return lines.join("\n");
}

// ─── Cartridge ────────────────────────────────────────────────────────────────

export const palpitesCartridge: PalpiteCartridge<
  PalpitesInput,
  PalpitesOutput,
  BuildPalpitesInputArgs
> = {
  version: PALPITES_VERSION,
  systemPrompt: SYSTEM_PROMPT,
  tool: toToolDef(SUBMIT_PALPITES_TOOL),
  toolName: SUBMIT_PALPITES_TOOL.name,
  inputSchema: PalpitesInputSchema,
  outputSchema: PalpitesOutputSchema,
  buildPredictionInput,
  buildUserMessage,
};
