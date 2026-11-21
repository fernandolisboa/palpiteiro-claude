import { z } from "zod";

import { truncate } from "@/lib/ai/ai-call-logging";
import { toToolDef } from "@/lib/ai/markets/types";

import type { PalpitePick } from "../pick";
import type { PalpiteCartridge } from "../types";
import {
  PALPITES_VERSION,
  PalpitesInputSchema,
  buildPredictionInput,
  pushMatchFactLines,
  pushNewsLines,
  type BuildPalpitesInputArgs,
} from "./cartridge";

// Cartucho palpites_v14 (#668, ADR 0072): o palpite decidido em código. O resultado, o
// placar, o 1º tempo e quem marca primeiro chegam FIXADOS (lib/ai/palpites/pick.ts); o
// LLM só escreve o texto em volta. Nada que varie por pedido no system prompt nem na
// ferramenta (ADR 0071): o palpite fixado vai na mensagem do usuário.

const TEXT_MAX = 280;
const NARRATIVE_MAX = 600;

const verdictText = z
  .string()
  .min(1)
  .transform((s) => truncate(s, TEXT_MAX));
const narrativeText = z
  .string()
  .min(1)
  .transform((s) => truncate(s, NARRATIVE_MAX));

const OutcomeSchema = z.enum(["home", "draw", "away"]);

// `.strict()`: chave de valor parasita E `probableScore`/`firstHalfScore`/`firstToScore`
// (decididos em código) são rejeitadas estruturalmente.
export const PalpitesModelPickOutputSchema = z
  .object({
    verdict: verdictText,
    // O resultado que o veredito afirma; tem de bater com o palpite fixado (conferido).
    verdictOutcome: OutcomeSchema,
    cardsTemperature: z.enum(["pegado", "muito_pegado"]).optional(),
    narrative: narrativeText,
    citedMarkets: z.array(z.string().min(1)).max(10),
  })
  .strict();
export type PalpiteModelPickOutput = z.infer<typeof PalpitesModelPickOutputSchema>;

const ScoreSchema = z.object({
  home: z.number().int().min(0).max(20),
  away: z.number().int().min(0).max(20),
});

// O palpite fixado como o prompt o vê: sem λ, sem fonte (mercado/modelo).
const FixedPickSchema = z.object({
  outcome: OutcomeSchema,
  score: ScoreSchema,
  firstHalfScore: ScoreSchema,
  firstToScore: z.enum(["home", "away", "none"]),
  probs: z.object({
    home: z.number().min(0).max(100),
    draw: z.number().min(0).max(100),
    away: z.number().min(0).max(100),
  }),
});

export const PalpitesModelPickInputSchema = PalpitesInputSchema.extend({
  pick: FixedPickSchema,
  // A palavra da confiança do chip, pro tom do texto bater com ela.
  confidence: z.enum(["baixa", "media", "alta"]),
  // Fatores do JEV que mexeram no λ (frases sem número, sem os do contexto extra).
  factors: z.array(z.string().min(1)).max(12).default([]),
});
export type PalpitesModelPickInput = z.infer<typeof PalpitesModelPickInputSchema>;

export type BuildModelPickInputArgs = BuildPalpitesInputArgs & {
  pick: Pick<PalpitePick, "outcome" | "score" | "firstHalfScore" | "firstToScore" | "probs">;
  confidence: "baixa" | "media" | "alta";
  factors: readonly string[];
};

export function buildModelPickInput(args: BuildModelPickInputArgs): PalpitesModelPickInput {
  const base = buildPredictionInput(args);
  return PalpitesModelPickInputSchema.parse({
    ...base,
    pick: {
      outcome: args.pick.outcome,
      score: args.pick.score,
      firstHalfScore: args.pick.firstHalfScore,
      firstToScore: args.pick.firstToScore,
      probs: args.pick.probs,
    },
    confidence: args.confidence,
    factors: args.factors.slice(0, 12),
  });
}

// ─── System prompt (estático) ────────────────────────────────────────────────

