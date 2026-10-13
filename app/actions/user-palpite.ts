"use server";

import { z } from "zod";

import { notAnalyzableMessage } from "./not-analyzable";
import { auth } from "@/auth";
import { ANALYSES_UNAVAILABLE_MESSAGE } from "@/lib/ai/best-bet";
import { actionDeadline } from "@/lib/ai/deadline";
import { JUDGMENTS_VERSION } from "@/lib/ai/judgments/questions";
import { JUDGMENT_WEIGHTS_VERSION } from "@/lib/ai/judgments/apply";
import { USER_PALPITE_EXTRACT_VERSION } from "@/lib/ai/user-palpite/extract-cartridge";
import { extractPalpiteClaims } from "@/lib/ai/user-palpite/extract";
import {
  USER_PALPITE_NARRATE_VERSION,
  toNarrationClaims,
  type NarrationInput,
} from "@/lib/ai/user-palpite/narrate-cartridge";
import { templatedPalpiteNarration } from "@/lib/ai/user-palpite/fallback";
import { narratePalpite } from "@/lib/ai/user-palpite/narrate";
import { isEmailAllowed } from "@/lib/auth/whitelist";
import { getEnableUserContext } from "@/lib/db/queries/ai-config";
import { getMatchById } from "@/lib/db/queries/matches";
import {
  insertUserPalpiteAnalysis,
  type UserPalpiteAnalysisRecord,
} from "@/lib/db/queries/user-palpite-analyses";
import { getUserAccessState } from "@/lib/db/queries/users";
import { formatKickoffAbsolute, LEAGUE_LABEL, leagueToKey } from "@/lib/format";
import { checkPalpitesRateLimit } from "@/lib/rate-limit";
import { getRequestTimeZone } from "@/lib/server/request-timezone";
import {
  checkClaims,
  factsNeeded,
  summarizeFacts,
  type PalpiteFacts,
} from "@/lib/user-palpite/check-claims";
import {
  computeReadings,
  evidenceFromClaims,
  USER_EVIDENCE_VERSION,
} from "@/lib/user-palpite/evidence";
import { fetchPalpiteFacts } from "@/lib/user-palpite/facts";
import { modelLabel } from "@/lib/user-palpite/labels";
import {
  resolvePalpiteModelBase,
  type PalpiteModelBase,
} from "@/lib/user-palpite/model-base";
import {
  codeVerdict,
  palpiteLabel,
  PALPITE_VERDICT_VERSION,
} from "@/lib/user-palpite/reading";
import {
  AnalyzeUserPalpiteInputSchema,
  MAX_REASON_CHARS,
  MIN_REASON_CHARS,
  normalizeReasonText,
  UserPalpiteSchema,
  type CheckedClaim,
  type Claim,
  type NarrationSource,
  type PalpiteNarration,
  type StoredPalpiteModel,
  type UserPalpite,
} from "@/lib/user-palpite/types";
import {
  toUserPalpiteAnalysisView,
  type UserPalpiteAnalysisView,
} from "@/lib/view/user-palpite";

// "Analisar meu palpite" (#564, ADR 0055). Todos os gates grátis (input, sessão,
// acesso, flag, jogo, analisável, TEM MODELO) vêm antes da cobrança, como em
// generatePalpiteFromAnalyses; depois da cobrança o request nunca falha: extração que
// falha vira leitura sem o texto, narração que falha vira template, insert que falha
// devolve a análise com aviso, e qualquer exceção inesperada cai na leitura sem o texto
// (a base já está em mãos) ou, no limite, numa mensagem amigável. Sem revalidatePath: o cliente mostra o retorno e um
// reload lê a última gravada.

export type AnalyzeUserPalpiteResult =
  | { ok: true; analysis: UserPalpiteAnalysisView }
  | {
      ok: false;
      error: string;
      kind?: "invalido" | "desligado" | "nao-analisavel" | "sem-modelo" | "limite";
    };

const EXTRACTION_FAILED_WARNING =
  "Não consegui ler o seu motivo agora; a leitura abaixo não considera o texto.";
