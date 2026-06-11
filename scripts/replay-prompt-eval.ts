/*
 * Replay eval do prompt — gate de regressão para bumps de PROMPT_VERSION
 * (issue #105). Dev-only; NUNCA roda em produção.
 *
 * O que faz:
 *  - Lê os `ai_calls` recentes com status "ok" de versões ANTERIORES do prompt
 *    (junto da prediction persistida de cada um — a baseline).
 *  - Reaproveita o `inputPayload` armazenado (a request completa do Anthropic:
 *    model/tools/messages/max_tokens/tool_choice/thinking|temperature) trocando
 *    APENAS o system prompt pela versão atual de `lib/ai/prompts/over_under_v1`.
 *  - Chama a API da Anthropic e compara recommendation/confidence_pct/
 *    minimum_odd contra a baseline persistida do mesmo jogo.
 *
 * Critério de abort (não mergear o bump se REPROVADO):
 *  - qualquer flip de `recommendation`, OU
 *  - mediana de |Δconfidence| > 5pp.
 *
 * Fronteira de lib/ai/predict.ts: este script chama o SDK direto e isso é uma
 * exceção DELIBERADA (registrada na issue #105) — a fronteira existe pra
 * garantir que todo fluxo do APP logue em `ai_calls`; um eval offline dev-only
 * não cria predições, não grava em `ai_calls` e não roda em produção. NÃO
 * importar `predict.ts` aqui (dispararia coleta de dados e persistência).
 * Zero quota da Odds API: os payloads já estão armazenados, sem fetch.
 *
 * Run: pnpm tsx scripts/replay-prompt-eval.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, ne } from "drizzle-orm";

import { aiCalls, matches, predictions } from "@/db/schema";
import { db } from "@/lib/db";
import { getAnthropicClient } from "@/lib/ai/anthropic";
import { calculateCost } from "@/lib/ai/cost";
import { isAIModelId } from "@/lib/ai/models";
import {
  PROMPT_VERSION,
  SUBMIT_PREDICTION_TOOL,
  SYSTEM_PROMPT,
} from "@/lib/ai/prompts/over_under_v1";
import { OverUnderOutputSchema, type OverUnderOutput } from "@/lib/ai/schemas/output";

const MIN_PAYLOADS = 5;
const MAX_PAYLOADS = 10;
const MAX_DELTA_CONF_MEDIAN_PP = 5;
// tool_choice "auto" (caminho adaptive/Opus) permite ao modelo não chamar o
// tool; uma re-tentativa cobre o caso raro sem mascarar problema sistêmico.
const MAX_ATTEMPTS_PER_PAYLOAD = 2;

function requireEnv(name: string): void {
  if (!process.env[name]) {
    throw new Error(`${name} not set — populate .env.local from .env.example`);
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fmt(v: number | null, digits: number): string {
  return v === null ? "—" : v.toFixed(digits);
}

type ReplayResult = {
  label: string;
  model: string;
  baseline: {
    recommendation: string;
    confidencePct: number;
    minimumOdd: number | null;
    promptVersion: string;
  };
  replay: OverUnderOutput;
  deltaConf: number;
  flip: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

async function replayOne(args: {
  client: Anthropic;
  inputPayload: unknown;
}): Promise<{ output: OverUnderOutput; usage: Anthropic.Usage }> {
  // O inputPayload é o objeto exato passado a client.messages.create() pelo
  // predict.ts (request-builder), persistido como jsonb — o cast reverte essa
  // serialização. Troca APENAS o system prompt; resto (model, tools, messages,
  // tool_choice, thinking/temperature, max_tokens) replayed byte a byte.
  const stored = args.inputPayload as Anthropic.MessageCreateParamsNonStreaming;
  const request: Anthropic.MessageCreateParamsNonStreaming = {
    ...stored,
    system: SYSTEM_PROMPT,
  };

  let lastFailure = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PAYLOAD; attempt++) {
    const response = await args.client.messages.create(request);
    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === SUBMIT_PREDICTION_TOOL.name,
    );
    if (!toolUse) {
      lastFailure = `model did not call ${SUBMIT_PREDICTION_TOOL.name} (stop_reason=${response.stop_reason})`;
      continue;
    }
    const parsed = OverUnderOutputSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      lastFailure = `invalid output: ${JSON.stringify(parsed.error.issues)}`;
      continue;
    }
    return { output: parsed.data, usage: response.usage };
  }
  throw new Error(lastFailure);
}

async function main(): Promise<void> {
  requireEnv("DATABASE_URL");
  requireEnv("ANTHROPIC_API_KEY");

  console.log("─── Replay prompt eval ───");
  console.log(`Prompt candidato: ${PROMPT_VERSION}`);

  // Baselines: ai_calls ok de versões ANTERIORES de prompt, com a prediction
  // persistida (recommendation/conf/minOdd congelados no momento da análise).
  const rows = await db
    .select({
      aiCallId: aiCalls.id,
      model: aiCalls.model,
      inputPayload: aiCalls.inputPayload,
      createdAt: aiCalls.createdAt,
      baselinePromptVersion: predictions.promptVersion,
      recommendation: predictions.recommendation,
      confidencePct: predictions.confidencePct,
      minimumOdd: predictions.minimumOdd,
      homeTeam: matches.homeTeam,
      awayTeam: matches.awayTeam,
    })
    .from(aiCalls)
    .innerJoin(predictions, eq(predictions.aiCallId, aiCalls.id))
    .innerJoin(matches, eq(matches.id, aiCalls.matchId))
    .where(
      and(eq(aiCalls.status, "ok"), ne(aiCalls.promptVersion, PROMPT_VERSION)),
    )
    .orderBy(desc(aiCalls.createdAt))
    .limit(MAX_PAYLOADS);

  if (rows.length < MIN_PAYLOADS) {
    throw new Error(
      `need >= ${MIN_PAYLOADS} stored ok ai_calls with promptVersion != ${PROMPT_VERSION}; found ${rows.length}`,
    );
  }

  const coverage = new Set(rows.map((r) => r.recommendation));
  console.log(
    `Payloads: ${rows.length} (cobertura de recommendation: ${[...coverage].sort().join(", ")})`,
  );

  const client = getAnthropicClient();
  const results: ReplayResult[] = [];

  for (const [i, row] of rows.entries()) {
    const label = `${row.homeTeam} x ${row.awayTeam}`;
    console.log(
      `\n[${i + 1}/${rows.length}] ${label} — model=${row.model} baseline=${row.baselinePromptVersion}`,
    );
    const { output, usage } = await replayOne({
      client,
      inputPayload: row.inputPayload,
    });

    const baselineConf = Number(row.confidencePct);
    const flip = output.recommendation !== row.recommendation;
    const deltaConf = Math.abs(output.confidence_pct - baselineConf);
    const costUsd = isAIModelId(row.model)
      ? calculateCost({
          model: row.model,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
        })
      : 0;

    results.push({
      label,
      model: row.model,
      baseline: {
        recommendation: row.recommendation,
        confidencePct: baselineConf,
        minimumOdd: row.minimumOdd === null ? null : Number(row.minimumOdd),
        promptVersion: row.baselinePromptVersion,
      },
      replay: output,
      deltaConf,
      flip,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      costUsd,
    });
    console.log(
      `  ${row.recommendation} → ${output.recommendation}${flip ? "  ⚠ FLIP" : ""} | ` +
        `conf ${baselineConf.toFixed(1)} → ${output.confidence_pct.toFixed(1)} (|Δ|=${deltaConf.toFixed(1)}pp) | ` +
        `minOdd ${fmt(row.minimumOdd === null ? null : Number(row.minimumOdd), 3)} → ${fmt(output.minimum_odd ?? null, 3)}`,
    );
  }

  // ── Tabela ────────────────────────────────────────────────────────────────
  const header = [
    "jogo".padEnd(34),
    "modelo".padEnd(28),
    "rec v1.x→v1.3".padEnd(14),
    "conf v1.x→v1.3 (|Δ|)".padEnd(24),
    "minOdd v1.x→v1.3".padEnd(18),
    "tokens in/out".padEnd(14),
    "custo USD",
  ].join(" | ");
  console.log(`\n${header}`);
  console.log("-".repeat(header.length));
  for (const r of results) {
    console.log(
      [
        r.label.slice(0, 34).padEnd(34),
        r.model.padEnd(28),
        `${r.baseline.recommendation}→${r.replay.recommendation}${r.flip ? " ⚠" : ""}`.padEnd(14),
        `${r.baseline.confidencePct.toFixed(1)}→${r.replay.confidence_pct.toFixed(1)} (${r.deltaConf.toFixed(1)}pp)`.padEnd(24),
        `${fmt(r.baseline.minimumOdd, 3)}→${fmt(r.replay.minimum_odd ?? null, 3)}`.padEnd(18),
        `${r.inputTokens}/${r.outputTokens}`.padEnd(14),
        r.costUsd.toFixed(6),
      ].join(" | "),
    );
  }

  // ── Veredito ──────────────────────────────────────────────────────────────
  const flips = results.filter((r) => r.flip);
  const medianDelta = median(results.map((r) => r.deltaConf));
  const totalCost = results.reduce((acc, r) => acc + r.costUsd, 0);
  const failed = flips.length > 0 || medianDelta > MAX_DELTA_CONF_MEDIAN_PP;

  console.log("\n─── Veredito ───");
  console.log(`flips de recommendation : ${flips.length}`);
  console.log(
    `mediana |Δconfidence|   : ${medianDelta.toFixed(1)}pp (limite: ${MAX_DELTA_CONF_MEDIAN_PP}pp)`,
  );
  console.log(`custo total do replay   : $${totalCost.toFixed(4)}`);
  console.log(
    failed
      ? `\nREPROVADO — não mergear ${PROMPT_VERSION}; iterar o texto do prompt e rodar de novo.`
      : `\nAPROVADO — ${PROMPT_VERSION} preserva as decisões da baseline dentro do critério.`,
  );

  // Racionais novos por extenso — o critério de legibilidade (conclusão na
  // primeira frase, jargão explicado) é julgado a olho e colado no PR.
  console.log("\n─── Racionais v1.3 (replay) ───");
  for (const r of results) {
    console.log(`\n${r.label} [${r.replay.recommendation}]`);
    console.log(`  ${r.replay.rationale}`);
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Replay eval failed:");
  console.error(err);
  process.exit(1);
});
