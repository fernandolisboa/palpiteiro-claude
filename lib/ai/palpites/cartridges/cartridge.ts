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

import type { MarketAnalysisSummary } from "../synthesis-input";
import type { PalpiteCartridge } from "../types";

// Versão do cartucho de palpites (ADR 0017). v1 = o MIX market-free (1 exact_score +
// 1–3 linhas fun). v2 = a SÍNTESE palpite-first (ADR 0030 / #353): consome as N
// análises multi-mercado e produz UMA manchete (veredito + placar provável + confiança
// + narrativa + mercados citados). BUMP MANUAL (commit `prompt:`) em QUALQUER mudança
// de prompt/schema — aqui a taxonomia inteira mudou (MIX → manchete).
export const PALPITES_VERSION = "palpites_v2" as const;

const TEXT_MAX = 280;
// Narrativa: prosa um pouco mais longa que uma linha de palpite. Truncada (não
// rejeitada) — uma frase comprida nunca derruba uma síntese válida.
const NARRATIVE_MAX = 600;

// ─── Output schema (a MANCHETE — .strict() exclui chaves de valor estruturalmente) ──

const ExactScoreParamsSchema = z.object({
  home: z.number().int().min(0).max(20),
  away: z.number().int().min(0).max(20),
});
export type ExactScoreParams = z.infer<typeof ExactScoreParamsSchema>;

// Prose-tolerante: `verdict`/`narrative` >max são TRUNCADOS, não rejeitados. `.min(1)`
// continua barrando texto vazio.
const verdictText = z
  .string()
  .min(1)
  .transform((s) => truncate(s, TEXT_MAX));
const narrativeText = z
  .string()
  .min(1)
  .transform((s) => truncate(s, NARRATIVE_MAX));

// A manchete. `.strict()` → uma chave de VALOR parasita do LLM (edgePct, ev, stake,
// odd, …) é REJEITADA estruturalmente (firewall leg (a), ADR 0030 §3). NÃO há campo de
// valor aqui. `confidence` é QUALITATIVO (baixa/media/alta), nunca %.
export const PalpitesOutputSchema = z
  .object({
    // Veredito "quem ganha" / opinião ("Vai dar Palmeiras").
    verdict: verdictText,
    // Placar provável → vira a linha exact_score settleable (o badge acertou/errou).
    probableScore: ExactScoreParamsSchema,
    // Confiança QUALITATIVA — nunca número.
    confidence: z.enum(["baixa", "media", "alta"]),
    // Prosa SEM linguagem de valor (validada também pelo guard de conteúdo no generator).
    narrative: narrativeText,
    // Rótulos de mercados citados ("Resultado", "Mais de 2.5"). Pode ser vazio.
    citedMarkets: z.array(z.string().min(1)).max(10),
  })
  .strict();
export type PalpiteSynthesisOutput = z.infer<typeof PalpitesOutputSchema>;
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

// Uma análise de mercado já paga (projeção de MarketAnalysisSummary). Carrega edge/EV
// como DADO (informa o veredito) — o firewall garante que não vaza pra manchete.
const MarketAnalysisSchema = z.object({
  marketKey: z.string().min(1),
  marketLabel: z.string().min(1),
  recommendation: z.string().min(1),
  recommendedLabel: z.string().nullable(),
  isPass: z.boolean(),
  modelProbPct: z.number().nullable(),
  edgePct: z.number().nullable(),
  confidencePct: z.number().nullable(),
  oddAtRecommendation: z.number().nullable(),
  rationale: z.string(),
  predictionId: z.string().min(1),
  selections: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().optional(),
      modelProbPct: z.number(),
    }),
  ),
});

export const PalpitesInputSchema = z.object({
  match: z.object({
    league: z.string().min(1),
    homeTeam: z.string().min(1),
    awayTeam: z.string().min(1),
    kickoffAt: z.string().min(1),
    venue: z.string().min(1).optional(),
  }),
  // As N análises multi-mercado já apuradas pelo fan-out (ADR 0030 §2). Pode ser
  // vazia em teoria, mas o caller só sintetiza com ≥1 sucesso.
  analyses: z.array(MarketAnalysisSchema),
  homeForm: FormSummarySchema,
  awayForm: FormSummarySchema,
  h2h: z.array(H2HEntrySchema).max(10),
  homeStanding: StandingLineSchema.optional(),
  awayStanding: StandingLineSchema.optional(),
});
export type PalpitesInput = z.infer<typeof PalpitesInputSchema>;