const INSERT_FAILED_WARNING = "Não consegui salvar esta análise; ela some ao recarregar.";
const PIPELINE_FAILED_WARNING =
  "Não consegui analisar o seu motivo agora; a leitura abaixo não considera o texto.";
const PIPELINE_FAILED_MESSAGE =
  "Não consegui analisar o seu palpite agora. A leitura pelos botões continua valendo.";

function parseInput(formData: FormData) {
  const rawPalpite = formData.get("palpite");
  let palpite: unknown = null;
  if (typeof rawPalpite === "string" && rawPalpite.trim() !== "") {
    try {
      palpite = JSON.parse(rawPalpite);
    } catch {
      palpite = undefined;
    }
  }
  return AnalyzeUserPalpiteInputSchema.safeParse({
    matchId: formData.get("matchId") ?? "",
    palpite,
    reason: formData.get("reason") ?? "",
  });
}

function invalidMessage(formData: FormData): string {
  if (!z.uuid().safeParse(formData.get("matchId")).success) {
    return "Identificador de jogo inválido.";
  }
  const reason = formData.get("reason");
  const rawPalpite = formData.get("palpite");
  if (typeof rawPalpite !== "string" || rawPalpite.trim() === "") {
    return "Escolha um placar ou um resultado antes de analisar.";
  }
  let palpite: unknown;
  try {
    palpite = JSON.parse(rawPalpite);
  } catch {
    return "Palpite inválido.";
  }
  if (!UserPalpiteSchema.safeParse(palpite).success) return "Palpite inválido.";
  if (typeof reason !== "string" || reason.trim().length < MIN_REASON_CHARS) {
    return "Escreva o motivo do seu palpite. A leitura pelos botões é grátis e não precisa dele.";
  }
  if (String(normalizeReasonText(reason)).trim().length > MAX_REASON_CHARS) {
    return `O motivo passou de ${MAX_REASON_CHARS} caracteres.`;
  }
  return "Pedido inválido.";
}

export async function analyzeUserPalpite(
  _prev: AnalyzeUserPalpiteResult | null,
  formData: FormData,
): Promise<AnalyzeUserPalpiteResult> {
  const deadlineAt = actionDeadline();
  const parsed = parseInput(formData);
  if (!parsed.success) {
    return { ok: false, error: invalidMessage(formData), kind: "invalido" };
  }
  const { matchId, palpite, reason } = parsed.data;

  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Faça login para analisar." };
  const userId = session.user.id;
  const access = await getUserAccessState(userId);
  if (!access) return { ok: false, error: "Sua sessão expirou. Faça login novamente." };
  if (!access.allowed && !isEmailAllowed(session.user.email)) {
    return { ok: false, error: "Seu acesso está bloqueado. Fale com o administrador." };
  }
  if (!(await getEnableUserContext())) {
    return {
      ok: false,
      error:
        "A análise do motivo está desligada no momento. A leitura pelos botões continua valendo.",
      kind: "desligado",
    };
  }
  const match = await getMatchById(matchId);
  if (!match) return { ok: false, error: "Jogo não encontrado." };
  const notAnalyzable = notAnalyzableMessage(match.status, match.kickoffAt);
  if (notAnalyzable) return { ok: false, error: notAnalyzable, kind: "nao-analisavel" };

  const now = new Date();
  const base = await resolvePalpiteModelBase(match, { now });
  if (!base) {
    return { ok: false, error: "Ainda não temos o modelo deste jogo.", kind: "sem-modelo" };
  }

  const isAdmin = session.user.role === "admin";
  const rl = await checkPalpitesRateLimit(userId, { failClosed: !isAdmin });
  if (rl.reason === "fail-closed") {
    return { ok: false, error: ANALYSES_UNAVAILABLE_MESSAGE };
  }
  if (!rl.ok) {
    return {
      ok: false,
      error: `Você atingiu o limite de ${rl.limit} palpites por dia. Tente novamente amanhã.`,
      kind: "limite",
    };
  }

  // ─── Depois da cobrança: nada daqui pra baixo lança ───
  const ctx: ChargedContext = {
    match,
    base,
    palpite,
    reason,
    userId,
    isAdmin,
    now,
    deadlineAt,
  };
  try {
    return await analyzeAfterCharge(ctx);
  } catch (err) {
    logPostChargeError("pipeline_failed", matchId, err);
  }
  // A unidade já foi cobrada: com a base em mãos, ainda dá a leitura sem o texto.
  try {
    return degradedAnalysis(ctx);
  } catch (err) {
    logPostChargeError("degraded_failed", matchId, err);
    return { ok: false, error: PIPELINE_FAILED_MESSAGE };
  }
}

