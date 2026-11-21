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
  getLatestUnderdogView,
  insertUnderdogView,
} from "@/lib/db/queries/underdog-views";
import { getUserAccessState } from "@/lib/db/queries/users";
import { formatKickoffAbsolute, LEAGUE_LABEL, leagueToKey } from "@/lib/format";
import { MATCH_MODEL_VERSION } from "@/lib/model-base/version";
import { checkPalpitesRateLimit } from "@/lib/rate-limit";
import { getRequestTimeZone } from "@/lib/server/request-timezone";
import {
  computeUnderdogFacts,
  underdogBaseFromSnapshot,
} from "@/lib/underdog/compute";
import { UNDERDOG_CALC_VERSION } from "@/lib/underdog/constants";
import { buildFactsBlock } from "@/lib/underdog/facts";
import { fetchUnderdogSignals } from "@/lib/underdog/fetch-signals";
import { isMaterialSame, underdogTeaserVisible } from "@/lib/underdog/gate";
import type { UnderdogFacts } from "@/lib/underdog/types";
import { toPalpiteHeadlineViewFromSet } from "@/lib/view/palpites-headline";
import { displayMatchTeams } from "@/lib/view/team";
import {
  toUnderdogPanelView,
  type UnderdogPanelView,
} from "@/lib/view/underdog";

// "Chances do azarão" (#671, ADR 0072). O cliente manda SÓ o matchId: base, números e
// sinais saem do servidor. Todos os portões grátis antes da cobrança (1 unidade do
// limite de palpites), inclusive o cálculo dos números; a row guardada que ainda vale
// (materialidade) volta sem cobrar. Depois da cobrança o pedido nunca falha: falha da
// IA vira o texto padrão, e uma exceção inesperada também (sem gravar).

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
        | "limite";
    };

type Refusal = Extract<OpenUnderdogResult, { ok: false }>;
const refuse = (error: string, kind?: Refusal["kind"]): Refusal =>
  kind ? { ok: false, error, kind } : { ok: false, error };

const NO_UNDERDOG =
  "O modelo não vê azarão claro neste jogo agora. Volte mais perto do apito.";

export async function openUnderdogView(
  _prev: OpenUnderdogResult | null,
  formData: FormData
): Promise<OpenUnderdogResult> {
  const deadlineAt = actionDeadline();
  const parsedId = z.uuid().safeParse(formData.get("matchId"));
  if (!parsedId.success) return refuse("Pedido inválido.", "invalido");
  const matchId = parsedId.data;

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

  // Texto pago que ainda vale pra base atual: volta sem cobrar.
  const stored = await getLatestUnderdogView(userId, matchId);
  if (stored && isMaterialSame(stored.facts, base.pick)) {
    return {
      ok: true,
      view: toUnderdogPanelView(stored, teams, "current"),
      charged: false,
    };
  }

  // A mesma porta da página (coerência com o palpite na tela; sem run aqui).
  const latestSet = (await getPalpiteSetsForMatch(matchId, userId))[0];
  const heroPalpite = latestSet
    ? toPalpiteHeadlineViewFromSet(latestSet)
    : null;
  const visible = underdogTeaserVisible({
    flag: true,
    preMatch: true,
    heroPalpite,
    runInFlight: false,
    pick: base.pick,
  });
  if (!visible) return refuse(NO_UNDERDOG, "sem-azarao");

  // Os números são código puro: falha aqui é recusa grátis, antes da cobrança.
  let codeFacts: UnderdogFacts;
  try {
    codeFacts = computeUnderdogFacts(base);
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "underdog",
        matchId,
        error: "facts_failed",
        message: err instanceof Error ? err.message : String(err),
      })
    );
    return refuse(ANALYSES_UNAVAILABLE_MESSAGE);
  }

  const isAdmin = session.user.role === "admin";
  const rl = await checkPalpitesRateLimit(userId, { failClosed: !isAdmin });
  if (rl.reason === "fail-closed") return refuse(ANALYSES_UNAVAILABLE_MESSAGE);
  if (!rl.ok) return refuse(palpitesLimitMessage(rl.limit), "limite");

  // ─── Depois da cobrança: nada daqui pra baixo falha ───
  let facts = codeFacts;
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
        const saved = await insertUnderdogView({
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
        });
        // Corrida com outra aba: a row que ficou é a que vale (o texto bate ao reabrir).
        if (saved) {
          return {
            ok: true,
            view: toUnderdogPanelView(saved, teams, "current"),
            charged: true,
          };
        }
      } catch (err) {
        console.error(
          JSON.stringify({
            scope: "underdog",
            matchId,
            error: "insert_failed",
            message: err instanceof Error ? err.message : String(err),
          })
        );
      }
    }
    return {
      ok: true,
      view: toUnderdogPanelView(current, teams, "current"),
      charged: true,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "underdog",
        matchId,
        error: "unexpected",
        message: err instanceof Error ? err.message : String(err),
      })
    );
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
