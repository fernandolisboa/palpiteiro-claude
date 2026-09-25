/*
 * Replay eval do prompt — gate de regressão para bumps de PROMPT_VERSION
 * (issue #105). Dev-only; NUNCA roda em produção.
 *
 * O que faz:
 *  - Lê os `ai_calls` recentes com status "ok" da versão de prompt IMEDIATAMENTE
 *    anterior à atual (junto da prediction persistida de cada um — a baseline),
 *    deduplicados por jogo (a ai_call mais recente por matchId).
 *  - Reaproveita o `inputPayload` armazenado (a request completa do Anthropic:
 *    model/messages/max_tokens/tool_choice/thinking|temperature) trocando o
 *    system prompt E o tools array pela versão atual do CARTUCHO over/under
 *    (`lib/ai/markets/over_under`); o resto (model, messages, tool_choice,
 *    thinking/temperature, max_tokens) é replayed byte a byte.
 *  - Chama a API da Anthropic e compara recommendation/confidence_pct/
 *    minimum_odd contra a baseline persistida do mesmo jogo.
 *
 * Critério de abort (não mergear o bump se REPROVADO) — a regra de FLIP é
 * MODEL-AWARE (ADR 0021, #203):
 *  - flip de `recommendation` no caminho TEMPERATURE (Sonnet 4.5/Haiku, amostragem
 *    fixa 0.3) — ESTRITO: qualquer flip reprova; OU
 *  - flip no caminho ADAPTIVE (Fable 5.1/Opus 5.5/Sonnet 5, sem knob de amostragem) que
 *    REPRODUZA na maioria de N re-replays do MESMO payload (ADAPTIVE_FLIP_REPRO_RUNS);
 *    flip esporádico é ruído de amostragem (o modo de falha A/A do #105) — tolerado
 *    e logado, NÃO reprova; OU
 *  - mediana de |Δconfidence| > 5pp (GLOBAL, intocado); OU
 *  - qualquer payload com ERRO de replay (GLOBAL, intocado).
 * A bifurcação por caminho e o veredito vivem em scripts/replay-eval-core.ts (puro,
 * unit-testado a seco); o loop de reprodução PAGO fica aqui no main().
 *
 * Fronteira de lib/ai/predict.ts: este script chama o SDK direto e isso é uma
 * exceção DELIBERADA (registrada na issue #105) — a fronteira existe pra
 * garantir que todo fluxo do APP logue em `ai_calls`; um eval offline dev-only
 * não cria predições, não grava em `ai_calls` e não roda em produção. NÃO
 * importar `predict.ts` aqui (dispararia coleta de dados e persistência).
 * Zero quota da Odds API: os payloads já estão armazenados, sem fetch.
 *
 * Seam AIProvider (ADR 0027 / #230): este script fica DELIBERADAMENTE Anthropic-only
 * e FORA do seam. O gate de flip é model-aware por `thinkingMode` (adaptive vs
 * temperature, #203) — Anthropic-específico —, ele replaya `inputPayload`s no shape
 * Anthropic (`MessageCreateParamsNonStreaming`) e usa `Anthropic.ToolUseBlock`
 * direto, então portá-lo pro seam é NO-GO (ADR 0027). Importa `getAnthropicClient`
 * via o shim `@/lib/ai/anthropic` (não pelo adapter) — fora da porta única do app.
 *
 * Run: pnpm tsx scripts/replay-prompt-eval.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { aiCalls, matches, predictions } from "@/db/schema";
import { db } from "@/lib/db";
import { getAnthropicClient } from "@/lib/ai/anthropic";
import { calculateCost } from "@/lib/ai/cost";
// Eval estrutural por cartucho/versão (ADR 0017): carrega o artefato de prompt e
// os schemas do CARTUCHO over/under (não mais de módulos soltos). O candidato é
// `cartridge.version`; quando houver 2º cartucho, parametrizar por marketKey.
import {
  overUnderCartridge,
  OverUnderOutputSchema,
  type OverUnderOutput,
} from "@/lib/ai/markets/over_under";
import { isAIModelId } from "@/lib/ai/models";
import { isEffort } from "@/lib/ai/generation-params";
import { requestTiming } from "@/lib/ai/providers/anthropic/timeouts";
import {
  ADAPTIVE_FLIP_REPRO_RUNS,
  classifyThinkingMode,
  computeVerdict,
  isAdaptiveFlipConfirmed,
  MAX_DELTA_CONF_MEDIAN_PP,
  pOver,
  type ThinkingPath,
} from "@/scripts/replay-eval-core";

const cartridge = overUnderCartridge;
const PROMPT_VERSION = cartridge.version;
const SYSTEM_PROMPT = cartridge.systemPrompt;
const SUBMIT_PREDICTION_TOOL = cartridge.tool;

const MIN_PAYLOADS = 5;
const MAX_PAYLOADS = 10;
// MAX_DELTA_CONF_MEDIAN_PP e os helpers puros (median/pOver) vivem em
// scripts/replay-eval-core.ts (importados acima) — reusados pelo veredito.
// Buscamos mais linhas do que MAX_PAYLOADS porque a query dedup por jogo em
// memória (a ai_call mais recente por matchId) antes de cortar — re-análises do
// mesmo jogo não devem ocupar slots nem dobrar peso na mediana.
const FETCH_LIMIT = MAX_PAYLOADS * 5;
// tool_choice "auto" (caminho adaptive/Opus) permite ao modelo não chamar o
// tool; uma re-tentativa cobre esse caso raro. ESCOPO REAL (honesto): a re-
// tentativa cobre TANTO tool_missing QUANTO invalid_output (Zod) — ambas são
// logadas com console.warn pra não mascarar um prompt que aumente a taxa de
// output inválido, e o usage das tentativas falhas é somado ao custo total.
const MAX_ATTEMPTS_PER_PAYLOAD = 2;

function requireEnv(name: string): void {
  if (!process.env[name]) {
    throw new Error(`${name} not set — populate .env.local from .env.example`);
  }
}

function fmt(v: number | null, digits: number): string {
  return v === null ? "—" : v.toFixed(digits);
}

type ReplayResult = {
  label: string;
  model: string;
  // Caminho de amostragem (ADR 0021): rege se o flip é estrito (temperature) ou
  // sujeito à reprodução em N runs (adaptive). Modelo fora do registry → "temperature".
  thinkingMode: ThinkingPath;
  baseline: {
    recommendation: string;
    confidencePct: number;
    minimumOdd: number | null;
    promptVersion: string;
  };
  replay: OverUnderOutput;
  deltaConf: number;
  // flip = flipou no 1º replay (autoritativo no caminho temperature).
  flip: boolean;
  // flipConfirmed = conta como reprovação: no temperature === flip; no adaptive é o
  // resultado da reprodução em N runs (maioria).
  flipConfirmed: boolean;
  // Tally da reprodução adaptive (só preenchido quando houve reprodução).
  reproRuns?: number;
  reproFlipped?: number;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  // null = modelo fora do registry de pricing (custo desconhecido, não $0).
  costKnown: boolean;
};

// Linha que falhou em replayar (payload malformado ou falha dupla na API/Zod).
// Vira linha "ERRO" na tabela e é EXCLUÍDA das estatísticas, sem derrubar o run.
type ReplayError = {
  label: string;
  model: string;
  reason: string;
};

// Shape mínimo do inputPayload jsonb antes de mandar pra API — um payload
// corrompido/antigo viraria 400 e (sem isto) cairia no mesmo caminho de falha.
const StoredRequestSchema = z.object({
  model: z.string(),
  messages: z.array(z.unknown()).min(1),
  max_tokens: z.number(),
});

type ReplayOneResult = {
  output: OverUnderOutput;
  usage: { inputTokens: number; outputTokens: number };
  attempts: number;
};

async function replayOne(args: {
  client: Anthropic;
  inputPayload: unknown;
}): Promise<ReplayOneResult> {
  // O inputPayload é o objeto exato passado a client.messages.create() pelo
  // predict.ts (request-builder), persistido como jsonb. Valida o shape mínimo
  // antes de castar — um payload corrompido não deve virar 400 silencioso.
  const shape = StoredRequestSchema.safeParse(args.inputPayload);
  if (!shape.success) {
    throw new Error(
      `inputPayload malformado: ${JSON.stringify(shape.error.issues)}`,
    );
  }
  const stored = args.inputPayload as Anthropic.MessageCreateParamsNonStreaming;
  // Troca o system prompt E o tools array pela versão atual (o bump pode mudar
  // a description da tool, não só o system). O nome "submit_prediction" não
  // muda, então o tool_choice armazenado continua válido. Mesmo cast do
  // predict.ts. Resto (model, messages, tool_choice, thinking/temperature,
  // max_tokens) replayed byte a byte.
  const request: Anthropic.MessageCreateParamsNonStreaming = {
    ...stored,
    system: SYSTEM_PROMPT,
    tools: [SUBMIT_PREDICTION_TOOL as unknown as Anthropic.Tool],
  };

  let lastFailure = "";
  // Custo de TODA tentativa conta (chamada falha ainda é paga) — acumulamos o
  // usage de tentativas falhas pra não subreportar o custo total.
  let inputTokens = 0;
  let outputTokens = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_PAYLOAD; attempt++) {
    // Payload adaptive (tem `thinking`) leva o timeout escalado do adapter (#524).
    const timing = requestTiming({
      thinkingMode: request.thinking ? "adaptive" : "temperature",
      maxTokens: request.max_tokens,
      effort: isEffort(request.output_config?.effort)
        ? request.output_config.effort
        : undefined,
    });
    const response =
      timing.kind === "options"
        ? await args.client.messages.create(request, timing.options)
        : await args.client.messages.create(request);
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    // Recusa (#524): re-tentar tende a recusar de novo e é pago — falha já.
    if (response.stop_reason === "refusal") {
      lastFailure = `o modelo recusou a análise (category=${response.stop_details?.category ?? "n/a"})`;
      console.warn(`  ⚠ tentativa ${attempt}: ${lastFailure}`);
      break;
    }
    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === SUBMIT_PREDICTION_TOOL.name,
    );
    if (!toolUse) {
      lastFailure = `model did not call ${SUBMIT_PREDICTION_TOOL.name} (stop_reason=${response.stop_reason})`;
      console.warn(`  ⚠ tentativa ${attempt} falhou: ${lastFailure}`);
      continue;
    }
    const parsed = OverUnderOutputSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      lastFailure = `invalid output: ${JSON.stringify(parsed.error.issues)}`;
      console.warn(`  ⚠ tentativa ${attempt} falhou: ${lastFailure}`);
      continue;
    }
    return {
      output: parsed.data,
      usage: { inputTokens, outputTokens },
      attempts: attempt,
    };
  }
  throw new Error(lastFailure);
}

async function main(): Promise<void> {
  // Guarda sem-paga DEFENSIVA: este eval chama a API paga da Anthropic. O glob
  // default do Vitest já exclui scripts/, e o único run-path é
  // `pnpm tsx scripts/replay-prompt-eval.ts` (manual do usuário) — mas se algum
  // CI invocar este arquivo, abortamos ANTES de queimar spend.
  if (process.env.CI) {
    throw new Error(
      "replay-prompt-eval é manual e PAGO — não deve rodar em CI (process.env.CI setado)",
    );
  }
  requireEnv("DATABASE_URL");
  requireEnv("ANTHROPIC_API_KEY");

  console.log("─── Replay prompt eval ───");
  console.log(`Prompt candidato: ${PROMPT_VERSION}`);

  // Pina a baseline na versão IMEDIATAMENTE anterior à atual: a versão de prompt
  // != atual usada mais recentemente em ai_calls ok. Comparar contra um mix de
  // várias versões antigas mediria drift acumulado de múltiplos bumps e poderia
  // atribuir um flip ao candidato quando ele vem de duas versões atrás.
  const [latestPrior] = await db
    .select({ promptVersion: aiCalls.promptVersion })
    .from(aiCalls)
    .where(
      and(
        eq(aiCalls.status, "ok"),
        // Cerca o gate ao Anthropic (ADR 0027 #231): provider virou `text` e pode
        // conter 'openai'. O gate model-aware é Anthropic-thinkingMode-específico
        // (#203) e replaya payloads no shape Anthropic — uma row OpenAI seria
        // rejeitada pelo StoredRequestSchema (max_completion_tokens) de qualquer
        // forma, mas filtrá-la aqui evita poluir o dedup/contagem.
        eq(aiCalls.provider, "anthropic"),
        ne(aiCalls.promptVersion, PROMPT_VERSION),
      ),
    )
    .orderBy(desc(aiCalls.createdAt))
    .limit(1);

  if (!latestPrior) {
    throw new Error(
      `no stored ok ai_calls with promptVersion != ${PROMPT_VERSION} to use as baseline`,
    );
  }
  const baselineVersion = latestPrior.promptVersion;
  console.log(`Baseline (versão anterior pinada): ${baselineVersion}`);

  // Baselines: ai_calls ok da versão anterior pinada, com a prediction
  // persistida (recommendation/conf/minOdd congelados no momento da análise).
  // Busca FETCH_LIMIT linhas e dedup em memória por (matchId, model) antes de
  // cortar em MAX_PAYLOADS — re-análises do MESMO jogo COM O MESMO modelo (botão
  // "analisar de novo", #117) são as verdadeiras quase-duplicatas: mesma
  // entrada, mesmo caminho de amostragem, replay quase idêntico que pagaria em
  // dobro e dobraria o peso na mediana. O modelo entra na chave de propósito:
  // o MESMO jogo analisado por Opus (adaptive) vs Sonnet (temperature) são
  // pontos de avaliação legítimos e distintos (regimes de amostragem diferentes
  // — a própria narrativa do gate distingue os dois caminhos), não duplicatas.
  const fetched = await db
    .select({
      aiCallId: aiCalls.id,
      matchId: aiCalls.matchId,
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
      and(
        eq(aiCalls.status, "ok"),
        eq(aiCalls.provider, "anthropic"), // gate Anthropic-only (ADR 0027 #231)
        eq(aiCalls.promptVersion, baselineVersion),
      ),
    )
    .orderBy(desc(aiCalls.createdAt))
    .limit(FETCH_LIMIT);

  // Dedup por (matchId, model): as linhas já vêm desc(createdAt), então a
  // primeira vista de cada par é a mais recente. Corta em MAX_PAYLOADS depois.
  const seen = new Set<string>();
  const deduped: typeof fetched = [];
  for (const row of fetched) {
    const key = `${row.matchId}::${row.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
    if (deduped.length >= MAX_PAYLOADS) break;
  }
  const rows = deduped;

  if (rows.length < MIN_PAYLOADS) {
    throw new Error(
      `need >= ${MIN_PAYLOADS} stored ok ai_calls (distinct match×model) with promptVersion == ${baselineVersion}; found ${rows.length} after dedup`,
    );
  }

  const distinctMatches = new Set(rows.map((r) => r.matchId)).size;
  const coverage = new Set(rows.map((r) => r.recommendation));
  console.log(
    `Payloads: ${rows.length} pares (match×model) de ${distinctMatches} jogos distintos ` +
      `(de ${fetched.length} ai_calls; cobertura de recommendation: ${[...coverage].sort().join(", ")})`,
  );

  const client = getAnthropicClient();
  const results: ReplayResult[] = [];
  const errors: ReplayError[] = [];

  for (const [i, row] of rows.entries()) {
    const label = `${row.homeTeam} x ${row.awayTeam}`;
    console.log(
      `\n[${i + 1}/${rows.length}] ${label} — model=${row.model} baseline=${row.baselinePromptVersion}`,
    );

    // Um payload que falha (malformado ou falha dupla) vira linha ERRO e é
    // excluído das estatísticas, sem derrubar o run inteiro.
    let replayed: ReplayOneResult;
    try {
      replayed = await replayOne({ client, inputPayload: row.inputPayload });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`  ✗ ERRO (excluído das estatísticas): ${reason}`);
      errors.push({ label, model: row.model, reason });
      continue;
    }
    const { output, usage, attempts } = replayed;

    const baselineConf = Number(row.confidencePct);
    const flip = output.recommendation !== row.recommendation;
    const thinkingMode = classifyThinkingMode(row.model);
    // |Δconfidence| normalizado pra P(over) nos dois lados — sem isso, um flip
    // pass→under compararia P(over) contra P(under), grandezas diferentes. É SEMPRE
    // o delta do 1º replay (paridade com o single-shot temperature); pra flips
    // adaptive confirmados pode sub-representar o sinal dos reruns — a contagem de
    // confirmados no veredito é a autoridade.
    const deltaConf = Math.abs(
      pOver(output.recommendation, output.confidence_pct) -
        pOver(row.recommendation, baselineConf),
    );

    // Reprodução model-aware (ADR 0021): um flip no caminho ADAPTIVE dispara N-1
    // re-replays do MESMO payload; só conta como reprovação (flipConfirmed) se
    // flipar na MAIORIA dos N runs. Custo-mínimo: só payloads adaptive que já
    // fliparam re-rodam. Tokens/custo acumulam TODAS as tentativas (1 row por
    // payload, paridade com temperature). No caminho temperature, flipConfirmed
    // === flip (estrito, sem rerun).
    let inputTokens = usage.inputTokens;
    let outputTokens = usage.outputTokens;
    // attempts acumula TODAS as tentativas (incl. as internas de cada rerun, até
    // MAX_ATTEMPTS_PER_PAYLOAD) — senão o volume de chamadas pagas é subreportado.
    let totalAttempts = attempts;
    let flipConfirmed = flip;
    let reproRuns: number | undefined;
    let reproFlipped: number | undefined;
    if (flip && thinkingMode === "adaptive") {
      let flippedRuns = 1; // o 1º replay (já flipou) é o run 1 de N.
      for (let run = 2; run <= ADAPTIVE_FLIP_REPRO_RUNS; run++) {
        try {
          const rep = await replayOne({ client, inputPayload: row.inputPayload });
          inputTokens += rep.usage.inputTokens;
          outputTokens += rep.usage.outputTokens;
          totalAttempts += rep.attempts;
          const repFlip = rep.output.recommendation !== row.recommendation;
          if (repFlip) flippedRuns++;
          console.log(
            `     reprodução ${run}/${ADAPTIVE_FLIP_REPRO_RUNS}: → ${rep.output.recommendation}${repFlip ? " ⚠ flip" : " (sem flip)"}`,
          );
        } catch (err) {
          // Rerun que erra conta como NÃO-flip (não incrementa flippedRuns) contra o
          // N fixo — empurra pra TOLERAR (não reprova o gate por API flaky). NÃO
          // entra em errors[]: o 1º replay já sucedeu, o payload foi avaliado.
          const reason = err instanceof Error ? err.message : String(err);
          console.warn(
            `     ⚠ reprodução ${run}/${ADAPTIVE_FLIP_REPRO_RUNS} errou (conta como não-flip): ${reason}`,
          );
        }
      }
      flipConfirmed = isAdaptiveFlipConfirmed(flippedRuns, ADAPTIVE_FLIP_REPRO_RUNS);
      reproRuns = ADAPTIVE_FLIP_REPRO_RUNS;
      reproFlipped = flippedRuns;
      console.log(
        `     → ${flippedRuns}/${ADAPTIVE_FLIP_REPRO_RUNS} flips — ${flipConfirmed ? "CONFIRMADO (reprova)" : "tolerado como ruído de amostragem (NÃO reprova)"}`,
      );
    }

    // isAIModelId inline no ternário pra TS narrow row.model (string) → AIModelId;
    // um boolean intermediário não estreita o tipo.
    const costKnown = isAIModelId(row.model);
    const costUsd = isAIModelId(row.model)
      ? calculateCost({ model: row.model, inputTokens, outputTokens })
      : 0;
    if (!costKnown) {
      // Modelo fora do registry → custo desconhecido E classificado como ESTRITO
      // (temperature) pro flip. Logado de propósito: nunca tolera flip em silêncio.
      console.warn(
        `  ⚠ modelo "${row.model}" fora do MODEL_REGISTRY — custo desconhecido (n/a, não $0) e flip avaliado ESTRITO (caminho temperature)`,
      );
    }

    results.push({
      label,
      model: row.model,
      thinkingMode,
      baseline: {
        recommendation: row.recommendation,
        confidencePct: baselineConf,
        minimumOdd: row.minimumOdd === null ? null : Number(row.minimumOdd),
        promptVersion: row.baselinePromptVersion,
      },
      replay: output,
      deltaConf,
      flip,
      flipConfirmed,
      reproRuns,
      reproFlipped,
      attempts: totalAttempts,
      inputTokens,
      outputTokens,
      costUsd,
      costKnown,
    });
    const flipNote = !flip
      ? ""
      : flipConfirmed
        ? "  ⚠ FLIP"
        : "  ~ flip (ruído tolerado)";
    console.log(
      `  ${row.recommendation} → ${output.recommendation}${flipNote} | ` +
        `conf ${baselineConf.toFixed(1)} → ${output.confidence_pct.toFixed(1)} (|Δ P(over)|=${deltaConf.toFixed(1)}pp) | ` +
        `minOdd ${fmt(row.minimumOdd === null ? null : Number(row.minimumOdd), 3)} → ${fmt(output.minimum_odd ?? null, 3)}` +
        `${totalAttempts > 1 ? ` | ${totalAttempts} tentativas` : ""}`,
    );
  }

  // Rótulos de versão derivados (não hardcodados): este script é o gate de TODOS
  // os bumps futuros — na v1.4 a tabela não pode rotular as colunas como v1.3.
  const baseLabel = baselineVersion.replace("over_under_", "");
  const candLabel = PROMPT_VERSION.replace("over_under_", "");

  // ── Tabela ────────────────────────────────────────────────────────────────
  const header = [
    "jogo".padEnd(34),
    "modelo".padEnd(28),
    `rec ${baseLabel}→${candLabel}`.padEnd(14),
    `conf ${baseLabel}→${candLabel} (|Δ P(over)|)`.padEnd(30),
    `minOdd ${baseLabel}→${candLabel}`.padEnd(18),
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
        `${r.baseline.recommendation}→${r.replay.recommendation}${r.flip ? (r.flipConfirmed ? " ⚠" : " ~") : ""}`.padEnd(14),
        `${r.baseline.confidencePct.toFixed(1)}→${r.replay.confidence_pct.toFixed(1)} (${r.deltaConf.toFixed(1)}pp)`.padEnd(30),
        `${fmt(r.baseline.minimumOdd, 3)}→${fmt(r.replay.minimum_odd ?? null, 3)}`.padEnd(18),
        `${r.inputTokens}/${r.outputTokens}`.padEnd(14),
        r.costKnown ? r.costUsd.toFixed(6) : "n/a",
      ].join(" | "),
    );
  }
  for (const e of errors) {
    console.log(
      [
        e.label.slice(0, 34).padEnd(34),
        e.model.padEnd(28),
        "ERRO".padEnd(14),
        e.reason.slice(0, 30).padEnd(30),
        "—".padEnd(18),
        "—".padEnd(14),
        "—",
      ].join(" | "),
    );
  }

  // ── Veredito (model-aware, ADR 0021) ──────────────────────────────────────
  // A regra de flip vive em computeVerdict (puro/testado): flips CONFIRMADOS
  // reprovam (temperature: qualquer flip; adaptive: reproduzido na maioria de N
  // runs); flips adaptive NÃO reproduzidos são ruído tolerado (logados, não
  // reprovam). Mediana de |Δconf| e errors seguem GLOBAIS e intocados. Payload que
  // erra (malformado ou falha dupla no 1º replay) ⇒ REPROVADO: não certificar um
  // bump sem ter avaliado todos os jogos da amostra.
  const { failed, confirmedFlips, toleratedNoiseFlips, medianDelta } =
    computeVerdict({
      results: results.map((r) => ({
        thinkingMode: r.thinkingMode,
        flip: r.flip,
        flipConfirmed: r.flipConfirmed,
        deltaConf: r.deltaConf,
      })),
      errorCount: errors.length,
    });
  const totalCost = results.reduce((acc, r) => acc + r.costUsd, 0);
  const someCostUnknown = results.some((r) => !r.costKnown);

  console.log("\n─── Veredito ───");
  console.log(`amostra avaliada        : ${results.length} jogos`);
  if (errors.length > 0) {
    console.log(`payloads com ERRO       : ${errors.length} (excluídos da amostra)`);
  }
  console.log(`flips que reprovam      : ${confirmedFlips}`);
  if (toleratedNoiseFlips > 0) {
    console.log(
      `flips tolerados (ruído) : ${toleratedNoiseFlips} (adaptive, não reproduzido em ${ADAPTIVE_FLIP_REPRO_RUNS} runs)`,
    );
  }
  console.log(
    `mediana |Δconfidence|   : ${medianDelta.toFixed(1)}pp (escala P(over); limite: ${MAX_DELTA_CONF_MEDIAN_PP}pp)`,
  );
  console.log(
    `custo total do replay   : $${totalCost.toFixed(4)}${someCostUnknown ? " (+ modelo(s) fora do registry, custo n/a)" : ""}`,
  );
  console.log(
    failed
      ? `\nREPROVADO — não mergear ${PROMPT_VERSION}; iterar o texto do prompt e rodar de novo.`
      : `\nAPROVADO — ${PROMPT_VERSION} preserva as decisões da baseline (${baselineVersion}) dentro do critério.`,
  );

  // Racionais novos por extenso — o critério de legibilidade (conclusão na
  // primeira frase, jargão explicado) é julgado a olho e colado no PR.
  console.log(`\n─── Racionais ${candLabel} (replay) ───`);
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