type ChargedContext = {
  match: NonNullable<Awaited<ReturnType<typeof getMatchById>>>;
  base: PalpiteModelBase;
  palpite: UserPalpite;
  reason: string;
  userId: string;
  isAdmin: boolean;
  now: Date;
  deadlineAt: number | undefined;
};

function logPostChargeError(error: string, matchId: string, err: unknown): void {
  console.error(
    JSON.stringify({
      scope: "analyzeUserPalpite",
      error,
      matchId,
      message: err instanceof Error ? err.message : String(err),
    }),
  );
}

/** Leitura "sem o seu contexto" e narração em template, sem chamada nem insert. */
function degradedAnalysis(ctx: ChargedContext): AnalyzeUserPalpiteResult {
  const { match, base, palpite, now } = ctx;
  const teams = { home: match.homeTeam, away: match.awayTeam };
  const readings = computeReadings(base, {}, palpite);
  const verdict = codeVerdict(readings.with, palpite, []);
  const jevApplied = base.jevAnswers !== null;
  const label = modelLabel({ ...base, jevApplied });
  const narration = templatedPalpiteNarration({
    teams,
    competition: LEAGUE_LABEL[leagueToKey(match.league)],
    kickoffLabel: formatKickoffAbsolute(match.kickoffAt, now),
    palpite,
    palpiteLabel: palpiteLabel(palpite, teams),
    modelLabel: label,
    jevApplied,
    without: readings.without,
    with: readings.with,
    codeVerdict: verdict,
    claims: [],
    facts: [],
  });
  const record: UserPalpiteAnalysisRecord = {
    id: crypto.randomUUID(),
    createdAt: new Date(),
    palpite,
    palpiteSource: "buttons",
    claims: [],
    model: storedModel(base, readings, {}, label),
    reading: { without: readings.without, with: readings.with },
    narration: {
      ...narration,
      codeVerdict: verdict,
      warnings: [PIPELINE_FAILED_WARNING, INSERT_FAILED_WARNING],
    },
    narrationSource: "template",
  };
  return { ok: true, analysis: toUserPalpiteAnalysisView(record, teams, new Date()) };
}

function storedModel(
  base: PalpiteModelBase,
  readings: ReturnType<typeof computeReadings>,
  ev: StoredPalpiteModel["userEvidence"],
  label: string,
): StoredPalpiteModel {
  return {
    origin: base.origin,
    snapshotId: base.snapshotId,
    source: base.source,
    degraded: base.degraded,
    staleBase: base.staleBase,
    rho: base.rho,
    lambdaBase: { home: base.lambdaHomeBase, away: base.lambdaAwayBase },
    lambdaWithout: {
      home: readings.lambdaWithout.lambdaHome,
      away: readings.lambdaWithout.lambdaAway,
    },
    lambdaWith: {
      home: readings.lambdaWith.lambdaHome,
      away: readings.lambdaWith.lambdaAway,
    },
    jevApplied: base.jevAnswers !== null,
    jevAnswers: base.jevAnswers,
    userEvidence: ev,
    combinedAnswers: readings.combined,
    multipliersWith: readings.lambdaWith.multipliers,
    modelLabel: label,
    versions: {
      matchModel: base.modelVersion,
      judgments: JUDGMENTS_VERSION,
      weights: JUDGMENT_WEIGHTS_VERSION,
      snapshotWeights: base.snapshotWeightsVersion,
      userEvidence: USER_EVIDENCE_VERSION,
      verdict: PALPITE_VERDICT_VERSION,
      extract: USER_PALPITE_EXTRACT_VERSION,
      narrate: USER_PALPITE_NARRATE_VERSION,
    },
  };
}

