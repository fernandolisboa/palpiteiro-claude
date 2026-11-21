"use server";

import { z } from "zod";

import { auth } from "@/auth";
import { ANALYSES_UNAVAILABLE_MESSAGE } from "@/lib/ai/best-bet";
import { actionDeadline } from "@/lib/ai/deadline";
import { palpitesLimitMessage } from "@/lib/ai/palpites-limit";
import { UNDERDOG_ADVOCATE_VERSION } from "@/lib/ai/underdog/advocate-cartridge";
import { templatedNarrative } from "@/lib/ai/underdog/fallback";
import { generateUnderdogCase } from "@/lib/ai/underdog/generate";
import { UNDERDOG_REVIEW_VERSION } from "@/lib/ai/underdog/review-cartridge";
import { isEmailAllowed } from "@/lib/auth/whitelist";
import { getEnableUnderdogView } from "@/lib/db/queries/ai-config";
import { getLatestMatchModelSnapshotWithKickoff } from "@/lib/db/queries/match-model-snapshots";
import { getMatchById } from "@/lib/db/queries/matches";
import { getPalpiteSetsForMatch } from "@/lib/db/queries/palpites";
import {
  findUnderdogViewForSnapshot,
  getLatestUnderdogView,
  insertUnderdogView,
  replaceUnderdogView,
} from "@/lib/db/queries/underdog-views";
import { getUserAccessState } from "@/lib/db/queries/users";
import { formatKickoffAbsolute, LEAGUE_LABEL, leagueToKey } from "@/lib/format";
import { MATCH_MODEL_VERSION } from "@/lib/model-base/version";
import { checkPalpitesRateLimit } from "@/lib/rate-limit";
import { getRequestTimeZone } from "@/lib/server/request-timezone";
import {
  computeUnderdogFacts,
  underdogBaseFromSnapshot,
  type UnderdogBase,
} from "@/lib/underdog/compute";
import { UNDERDOG_CALC_VERSION } from "@/lib/underdog/constants";
import { buildFactsBlock, underdogNames } from "@/lib/underdog/facts";
import { fetchUnderdogSignals } from "@/lib/underdog/fetch-signals";
import { isMaterialSame, underdogTeaserBlock } from "@/lib/underdog/gate";
import type { UnderdogFacts } from "@/lib/underdog/types";
import { toPalpiteHeadlineViewFromSet } from "@/lib/view/palpites-headline";
import { displayMatchTeams } from "@/lib/view/team";
import {
  toUnderdogPanelView,
  type UnderdogPanelView,
} from "@/lib/view/underdog";

// "Chances do azarão" (#671, ADR 0073). O cliente manda SÓ o matchId: base, números e
// sinais saem do servidor. Todos os portões grátis antes da cobrança (1 unidade do
// limite de palpites), inclusive o cálculo dos números; a row guardada que ainda vale
// (materialidade) volta sem cobrar. Depois da cobrança o pedido nunca falha: falha da
// IA vira o texto padrão, e uma exceção inesperada também (sem gravar). Antes dela, uma
// exceção de banco/KV vira recusa grátis inline (nunca a página de erro).

export type OpenUnderdogResult =
  | { ok: true; view: UnderdogPanelView; charged: boolean }
  | {
      ok: false;
      error: string;
      kind?:
        | "invalido"
        | "desligado"
        | "nao-encontrado"
        | "fechado"
        | "sem-azarao"
        | "sem-palpite"
        | "coerencia"
        | "limite";
    };

type Refusal = Extract<OpenUnderdogResult, { ok: false }>;
const refuse = (error: string, kind?: Refusal["kind"]): Refusal =>
  kind ? { ok: false, error, kind } : { ok: false, error };

const NO_UNDERDOG =
  "O modelo não vê azarão claro neste jogo agora. Volte mais perto do apito.";
const NO_PALPITE = "As chances do azarão aparecem depois do palpite da IA.";
// Porta de coerência: o palpite da IA na tela agora dá a vitória ao próprio azarão.
const underdogCoherenceMessage = (underdog: string) =>
  `O palpite da IA agora dá a vitória a ${underdog}, então não há zebra pra defender neste jogo.`;