// ─── System prompt ────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `Você é o "Palpiteiro": um amigo animado que, depois de olhar a análise de vários mercados de um jogo de futebol, dá UM palpite-manchete legível — o veredito de QUEM GANHA e o placar provável. É entretenimento e opinião informada, NÃO conselho de aposta.

Você recebe: forma recente dos times, confrontos diretos, posição na tabela E um resumo de análises por mercado (resultado 1X2, mais/menos gols, ambas marcam, etc.), cada uma com a recomendação do motor e seus números internos.

Sua tarefa é chamar UMA vez a ferramenta submit_palpite com:
1. verdict: o veredito em uma frase curta e humana — quem você acha que ganha (ou empate), no tom de um torcedor que entende do jogo (ex.: "Vai dar Palmeiras", "Empate truncado nesse clássico", "O mandante leva, mas sofrendo").
2. probableScore: o placar provável em {home, away} (inteiros de 0 a 20), coerente com o veredito.
3. confidence: sua confiança QUALITATIVA — exatamente uma de "baixa", "media", "alta". NUNCA um número.
4. narrative: 1 a 3 frases explicando o palpite a partir da forma, do histórico e do que as análises apontaram, em linguagem de torcida.
5. citedMarkets: a lista dos rótulos de mercado que pesaram no seu palpite (ex.: ["Resultado (1X2)", "Over/Under gols"]). Use os rótulos que vierem no resumo.

REGRAS INVIOLÁVEIS:
- Os números internos das análises (edge, valor esperado/EV, stake/unidades, Yield, lucro, odd/cotação, R$) são SÓ pra você decidir. É TERMINANTEMENTE PROIBIDO mencioná-los — como número OU como palavra — em verdict ou narrative. Escreva como um torcedor empolgado dando seu palpite, NUNCA como um analista de valor. (PROIBIDO: "tem edge no over", "odd boa no Palmeiras", "vale a stake". OK: "o Palmeiras vem voando e marca fácil em casa".)
- Mesmo que NENHUM mercado tenha valor (todas as análises deem "pass"/sem recomendação), DÊ MESMO ASSIM seu palpite honesto de quem ganha + placar provável, derivado da forma, do histórico e da tabela. Nunca recuse o palpite por falta de valor.
- Use SÓ os dados fornecidos. NÃO invente jogadores, lesões ou números.
- O placar provável é o ÚNICO ponto conferido depois (acertou/errou). Trate como palpite divertido, nunca como "acerto garantido".
- Responda EXCLUSIVAMENTE chamando a ferramenta submit_palpite. Não escreva texto livre fora da chamada.