export const SYSTEM_PROMPT_V13 = `Você é o "Palpiteiro": um amigo animado que, depois de olhar a análise de vários mercados de um jogo de futebol, escreve UM palpite-manchete legível. É entretenimento e opinião informada, NÃO conselho de aposta.

O RESULTADO JÁ ESTÁ DECIDIDO. Na mensagem, a seção "Palpite fixado" traz o resultado (vitória do mandante, empate ou vitória do visitante), o placar provável, o placar do 1º tempo e quem marca primeiro. Isso foi calculado antes e NÃO muda: o seu trabalho é escrever o texto que explica ESSE palpite, como um torcedor que entende do jogo. Nunca escreva outro vencedor, outro placar ou um empate quando o palpite é vitória (nem o contrário).

Você recebe: forma recente dos times, confrontos diretos, posição na tabela, o palpite fixado com as chances de cada resultado, os fatores de contexto do jogo, um resumo das outras análises por mercado e notícias factuais recentes de fontes reais.

Sua tarefa é chamar UMA vez a ferramenta submit_palpite com:
1. verdict: o veredito em uma frase curta e humana, coerente com o resultado fixado (ex.: "Vai dar Palmeiras", "Empate truncado nesse clássico", "O visitante leva, mas sofrendo"). Se citar placar, é o placar fixado.
2. verdictOutcome: o resultado que o seu veredito afirma — "home" (vitória do mandante), "draw" (empate) ou "away" (vitória do visitante). TEM de ser igual ao resultado fixado.
3. narrative: 1 a 3 frases explicando o palpite a partir da forma, do histórico, dos fatores e das notícias, em linguagem de torcida. Ajuste o tom à confiança informada (baixa = jogo aberto, sem cravar com certeza; alta = favoritismo claro).
4. citedMarkets: a lista dos rótulos de mercado que pesaram no texto (ex.: ["Resultado (1X2)", "Mais/Menos gols"]). Use os rótulos que vierem no resumo.
5. cardsTemperature (OPCIONAL): se o jogo tem CARA de pegado (clássico, rivalidade quente, jogo decisivo, ou árbitro rigoroso citado nas notícias), escolha "pegado" ou "muito_pegado". Em jogo morno ou na dúvida, OMITA o campo. NUNCA um número de cartões.

REGRAS INVIOLÁVEIS:
- NUNCA mencione de onde veio o palpite (mercado, modelo, cálculo, chances, probabilidade). Escreva como opinião de torcedor.
- NUNCA cite números de chance ou porcentagem em verdict ou narrative.
- É TERMINANTEMENTE PROIBIDO linguagem de aposta em verdict ou narrative — como número OU como palavra: edge, valor esperado/EV, stake/unidades, Yield, lucro, retorno, odd/cotação, preço, R$. (PROIBIDO: "odd boa no Palmeiras", "o preço do over". OK: "o Palmeiras vem voando e marca fácil em casa".)
- Use SÓ os dados fornecidos. NÃO invente jogadores, lesões ou números.
- Total de gols: se citar gols marcados/sofridos de um time, copie o total exato da linha "Últimos N jogos (placares contados)" desse time, dizendo a janela (ex.: "7 gols sofridos nos últimos 5 jogos"). NUNCA some, recalcule ou arredonde; a média por jogo, se citada, vai como média (ex.: "0,8 gol sofrido por jogo"), nunca como total.
- Cartões/árbitro: a temperatura de cartões vai EXCLUSIVAMENTE no campo cardsTemperature. É PROIBIDO mencionar cartões, árbitro, faltas ou contagem de cartões em verdict ou narrative.
- O placar provável é conferido depois (acertou/errou). Trate como palpite divertido, nunca como "acerto garantido".
- Responda EXCLUSIVAMENTE chamando a ferramenta submit_palpite. Não escreva texto livre fora da chamada.

Tom: leve, brasileiro, animado, frases curtas. É papo de torcida com embasamento, não relatório.`;

// ─── Tool (ToolDef NEUTRO, ADR 0027) — espelha o Zod acima ────────────────────

const SUBMIT_PALPITE_V13_TOOL = {
  name: "submit_palpite",
  description:
    "Envia o texto do palpite-manchete para o resultado já fixado: veredito, o resultado que o veredito afirma, narrativa e mercados citados. Chame esta ferramenta EXATAMENTE UMA VEZ. NUNCA inclua números de chance ou de valor.",
  input_schema: {
    type: "object",
    properties: {
      verdict: {
        type: "string",
        minLength: 1,
        maxLength: 280,
        description:
          "Veredito em uma frase curta e humana, coerente com o resultado fixado. SEM linguagem de aposta.",
      },
      verdictOutcome: {
        type: "string",
        enum: ["home", "draw", "away"],
        description:
          "O resultado que o veredito afirma: 'home' (vitória do mandante), 'draw' (empate), 'away' (vitória do visitante). Igual ao resultado fixado.",
      },
      cardsTemperature: {
        type: "string",
        enum: ["pegado", "muito_pegado"],
        description:
          "OPCIONAL: temperatura de cartões do jogo — 'pegado' (clássico/decisão/rivalidade) ou 'muito_pegado' (rivalidade quente/árbitro citado). OMITA em jogo morno. NUNCA mencione cartões/árbitro em verdict/narrative.",
      },
      narrative: {
        type: "string",
        minLength: 1,
        maxLength: 600,
        description:
          "1 a 3 frases explicando o palpite fixado a partir de forma/histórico/fatores/notícias. SEM linguagem de aposta, SEM porcentagem.",
      },
      citedMarkets: {
        type: "array",
        maxItems: 10,
        items: { type: "string", minLength: 1 },
        description:
          "Rótulos dos mercados que pesaram no texto (ex.: 'Resultado (1X2)'). Pode ser vazio.",
      },
    },
    required: ["verdict", "verdictOutcome", "narrative", "citedMarkets"],
    additionalProperties: false,
  },
} as const;

export { SUBMIT_PALPITE_V13_TOOL };

// ─── buildUserMessage ─────────────────────────────────────────────────────────

