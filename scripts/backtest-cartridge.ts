/*
 * Backtest de cartucho — gate dos ACs #3/#4 do #173 (≥20 jogos + calibração),
 * parametrizado por mercado (`--marketKey`). Dev-only; PAGO; NUNCA roda em CI/test.
 *
 * ── O QUE FAZ ────────────────────────────────────────────────────────────────
 *  - Pega jogos `finished` com homeScore/awayScore não-nulos QUE JÁ TÊM
 *    `selection_odds_snapshots` capturadas pro `dbMarketKey` deste mercado
 *    (LÊ snapshots existentes — ZERO gasto na Odds API). Pega os `--limit` mais
 *    recentes (default 20). Menos de 20 elegíveis ⇒ WARN alto (mandato AC#3),
 *    mas prossegue com o que existe.
 *  - Pra cada jogo: monta o input do cartucho (supportingData via os providers
 *    de sports-data + as odds N-vias capturadas via getLatestSelectionOddsSnapshots,
 *    no MESMO shape genérico que `cartridge.buildPredictionInput` consome) →
 *    `buildUserMessage` → chama o Anthropic via `getAnthropicClient()` DIRETO
 *    (SDK-direto; exceção SANCIONADA, igual ao replay-prompt-eval) →
 *    `cartridge.outputSchema.safeParse`. NÃO PERSISTE NADA: sem `predict()`, sem
 *    writes no DB, sem `ai_calls`. Re-tenta uma vez em tool_missing/Zod-inválido.
 *  - Pontua contra o resultado CONHECIDO, computado INLINE de homeScore/awayScore
 *    (NÃO depende do registry de settlement): a recomendação do modelo ganhou?
 *    Acurácia + yield realizado por unidade (odd capturada da seleção recomendada:
 *    ganhou = odd−1, perdeu = −1, pass = 0). Dois BASELINES nos MESMOS jogos:
 *    "favorito pela odd" (menor odd via computeMarketImpliedProbabilities) e
 *    "constante trivial" do mercado (over_under→sempre 'over'; 1X2→sempre 'draw').
 *    Tabela de CALIBRAÇÃO simples: bucketiza a prob do modelo da seleção
 *    recomendada em decis e mostra previsto vs hit-rate real.
 *  - Imprime tabela legível: N jogos, LLM vs cada baseline (acurácia, yield),
 *    pass-rate, buckets de calibração. O LLM tem que BATER o baseline pra se
 *    justificar.
 *
 * ── FRONTEIRA DE predict.ts (exceção DELIBERADA) ─────────────────────────────
 *  A fronteira de `lib/ai/predict.ts` existe pra garantir que todo fluxo do APP
 *  logue em `ai_calls`. Este backtest é offline/dev-only: NÃO cria predições, NÃO
 *  grava em `ai_calls`, NÃO roda em produção — então chama o SDK direto (igual ao
 *  replay-prompt-eval). Também NÃO chama `predict()`: predict BLOQUEIA jogos
 *  `finished` ("match is not analyzable"), e o backtest precisa exatamente desses.
 *  Por isso replica a montagem de input/odds do predict (providers + snapshots).
 *
 * ── CUSTO (PAGO — orçar antes de rodar) ──────────────────────────────────────
 *  N × 1 call ao modelo de análise (default = default global do DB, tipicamente
 *  Sonnet/Opus). Ordem de grandeza: ~$1–3 por 20 jogos (1 call/jogo; re-tentativas
 *  raras somam pouco). ZERO gasto na Odds API (lê snapshots já capturadas). Custo
 *  total real é impresso no fim (somando re-tentativas). NÃO rodar autonomamente —
 *  é decisão do usuário.
 *
 * ── SEQUÊNCIA OBRIGATÓRIA (gate #17 do PLAN-173) ─────────────────────────────
 *  1. seedar+ativar o mercado (migration do cartucho);
 *  2. capturar `selection_odds_snapshots` (h2h pro 1X2) de ≥20 jogos `finished`
 *     pelo caminho do #164 (fetch-and-snapshot — leitura barata/free da Odds API);
 *  3. SÓ ENTÃO rodar este backtest PAGO.
 *  Sem o passo 2 a query devolve 0 jogos elegíveis e o script aborta (ou avisa).
 *
 * ── LIMITAÇÃO de provider em jogos HISTÓRICOS (honesta) ──────────────────────
 *  Os providers de sports-data servem dados CORRENTES, não congelados na data do
 *  jogo: `getStandings` traz a classificação ATUAL (não a da rodada do jogo) e
 *  `getLineups`/`getInjuriesByFixture` raramente têm dados pra jogos antigos
 *  (lineup vira `undefined`, absences degrada a `absences_available=false` — mesmo
 *  caminho gracioso do predict). `getTeamForm`/`getH2H` trazem os últimos jogos da
 *  temporada corrente. Consequência: o input de um jogo finished é uma APROXIMAÇÃO
 *  (leak de informação pós-jogo em standings; form/lineup possivelmente desalinhados
 *  do estado pré-jogo). Isto NÃO é mascarado — é uma limitação estrutural do backtest
 *  sobre dados ao vivo; jogos sem standings das duas equipes são PULADOS (o
 *  `BuildInputError` do cartucho), não inventados. Pra um backtest rigoroso seria
 *  preciso snapshotar supportingData na data do jogo (fora do escopo do #173).
 *
 * Run: pnpm tsx scripts/backtest-cartridge.ts --marketKey=match_result [--limit=20]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import type Anthropic from "@anthropic-ai/sdk";

import { eq } from "drizzle-orm";

import { matches, markets } from "@/db/schema";
import { db } from "@/lib/db";
import { getAnthropicClient } from "@/lib/ai/anthropic";
import { calculateCost } from "@/lib/ai/cost";
import { getCartridge } from "@/lib/ai/markets/registry";
import type { BaseMarketOutput } from "@/lib/ai/markets/types";
import { MODEL_REGISTRY, isAIModelId, type AIModel } from "@/lib/ai/models";
import { buildAnthropicRequest } from "@/lib/ai/request-builder";
import { getDefaultModelId, getGenerationParams } from "@/lib/db/queries/ai-config";
import { getLatestSelectionOddsSnapshots } from "@/lib/db/queries/odds-snapshots";
import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import {
  SportsDataTransientError,
  SportsDataUnsupportedError,
  type FixtureRef,
  type NormalizedInjury,
} from "@/lib/providers/sports-data/types";

// ─── Constantes (espelham predict.ts) ────────────────────────────────────────
const FORM_LAST = 5;
const H2H_LAST = 5;
// Re-tentativa única (igual ao replay-prompt-eval): cobre TANTO tool_missing
// (caminho adaptive/auto, raro) QUANTO Zod-inválido. Toda tentativa é paga; o
// usage das falhas é somado ao custo total reportado.
const MAX_ATTEMPTS_PER_GAME = 2;
// Mandato do AC#3: backtest com ≥20 jogos. Default do --limit e piso do WARN.
const MIN_GAMES = 20;
// Decis de calibração (10 buckets de 10pp sobre a prob do modelo da seleção rec).
const CALIBRATION_BUCKETS = 10;

// "Constante trivial" por mercado (o baseline burro contra o qual o LLM precisa
// se justificar): a seleção mais comum/empate. over_under não tem empate, então
// usamos 'over' (a face padrão do mercado); 1X2 usa 'draw' (o "always draw"
// clássico de baseline de futebol).
const TRIVIAL_CONSTANT_BY_MARKET: Record<string, string> = {
  over_under: "over",
  match_result: "draw",
};

type CliArgs = { marketKey: string; limit: number };

function parseArgs(): CliArgs {
  let marketKey: string | undefined;
  let limit = MIN_GAMES;
  for (const raw of process.argv.slice(2)) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "marketKey" && value) marketKey = value;
    if (key === "limit" && value) {
      const n = Number(value);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--limit deve ser inteiro positivo, recebido: ${value}`);
      }
      limit = n;
    }
  }
  if (!marketKey) {
    throw new Error(
      "usage: pnpm tsx scripts/backtest-cartridge.ts --marketKey=<key> [--limit=20]",
    );
  }
  return { marketKey, limit };
}

function requireEnv(name: string): void {
  if (!process.env[name]) {
    throw new Error(`${name} not set — populate .env.local from .env.example`);
  }
}

function pad(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n);
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fmtUnits(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}u`;
}

// ─── Resultado conhecido (INLINE de homeScore/awayScore; NÃO usa settlement) ──
// Qual seleção do mercado GANHOU, dado o placar final. Espelha a regra de
// settlement de cada mercado mas computada aqui de forma autossuficiente — o
// backtest não pode depender do registry de settlement (escopo do AC#4).
function winningSelectionForMarket(
  marketKey: string,
  homeScore: number,
  awayScore: number,
): string {
  if (marketKey === "match_result") {
    if (homeScore > awayScore) return "home";
    if (homeScore < awayScore) return "away";
    return "draw";
  }
  if (marketKey === "over_under") {
    // Linha 2.5 — total > 2.5 ⇒ over; senão under. (over/under não é o foco do
    // #173, mas o backtest é genérico; a linha vem do descriptor do cartucho.)
    return homeScore + awayScore > 2.5 ? "over" : "under";
  }
  throw new Error(
    `winningSelectionForMarket: mercado '${marketKey}' sem regra inline de resultado conhecido`,
  );
}

// Yield realizado por unidade de stake fixo (1u): ganhou = odd−1, perdeu = −1,
// pass = 0 (fora do yield). `odd` é a odd CAPTURADA da seleção recomendada.
function realizedYield(
  recommendation: string,
  winningSelection: string,
  oddAtRec: number | null,
): number {
  if (recommendation === "pass") return 0;
  if (recommendation === winningSelection) {
    if (oddAtRec === null) {
      throw new Error(
        `realizedYield: recomendação '${recommendation}' sem odd capturada`,
      );
    }
    return oddAtRec - 1;
  }
  return -1;
}

type GamePoint = {
  label: string;
  recommendation: string;
  winningSelection: string;
  oddAtRec: number | null;
  // prob do modelo da SELEÇÃO RECOMENDADA (0–1) — alimenta a calibração; null em pass.
  modelProbRec: number | null;
  won: boolean; // recommendation acertou a seleção vencedora (false em pass)
  yieldUnits: number;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
};

function accuracy(points: { won: boolean; recommendation: string }[]): {
  decided: number;
  hits: number;
  rate: number;
} {
  const decided = points.filter((p) => p.recommendation !== "pass");
  const hits = decided.filter((p) => p.won).length;
  return {
    decided: decided.length,
    hits,
    rate: decided.length === 0 ? 0 : hits / decided.length,
  };
}

function totalYield(points: { yieldUnits: number }[]): number {
  return points.reduce((acc, p) => acc + p.yieldUnits, 0);
}

async function main(): Promise<void> {
  // Guarda sem-paga DEFENSIVA (espelha replay-prompt-eval): este backtest chama a
  // API PAGA da Anthropic. O glob default do Vitest já exclui scripts/, e o único
  // run-path é `pnpm tsx scripts/backtest-cartridge.ts` (manual do usuário) — mas
  // se algum CI invocar este arquivo, abortamos ANTES de queimar spend.
  if (process.env.CI) {
    throw new Error(
      "backtest-cartridge é manual e PAGO — não deve rodar em CI (process.env.CI setado)",
    );
  }
  requireEnv("DATABASE_URL");
  requireEnv("ANTHROPIC_API_KEY");

  const cli = parseArgs();
  // Resolve o cartucho (throw em market desconhecido) — read puro ANTES de gastar.
  const cartridge = getCartridge(cli.marketKey);
  const dbMarketKey = cartridge.descriptor.dbMarketKey;
  const selectionKeys = cartridge.descriptor.selectionKeys;
  const trivialConstant = TRIVIAL_CONSTANT_BY_MARKET[cli.marketKey];
  if (!trivialConstant) {
    throw new Error(
      `sem 'constante trivial' definida pro mercado '${cli.marketKey}' (adicione em TRIVIAL_CONSTANT_BY_MARKET)`,
    );
  }

  console.log("─── Backtest de cartucho ───");
  console.log(`marketKey   : ${cli.marketKey} (cartucho ${cartridge.version})`);
  console.log(`dbMarketKey : ${dbMarketKey}`);
  console.log(`limit       : ${cli.limit}`);

  // ── 1. Catálogo do mercado: marketId + seleções seedadas ──────────────────
  const marketRow = (
    await db
      .select({ id: markets.id })
      .from(markets)
      .where(eq(markets.key, dbMarketKey))
      .limit(1)
  )[0];
  if (!marketRow) {
    throw new Error(
      `market '${dbMarketKey}' não seedado — rode a migration do cartucho antes do backtest`,
    );
  }

  // ── 2. Jogos finished com placar E com snapshots desse mercado capturadas ──
  //    Lê snapshots existentes (zero gasto Odds API). DISTINCT por match: a join
  //    com snapshots dá N rows/jogo; dedup em memória pelos --limit mais recentes.
  const finishedRows = await db
    .select({
      id: matches.id,
      externalId: matches.externalId,
      league: matches.league,
      homeTeam: matches.homeTeam,
      awayTeam: matches.awayTeam,
      kickoffAt: matches.kickoffAt,
      homeScore: matches.homeScore,
      awayScore: matches.awayScore,
    })
    .from(matches)
    .where(eq(matches.status, "finished"))
    .orderBy(matches.kickoffAt);

  // Filtra em código os que têm placar não-nulo E captura completa pra este
  // mercado (getLatestSelectionOddsSnapshots devolve null sem captura; hard-fail
  // em captura incompleta já é tratado lá). Ordena por kickoff desc e corta nos
  // --limit mais recentes.
  type Eligible = (typeof finishedRows)[number] & {
    homeScore: number;
    awayScore: number;
    snapshot: NonNullable<
      Awaited<ReturnType<typeof getLatestSelectionOddsSnapshots>>
    >;
  };
  const eligible: Eligible[] = [];
  const sorted = [...finishedRows].sort(
    (a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime(),
  );
  for (const row of sorted) {
    if (row.homeScore === null || row.awayScore === null) continue;
    const snapshot = await getLatestSelectionOddsSnapshots({
      matchId: row.id,
      dbMarketKey,
      params: cartridge.descriptor.params,
    });
    if (!snapshot) continue;
    eligible.push({
      ...row,
      homeScore: row.homeScore,
      awayScore: row.awayScore,
      snapshot,
    });
    if (eligible.length >= cli.limit) break;
  }

  if (eligible.length === 0) {
    throw new Error(
      `0 jogos finished com placar E snapshots de '${dbMarketKey}' — capture odds h2h ` +
        `de ≥${MIN_GAMES} jogos finished (caminho #164) ANTES de rodar o backtest (gate #17).`,
    );
  }
  if (eligible.length < MIN_GAMES) {
    console.warn(
      `\n⚠⚠⚠ AVISO: só ${eligible.length} jogos elegíveis (< ${MIN_GAMES} do mandato AC#3). ` +
        `Prosseguindo, mas o resultado NÃO satisfaz o gate de ≥${MIN_GAMES} jogos. ` +
        `Capture mais snapshots e re-rode.\n`,
    );
  }
  console.log(`jogos       : ${eligible.length} elegíveis (finished + snapshots)\n`);

  // ── 3. Modelo + params de geração (mesma cascata barata do predict) ───────
  const resolvedModelId = await getDefaultModelId();
  const model: AIModel = MODEL_REGISTRY[resolvedModelId];
  const genParams = await getGenerationParams();
  console.log(`modelo      : ${model.id} (${model.label})\n`);

  const provider = getSportsDataProvider();
  const client = getAnthropicClient();

  const points: GamePoint[] = [];
  const baselineAlways: { won: boolean; recommendation: string; yieldUnits: number }[] = [];
  const baselineFavorite: { won: boolean; recommendation: string; yieldUnits: number }[] = [];
  const skipped: { label: string; reason: string }[] = [];

  for (const [i, m] of eligible.entries()) {
    const label = `${m.homeTeam} x ${m.awayTeam}`;
    const winningSelection = winningSelectionForMarket(
      cli.marketKey,
      m.homeScore,
      m.awayScore,
    );
    console.log(
      `[${i + 1}/${eligible.length}] ${label} — placar ${m.homeScore}-${m.awayScore} (venceu: ${winningSelection})`,
    );

    // Odds capturadas N-vias → oddByKey (Number na fronteira; numeric=string).
    const oddByKey: Record<string, number> = {};
    for (const sel of m.snapshot.selections) {
      oddByKey[sel.key] = Number(sel.odd);
    }
    const missingOdd = selectionKeys.find((k) => oddByKey[k] === undefined);
    if (missingOdd) {
      const reason = `snapshot sem odd da seleção '${missingOdd}'`;
      console.warn(`  ✗ PULADO: ${reason}`);
      skipped.push({ label, reason });
      continue;
    }

    // Implied normalizado pelo overround do mercado COMPLETO (ADR 0018) — nunca
    // 1/odd cru. Ordem `selectionKeys` (contrato chave→índice). Reusado pelo
    // baseline "favorito" e pelo input do cartucho.
    const candidateOdds = selectionKeys.map((k) => oddByKey[k]);
    const { probs } = computeMarketImpliedProbabilities(candidateOdds);
    const impliedByKey: Record<string, number> = {};
    selectionKeys.forEach((k, idx) => {
      impliedByKey[k] = probs[idx] * 100;
    });

    // ── Baselines (computados ANTES da chamada paga; independem do LLM) ──────
    // "favorito pela odd": menor odd = maior prob implícita. "sempre constante".
    const favoritePick = selectionKeys.reduce((best, k) =>
      oddByKey[k] < oddByKey[best] ? k : best,
    );
    for (const [bl, pick] of [
      [baselineFavorite, favoritePick],
      [baselineAlways, trivialConstant],
    ] as const) {
      const won = pick === winningSelection;
      bl.push({
        recommendation: pick,
        won,
        yieldUnits: realizedYield(pick, winningSelection, oddByKey[pick] ?? null),
      });
    }

    // ── Monta o input do cartucho (supportingData via providers + odds N-vias) ─
    const ref: FixtureRef = {
      league: m.league,
      kickoffAt: m.kickoffAt.toISOString(),
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
    };
    let venue: string | undefined;
    let supporting: Awaited<ReturnType<typeof gatherSupportingData>>;
    try {
      const fixture = await provider.getFixtureByMatch(ref);
      venue = fixture?.venue;
      supporting = await gatherSupportingData(provider, m, ref);
    } catch (err) {
      const reason = `provider error: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(`  ✗ PULADO: ${reason}`);
      skipped.push({ label, reason });
      continue;
    }

    let input: ReturnType<typeof cartridge.buildPredictionInput>;
    try {
      input = cartridge.buildPredictionInput({
        match: {
          externalId: m.externalId,
          league: m.league,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          kickoffAt: m.kickoffAt,
          venue,
        },
        standings: supporting.standings,
        home: {
          form: supporting.homeForm,
          injuries: supporting.injuries.home,
          absencesAvailable: supporting.absencesAvailable,
        },
        away: {
          form: supporting.awayForm,
          injuries: supporting.injuries.away,
          absencesAvailable: supporting.absencesAvailable,
        },
        lineups: supporting.lineups,
        h2h: supporting.h2h,
        odds: {
          bookmaker: m.snapshot.bookmaker,
          captured_at: m.snapshot.capturedAt.toISOString(),
          selections: selectionKeys.map((key) => ({ key, odd: oddByKey[key] })),
        },
        implied: { pct: impliedByKey },
      } as Parameters<typeof cartridge.buildPredictionInput>[0]);
    } catch (err) {
      // BuildInputError (ex.: standings faltando pra um dos times — comum em jogo
      // histórico) ⇒ PULA o jogo, NÃO inventa dado. Documentado no topo do arquivo.
      if (err instanceof cartridge.BuildInputError) {
        const reason = `buildPredictionInput: ${err.message}`;
        console.warn(`  ✗ PULADO: ${reason}`);
        skipped.push({ label, reason });
        continue;
      }
      throw err;
    }

    // ── Chamada SDK-direto (NÃO predict; NÃO persiste) com re-tentativa única ──
    const daysToKickoff = 0; // jogo já aconteceu; campo só informativo no prompt.
    const userMessage = cartridge.buildUserMessage(input, { daysToKickoff });
    const request = buildAnthropicRequest({
      model,
      system: cartridge.systemPrompt,
      userMessage,
      tools: [cartridge.tool],
      toolName: cartridge.toolName,
      maxTokens: genParams.maxTokens,
      effort: genParams.effort,
      temperature: genParams.temperature,
    });

    let output: BaseMarketOutput | null = null;
    let attempts = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let lastFailure = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_GAME; attempt++) {
      attempts = attempt;
      const response = await client.messages.create(request);
      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock =>
          block.type === "tool_use" && block.name === cartridge.toolName,
      );
      if (!toolUse) {
        lastFailure = `model did not call ${cartridge.toolName} (stop_reason=${response.stop_reason})`;
        console.warn(`  ⚠ tentativa ${attempt} falhou: ${lastFailure}`);
        continue;
      }
      const parsed = cartridge.outputSchema.safeParse(toolUse.input);
      if (!parsed.success) {
        lastFailure = `invalid output: ${JSON.stringify(parsed.error.issues).slice(0, 200)}`;
        console.warn(`  ⚠ tentativa ${attempt} falhou: ${lastFailure}`);
        continue;
      }
      output = parsed.data as BaseMarketOutput;
      break;
    }
    if (!output) {
      const reason = `falha dupla na chamada/Zod: ${lastFailure}`;
      console.warn(`  ✗ PULADO: ${reason}`);
      skipped.push({ label, reason });
      continue;
    }

    const recommendation = output.recommendation;
    const oddAtRec = recommendation === "pass" ? null : (oddByKey[recommendation] ?? null);
    const won = recommendation !== "pass" && recommendation === winningSelection;
    const yieldUnits = realizedYield(recommendation, winningSelection, oddAtRec);
    // prob do modelo da seleção recomendada (0–1) pra calibração — derivada PURA
    // do output pelo cartucho (selectionProbs), igual ao predict. null em pass.
    const modelProbByKey = cartridge.selectionProbs(
      output as Parameters<typeof cartridge.selectionProbs>[0],
    );
    const modelProbRec =
      recommendation === "pass"
        ? null
        : modelProbByKey[recommendation] !== undefined
          ? modelProbByKey[recommendation] / 100
          : null;

    points.push({
      label,
      recommendation,
      winningSelection,
      oddAtRec,
      modelProbRec,
      won,
      yieldUnits,
      attempts,
      inputTokens,
      outputTokens,
    });
    console.log(
      `  → ${recommendation}${recommendation === "pass" ? "" : won ? " ✓ ACERTOU" : " ✗ errou"} | yield ${fmtUnits(yieldUnits)}${attempts > 1 ? ` | ${attempts} tentativas` : ""}`,
    );
  }

  if (points.length === 0) {
    console.log(
      "\nNenhum jogo avaliado (todos pulados) — sem amostra pra reportar. " +
        "Verifique a captura de snapshots e a disponibilidade de standings dos providers.",
    );
    return;
  }

  // ── 4. Sumário ─────────────────────────────────────────────────────────────
  const llmAcc = accuracy(points);
  const favAcc = accuracy(baselineFavorite);
  const alwaysAcc = accuracy(baselineAlways);
  const llmYield = totalYield(points);
  const favYield = totalYield(baselineFavorite);
  const alwaysYield = totalYield(baselineAlways);
  const passes = points.filter((p) => p.recommendation === "pass").length;
  const passRate = passes / points.length;
  const totalCost = isAIModelId(model.id)
    ? points.reduce(
        (acc, p) =>
          acc +
          calculateCost({
            model: model.id,
            inputTokens: p.inputTokens,
            outputTokens: p.outputTokens,
          }),
        0,
      )
    : 0;
  const costKnown = isAIModelId(model.id);

  const W = 24;
  console.log("\n─── Sumário ───");
  console.log(
    [pad("estratégia", W), pad("acurácia (acertos/decididos)", 30), "yield (1u/jogo)"].join(" | "),
  );
  console.log("-".repeat(W + 30 + 18));
  console.log(
    [
      pad(`LLM (${model.label})`, W),
      pad(`${fmtPct(llmAcc.rate)} (${llmAcc.hits}/${llmAcc.decided})`, 30),
      fmtUnits(llmYield),
    ].join(" | "),
  );
  console.log(
    [
      pad("baseline: favorito-odd", W),
      pad(`${fmtPct(favAcc.rate)} (${favAcc.hits}/${favAcc.decided})`, 30),
      fmtUnits(favYield),
    ].join(" | "),
  );
  console.log(
    [
      pad(`baseline: sempre '${trivialConstant}'`, W),
      pad(`${fmtPct(alwaysAcc.rate)} (${alwaysAcc.hits}/${alwaysAcc.decided})`, 30),
      fmtUnits(alwaysYield),
    ].join(" | "),
  );

  console.log("\n─── Cobertura ───");
  console.log(`jogos avaliados : ${points.length}`);
  if (skipped.length > 0) {
    console.log(`jogos pulados   : ${skipped.length}`);
  }
  console.log(`pass-rate       : ${fmtPct(passRate)} (${passes}/${points.length})`);
  console.log(
    `custo total     : ${costKnown ? `$${totalCost.toFixed(4)}` : "n/a (modelo fora do registry)"}`,
  );

  // ── 5. Calibração (decis sobre a prob do modelo da seleção recomendada) ────
  // Bucketiza só jogos NÃO-pass (pass não tem seleção/prob). Mostra previsto
  // (média da prob do modelo no bucket) vs real (hit-rate observado).
  console.log("\n─── Calibração (prob do modelo da seleção recomendada) ───");
  const decided = points.filter(
    (p) => p.recommendation !== "pass" && p.modelProbRec !== null,
  );
  if (decided.length === 0) {
    console.log("(sem jogos decididos com prob — nada a calibrar)");
  } else {
    console.log(
      [pad("bucket", 12), pad("n", 5), pad("previsto (méd)", 16), "real (hit-rate)"].join(" | "),
    );
    console.log("-".repeat(12 + 5 + 16 + 17));
    for (let b = 0; b < CALIBRATION_BUCKETS; b++) {
      const lo = b / CALIBRATION_BUCKETS;
      const hi = (b + 1) / CALIBRATION_BUCKETS;
      // último bucket inclui 1.0; os demais são [lo, hi).
      const inBucket = decided.filter((p) => {
        const v = p.modelProbRec as number;
        return b === CALIBRATION_BUCKETS - 1 ? v >= lo && v <= hi : v >= lo && v < hi;
      });
      if (inBucket.length === 0) continue;
      const predicted =
        inBucket.reduce((acc, p) => acc + (p.modelProbRec as number), 0) /
        inBucket.length;
      const actual = inBucket.filter((p) => p.won).length / inBucket.length;
      console.log(
        [
          pad(`${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%`, 12),
          pad(String(inBucket.length), 5),
          pad(fmtPct(predicted), 16),
          fmtPct(actual),
        ].join(" | "),
      );
    }
  }

  // ── 6. Veredito legível ────────────────────────────────────────────────────
  const beatsFavorite = llmYield > favYield;
  const beatsAlways = llmYield > alwaysYield;
  console.log("\n─── Veredito ───");
  console.log(
    beatsFavorite && beatsAlways
      ? `LLM bate AMBOS os baselines em yield (${fmtUnits(llmYield)} vs favorito ${fmtUnits(favYield)}, sempre-'${trivialConstant}' ${fmtUnits(alwaysYield)}). Justifica o custo NESTA amostra.`
      : `LLM NÃO bate todos os baselines em yield (LLM ${fmtUnits(llmYield)} vs favorito ${fmtUnits(favYield)}, sempre-'${trivialConstant}' ${fmtUnits(alwaysYield)}). Re-avaliar antes de graduar o mercado.`,
  );
  if (eligible.length < MIN_GAMES) {
    console.log(
      `⚠ Amostra abaixo do mandato (${points.length} avaliados < ${MIN_GAMES}). Resultado é indicativo, NÃO o gate AC#3.`,
    );
  }

  if (skipped.length > 0) {
    console.log("\n─── Jogos pulados ───");
    for (const s of skipped) {
      console.log(`  ${pad(s.label, 34)} | ${s.reason}`);
    }
  }
}

// Coleta o supportingData (mesmo conjunto que predict.ts) — form/h2h/standings/
// absences/lineups via os providers de sports-data. Injuries degrada gracioso
// (igual predict): provider sem suporte OU transient ⇒ absences_available=false.
type MatchLeague = (typeof matches.$inferSelect)["league"];

async function gatherSupportingData(
  provider: ReturnType<typeof getSportsDataProvider>,
  m: { homeTeam: string; awayTeam: string; league: MatchLeague },
  ref: FixtureRef,
) {
  const [homeForm, awayForm, h2h, standings, injuries, lineups] =
    await Promise.all([
      provider.getTeamForm(m.homeTeam, m.league, FORM_LAST),
      provider.getTeamForm(m.awayTeam, m.league, FORM_LAST),
      provider.getH2H(m.homeTeam, m.awayTeam, m.league, H2H_LAST),
      provider.getStandings(m.league),
      provider
        .getInjuriesByFixture(ref)
        .then((data) => ({ data, unavailable: false }))
        .catch((err: unknown) => {
          if (
            err instanceof SportsDataUnsupportedError ||
            err instanceof SportsDataTransientError
          ) {
            return {
              data: {
                home: [] as NormalizedInjury[],
                away: [] as NormalizedInjury[],
              },
              unavailable: true,
            };
          }
          throw err;
        }),
      provider.getLineups(ref),
    ]);
  return {
    homeForm,
    awayForm,
    h2h,
    standings,
    injuries: injuries.data,
    absencesAvailable: !injuries.unavailable,
    lineups,
  };
}

main().catch((err) => {
  console.error("Backtest failed:");
  console.error(err);
  process.exit(1);
});