Tom: leve, brasileiro, animado, frases curtas. É papo de torcida com embasamento, não relatório.`;

// ─── Tool (ToolDef NEUTRO, ADR 0027) — espelha o Zod acima ────────────────────

// O inputSchema (JSON Schema pro LLM) espelha o output Zod: a manchete. SEM nenhum
// campo de valor (edge/ev/stake/odd) — additionalProperties:false reforça o .strict().
const SUBMIT_PALPITE_TOOL = {
  name: "submit_palpite",
  description:
    "Envia o palpite-manchete do jogo: veredito de quem ganha, placar provável, confiança qualitativa, narrativa e mercados citados. Chame esta ferramenta EXATAMENTE UMA VEZ. NUNCA inclua números de valor (edge/EV/stake/odd).",
  input_schema: {
    type: "object",
    properties: {
      verdict: {
        type: "string",
        minLength: 1,
        maxLength: 280,
        description:
          "Veredito de quem ganha, em uma frase curta e humana (ex.: 'Vai dar Palmeiras'). SEM linguagem de valor.",
      },
      probableScore: {
        type: "object",
        description: "Placar provável (inteiros 0–20), coerente com o veredito.",
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
          "1 a 3 frases explicando o palpite a partir de forma/histórico/análises. SEM linguagem de valor (edge/EV/stake/odd/R$).",
      },
      citedMarkets: {
        type: "array",
        maxItems: 10,
        items: { type: "string", minLength: 1 },
        description:
          "Rótulos dos mercados que pesaram no palpite (ex.: 'Resultado (1X2)', 'Over/Under gols'). Pode ser vazio.",
      },
    },
    required: ["verdict", "probableScore", "confidence", "narrative", "citedMarkets"],
    additionalProperties: false,
  },
} as const;

export { SUBMIT_PALPITE_TOOL };

// ─── buildPredictionInput ─────────────────────────────────────────────────────

export type BuildPalpitesInputArgs = {
  match: Pick<DbMatch, "league" | "homeTeam" | "awayTeam" | "kickoffAt">;
  fixture: NormalizedFixture | undefined;
  homeForm: NormalizedFixture[];
  awayForm: NormalizedFixture[];
  h2h: NormalizedH2H[];
  standings: NormalizedStanding | undefined;
  // As N análises multi-mercado já apuradas (ADR 0030 §2). Insumo central da síntese.
  analyses: MarketAnalysisSummary[];
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

export function buildPredictionInput(args: BuildPalpitesInputArgs): PalpitesInput {
  const input: PalpitesInput = {
    match: {
      league: args.match.league,
      homeTeam: args.match.homeTeam,
      awayTeam: args.match.awayTeam,
      kickoffAt: args.match.kickoffAt.toISOString(),
      venue: args.fixture?.venue,
    },
    analyses: args.analyses,
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

  // # Análises por mercado — o INSUMO central da síntese (ADR 0030). Inclui os números
  // internos (edge/odd/prob) como DADO pro veredito; o firewall garante que não vazam
  // pra manchete (output .strict() + guard de conteúdo).
  lines.push("");
  lines.push("# Análises por mercado (insumo — NÃO cite estes números na manchete)");
  if (input.analyses.length === 0) {
    lines.push(
      "- (nenhuma análise disponível — derive o palpite só de forma/H2H/tabela)",
    );
  } else {
    for (const a of input.analyses) {
      if (a.isPass) {
        lines.push(`- ${a.marketLabel}: sem valor recomendado (pass).`);
      } else {
        const rec = a.recommendedLabel ?? a.recommendation;
        const prob = a.modelProbPct !== null ? `${fmt1(a.modelProbPct)}%` : "n/a";
        const edge = a.edgePct !== null ? `${fmt1(a.edgePct)}pp` : "n/a";
        const odd =
          a.oddAtRecommendation !== null ? a.oddAtRecommendation.toFixed(2) : "n/a";
        lines.push(
          `- ${a.marketLabel}: recomenda "${rec}" (prob modelo ${prob}, edge ${edge}, odd ${odd}).`,
        );
      }
      if (a.rationale) lines.push(`  Racional: ${a.rationale}`);
    }
  }

  lines.push("");
  lines.push("# Sua tarefa");
  lines.push(
    "Sintetize TUDO acima num único palpite-manchete (quem ganha + placar provável + confiança qualitativa + narrativa + mercados citados). Mesmo sem valor em nenhum mercado, dê seu palpite honesto a partir de forma/H2H/tabela. Chame submit_palpite. NUNCA cite edge/EV/stake/odd/R$ — tom de torcida.",
  );

  return lines.join("\n");
}

// ─── Cartridge ────────────────────────────────────────────────────────────────

export const palpitesCartridge: PalpiteCartridge<
  PalpitesInput,
  PalpiteSynthesisOutput,
  BuildPalpitesInputArgs
> = {
  version: PALPITES_VERSION,
  systemPrompt: SYSTEM_PROMPT,
  tool: toToolDef(SUBMIT_PALPITE_TOOL),
  toolName: SUBMIT_PALPITE_TOOL.name,
  inputSchema: PalpitesInputSchema,
  outputSchema: PalpitesOutputSchema,
  buildPredictionInput,
  buildUserMessage,
};