type Teams = { home: string; away: string };
type Match = NonNullable<Awaited<ReturnType<typeof getMatchById>>>;

// O que passou por todos os portões grátis (e pela cobrança).
type Charged = {
  kind: "charged";
  userId: string;
  isAdmin: boolean;
  match: Match;
  base: UnderdogBase;
  teams: Teams;
  leagueKey: ReturnType<typeof leagueToKey>;
  codeFacts: UnderdogFacts;
  // Já existe row nesta base (velha ou inválida): troca em vez de insert.
  replace: boolean;
  now: Date;
};

const log = (matchId: string, error: string, err: unknown) =>
  console.error(
    JSON.stringify({
      scope: "underdog",
      matchId,
      error,
      message: err instanceof Error ? err.message : String(err),
    })
  );

/**
 * Todos os portões grátis e, por último, a cobrança. Lança só por falha de banco/KV; o
 * chamador transforma isso em recusa grátis.
 */
async function gateAndCharge(
  matchId: string
): Promise<Refusal | { kind: "stored"; result: OpenUnderdogResult } | Charged> {
  const session = await auth();
  if (!session?.user?.id)
    return refuse("Faça login para ver as chances do azarão.");
  const userId = session.user.id;
  const access = await getUserAccessState(userId);
  if (!access) return refuse("Sua sessão expirou. Faça login novamente.");
  if (!access.allowed && !isEmailAllowed(session.user.email)) {
    return refuse("Seu acesso está bloqueado. Fale com o administrador.");
  }
  if (!(await getEnableUnderdogView())) {
    return refuse(
      "As chances do azarão estão desligadas no momento.",
      "desligado"
    );
  }

  const match = await getMatchById(matchId);
  if (!match) return refuse("Jogo não encontrado.", "nao-encontrado");
  const now = new Date();
  // O mesmo predicado de predict e do explain: pré-jogo = scheduled e apito no futuro.
  if (
    match.status !== "scheduled" ||
    match.kickoffAt.getTime() <= now.getTime()
  ) {
    return refuse("As chances do azarão são só antes do jogo.", "fechado");
  }

  const found = await getLatestMatchModelSnapshotWithKickoff(matchId);
  const base = found
    ? underdogBaseFromSnapshot(found.snapshot, found.kickoffAt, now)
    : null;
  if (!base) return refuse(NO_UNDERDOG, "sem-azarao");

  const leagueKey = leagueToKey(match.league);
  const teams = displayMatchTeams(match.homeTeam, match.awayTeam, leagueKey);
  const stored = (record: Parameters<typeof toUnderdogPanelView>[0]) => ({
    kind: "stored" as const,
    result: {
      ok: true as const,
      view: toUnderdogPanelView(record, teams, "current"),
      charged: false,
    },
  });

  // Texto pago que ainda vale pra base atual: volta sem cobrar.
  const latest = await getLatestUnderdogView(userId, matchId);
  if (latest && isMaterialSame(latest.facts, base.pick)) return stored(latest);
  // A row desta MESMA base: se vale, volta sem cobrar; se existe e não vale (versão do
  // cálculo mudou, ou falhou no Zod), o texto novo a substitui (nunca um insert que bate
  // no UNIQUE e devolve a velha depois de cobrar).
  const sameBase = await findUnderdogViewForSnapshot(userId, base.snapshot.id);
  if (sameBase?.record && isMaterialSame(sameBase.record.facts, base.pick)) {
    return stored(sameBase.record);
  }

  // A mesma porta da página (coerência com o palpite na tela; sem run aqui).
  const latestSet = (await getPalpiteSetsForMatch(matchId, userId))[0];
  const heroPalpite = latestSet
    ? toPalpiteHeadlineViewFromSet(latestSet)
    : null;
  const block = underdogTeaserBlock({
    flag: true,
    preMatch: true,
    heroPalpite,
    runInFlight: false,
    pick: base.pick,
  });
  if (block === "no_palpite") return refuse(NO_PALPITE, "sem-palpite");
  if (block === "coherence") {
    return refuse(
      underdogCoherenceMessage(underdogNames(base.pick, teams).underdog),
      "coerencia"
    );
  }
  if (block !== null) return refuse(NO_UNDERDOG, "sem-azarao");

  // Os números são código puro: falha aqui é recusa grátis, antes da cobrança.
  let codeFacts: UnderdogFacts;
  try {
    codeFacts = computeUnderdogFacts(base);
  } catch (err) {
    log(matchId, "facts_failed", err);
    return refuse(ANALYSES_UNAVAILABLE_MESSAGE);
  }

  const isAdmin = session.user.role === "admin";
  const rl = await checkPalpitesRateLimit(userId, { failClosed: !isAdmin });
  if (rl.reason === "fail-closed") return refuse(ANALYSES_UNAVAILABLE_MESSAGE);
  if (!rl.ok) return refuse(palpitesLimitMessage(rl.limit), "limite");

  return {
    kind: "charged",
    userId,
    isAdmin,
    match,
    base,
    teams,
    leagueKey,
    codeFacts,
    replace: sameBase !== null,
    now,
  };
}