async function analyzeAfterCharge(ctx: ChargedContext): Promise<AnalyzeUserPalpiteResult> {
  const { match, base, palpite, reason, userId, isAdmin, now, deadlineAt } = ctx;
  const matchId = match.id;
  const teams = { home: match.homeTeam, away: match.awayTeam };
  const warnings: string[] = [];
  const extraction = await extractPalpiteClaims({
    reason,
    teams,
    matchId,
    userId,
    deadlineAt,
  });
  const claims: Claim[] = extraction.ok ? extraction.claims : [];
  if (extraction.ok) warnings.push(...extraction.warnings);
  else warnings.push(EXTRACTION_FAILED_WARNING);

  // Fatos por tópico, só depois da extração: zero afirmações → zero chamadas.
  const needs = factsNeeded(claims);
  const facts: PalpiteFacts =
    needs.absences || needs.form || needs.standings
      ? await fetchPalpiteFacts(match, needs)
      : {};
  const factInput = { facts, teams, league: match.league, kickoffAt: match.kickoffAt };
  const checked: CheckedClaim[] = checkClaims({ claims, ...factInput });
  const jevApplied = base.jevAnswers !== null;
  const ev = evidenceFromClaims(checked, { jevApplied });
  const readings = computeReadings(base, ev, palpite);
  const verdict = codeVerdict(readings.with, palpite, checked);
  const label = modelLabel({ ...base, jevApplied });

  const timeZone = await getRequestTimeZone().catch(() => undefined);
  const narrationInput: NarrationInput = {
    teams,
    competition: LEAGUE_LABEL[leagueToKey(match.league)],
    kickoffLabel: formatKickoffAbsolute(match.kickoffAt, now, timeZone),
    palpite,
    palpiteLabel: palpiteLabel(palpite, teams),
    modelLabel: label,
    jevApplied,
    without: readings.without,
    with: readings.with,
    codeVerdict: verdict,
    claims: toNarrationClaims(checked, base.jevAnswers, teams),
    facts: summarizeFacts(factInput),
  };

  // Extração falhou: não há o que comentar, então nada de 2ª chamada paga.
  let narration: PalpiteNarration;
  let narrationSource: NarrationSource;
  let narrationAiCallId: string | null = null;
  if (extraction.ok) {
    const narrated = await narratePalpite({
      input: narrationInput,
      userId,
      matchId,
      isAdmin,
      deadlineAt,
    });
    narration = narrated.narration;
    narrationSource = narrated.source;
    narrationAiCallId = narrated.aiCallId;
  } else {
    narration = templatedPalpiteNarration(narrationInput);
    narrationSource = "template";
  }

  const model = storedModel(base, readings, ev, label);
  const reading = { without: readings.without, with: readings.with };
  const createdAt = new Date();

  let id: string = crypto.randomUUID();
  const storedWarnings = [...warnings];
  try {
    id = await insertUserPalpiteAnalysis({
      userId,
      matchId,
      palpite,
      palpiteSource: "buttons",
      reasonText: reason,
      claims: checked,
      model,
      reading,
      narration: { ...narration, codeVerdict: verdict, warnings: storedWarnings },
      narrationSource,
      extractionAiCallId: extraction.aiCallId,
      narrationAiCallId,
      createdAt,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "analyzeUserPalpite",
        error: "insert_failed",
        matchId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    warnings.push(INSERT_FAILED_WARNING);
  }

  const record: UserPalpiteAnalysisRecord = {
    id,
    createdAt,
    palpite,
    palpiteSource: "buttons",
    claims: checked,
    model,
    reading,
    narration: { ...narration, codeVerdict: verdict, warnings },
    narrationSource,
  };
  return { ok: true, analysis: toUserPalpiteAnalysisView(record, teams, new Date()) };
}