const fmt1 = (n: number): string => (Number.isFinite(n) ? n.toFixed(1) : "n/a");

const CONFIDENCE_WORD = { baixa: "baixa", media: "média", alta: "alta" } as const;

// Mercados cujo resultado é o próprio palpite fixado: sem "recomenda/destacou" e sem o
// racional (que defende a escolha de valor), pra o texto não puxar pro outro lado. Nos
// outros, "a análise destacou", nunca "preço": a palavra no insumo vazava pro texto.
const RESULT_MARKETS = new Set(["match_result", "double_chance"]);

function outcomeText(
  outcome: "home" | "draw" | "away",
  input: PalpitesModelPickInput,
): string {
  if (outcome === "home") return `vitória do ${input.match.homeTeam} (mandante)`;
  if (outcome === "away") return `vitória do ${input.match.awayTeam} (visitante)`;
  return "empate";
}

export function buildModelPickUserMessage(
  input: PalpitesModelPickInput,
  ctx: { daysToKickoff: number },
): string {
  const lines: string[] = [];
  pushMatchFactLines(lines, input, ctx);

  const { pick } = input;
  const { homeTeam, awayTeam } = input.match;
  lines.push("");
  lines.push("# Palpite fixado (NÃO muda — escreva o texto para ESTE resultado)");
  lines.push(`- Resultado: ${outcomeText(pick.outcome, input)}`);
  lines.push(`- verdictOutcome: "${pick.outcome}"`);
  lines.push(`- Placar provável: ${homeTeam} ${pick.score.home}–${pick.score.away} ${awayTeam}`);
  lines.push(`- Placar do 1º tempo: ${pick.firstHalfScore.home}–${pick.firstHalfScore.away}`);
  lines.push(
    `- Primeiro a marcar: ${
      pick.firstToScore === "home"
        ? homeTeam
        : pick.firstToScore === "away"
          ? awayTeam
          : "ninguém (0–0)"
    }`,
  );
  lines.push(
    `- Chances de cada resultado (insumo — NÃO cite): vitória do ${homeTeam} ${fmt1(pick.probs.home)}%, empate ${fmt1(pick.probs.draw)}%, vitória do ${awayTeam} ${fmt1(pick.probs.away)}%`,
  );
  lines.push(`- Confiança do palpite: ${CONFIDENCE_WORD[input.confidence]}`);

  lines.push("");
  lines.push("# Fatores de contexto do jogo");
  if (input.factors.length === 0) {
    lines.push("- (nenhum fator de contexto mexeu no jogo)");
  } else {
    for (const f of input.factors) lines.push(`- ${f}`);
  }

  lines.push("");
  lines.push("# Análises por mercado (insumo — NÃO cite números na manchete)");
  if (input.analyses.length === 0) {
    lines.push("- (nenhuma análise disponível)");
  } else {
    for (const a of input.analyses) {
      if (RESULT_MARKETS.has(a.marketKey)) {
        lines.push(`- ${a.marketLabel}: considerado no palpite fixado acima.`);
        continue;
      }
      if (a.isPass || !(a.recommendedLabel ?? a.recommendation)) {
        lines.push(`- ${a.marketLabel}: nada se destacou.`);
      } else {
        lines.push(
          `- ${a.marketLabel}: a análise destacou "${a.recommendedLabel ?? a.recommendation}".`,
        );
      }
      if (a.rationale) lines.push(`  Racional: ${a.rationale}`);
    }
  }

  pushNewsLines(lines, input);

  lines.push("");
  lines.push("# Sua tarefa");
  lines.push(
    `Escreva o texto do palpite fixado acima: verdict coerente com ${outcomeText(pick.outcome, input)}, verdictOutcome "${pick.outcome}", narrativa de 1 a 3 frases e os mercados citados. Use a forma, o histórico, a tabela, os fatores e as notícias pra explicar por que esse resultado faz sentido; não troque o vencedor nem o placar. Opcionalmente preencha cardsTemperature ('pegado'/'muito_pegado') se o jogo tem cara de pegado — OMITA em jogo morno; NUNCA cite cartões/árbitro em verdict ou narrative. NUNCA cite chances, porcentagens, preço, odd, edge, EV, stake ou R$, nem de onde veio o palpite. Chame submit_palpite.`,
  );

  return lines.join("\n");
}

// ─── Cartridge ────────────────────────────────────────────────────────────────

export const palpitesModelPickCartridge: PalpiteCartridge<
  PalpitesModelPickInput,
  PalpiteModelPickOutput,
  BuildModelPickInputArgs
> = {
  version: PALPITES_VERSION,
  systemPrompt: SYSTEM_PROMPT_V13,
  tool: toToolDef(SUBMIT_PALPITE_V13_TOOL),
  toolName: SUBMIT_PALPITE_V13_TOOL.name,
  inputSchema: PalpitesModelPickInputSchema,
  outputSchema: PalpitesModelPickOutputSchema,
  buildPredictionInput: buildModelPickInput,
  buildUserMessage: buildModelPickUserMessage,
};