export async function openUnderdogView(
  _prev: OpenUnderdogResult | null,
  formData: FormData
): Promise<OpenUnderdogResult> {
  const deadlineAt = actionDeadline();
  const parsedId = z.uuid().safeParse(formData.get("matchId"));
  if (!parsedId.success) return refuse("Pedido inválido.", "invalido");
  const matchId = parsedId.data;

  let gate: Awaited<ReturnType<typeof gateAndCharge>>;
  try {
    gate = await gateAndCharge(matchId);
  } catch (err) {
    log(matchId, "precharge_failed", err);
    return refuse(ANALYSES_UNAVAILABLE_MESSAGE);
  }
  if ("ok" in gate) return gate;
  if (gate.kind === "stored") return gate.result;
  const { userId, isAdmin, match, base, teams, leagueKey, now } = gate;

  // ─── Depois da cobrança: nada daqui pra baixo falha ───
  let facts = gate.codeFacts;
  try {
    const signals = await fetchUnderdogSignals({ match, side: base.pick.side });
    facts = computeUnderdogFacts(base, signals);
    const timeZone = await getRequestTimeZone().catch(() => undefined);
    const block = buildFactsBlock(facts, {
      teams,
      competition: LEAGUE_LABEL[leagueKey],
      kickoffLabel: formatKickoffAbsolute(match.kickoffAt, now, timeZone),
    });
    const generated = await generateUnderdogCase({
      facts,
      block,
      teams,
      userId,
      matchId,
      isAdmin,
      deadlineAt,
    });
    const current = {
      facts,
      narrative: generated.narrative,
      narrativeSource: generated.source,
    };
    if (generated.persist) {
      try {
        const row = {
          userId,
          matchId,
          modelSnapshotId: base.snapshot.id,
          underdogSide: facts.side,
          facts,
          narrative: generated.narrative,
          narrativeSource: generated.source,
          versions: {
            calc: UNDERDOG_CALC_VERSION,
            advocate: UNDERDOG_ADVOCATE_VERSION,
            review: UNDERDOG_REVIEW_VERSION,
            matchModel: MATCH_MODEL_VERSION,
          },
          advocateAiCallId: generated.advocateAiCallId,
          reviewerAiCallId: generated.reviewerAiCallId,
        };
        // Row velha/inválida desta base: troca. Senão insert; na corrida com outra aba,
        // a row que ficou é a que vale (o texto bate ao reabrir).
        const saved = gate.replace
          ? await replaceUnderdogView(row)
          : await insertUnderdogView(row);
        if (saved) {
          return {
            ok: true,
            view: toUnderdogPanelView(saved, teams, "current"),
            charged: true,
          };
        }
      } catch (err) {
        log(matchId, "insert_failed", err);
      }
    }
    return {
      ok: true,
      view: toUnderdogPanelView(current, teams, "current"),
      charged: true,
    };
  } catch (err) {
    log(matchId, "unexpected", err);
    return {
      ok: true,
      view: toUnderdogPanelView(
        {
          facts,
          narrative: templatedNarrative(facts, teams),
          narrativeSource: "template",
        },
        teams,
        "current"
      ),
      charged: true,
    };
  }
}
