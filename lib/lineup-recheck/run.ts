import type { MatchJudgmentInput } from "@/lib/ai/engine/judgment-input";
import {
  recheckPredictionWithLineup,
  resolveModelBaseJudgments,
  type LineupRecheckSkipReason,
} from "@/lib/ai/predict";
import { hasTypeSafeKey } from "@/lib/ai/providers/typesafe/client";
import { getEnableLineupRecheck } from "@/lib/db/queries/ai-config";
import {
  getLineupRecheckCandidates,
  type LineupRecheckCandidate,
} from "@/lib/db/queries/lineup-recheck";
import { fetchMatchJudgmentData } from "@/lib/model-base/judgment-data";
import { COMPUTE_MATCH_MODELS_LOCK_KEY } from "@/lib/model-base/compute-match-models";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type {
  FixtureRef,
  NormalizedStanding,
} from "@/lib/providers/sports-data/types";
import {
  acquireKvLock,
  readKvStamp,
  releaseKvLock,
  writeKvStamp,
} from "@/lib/sync/lock";

// Reconferência com a escalação (#619, PR B): a cada 10 min, as análises code_jev de
// pré-jogo feitas antes da escalação sair, nos jogos com KO em até 75 min, são
// recalculadas em código assim que as duas escalações aparecem na API-Football. Uma
// chamada JEV por jogo serve todos os pais (usuários e mercados) dele. Sem LLM, sem The
// Odds API (odds só do banco) e sem tocar no limite diário (lib/rate-limit.ts).

const SCOPE = "recheck_lineups";

export const LINEUP_RECHECK_LOCK_KEY = "lineup-recheck:lock";
// = maxDuration da rota: um run que morre no meio libera o lock pelo TTL.
const LOCK_TTL_MS = 300_000;
// Prazo pra COMEÇAR um jogo: pior caso por jogo ≈ 16 req a 8/min na API-Football (a
// mesma conta do compute-match-models) + JEV ≈ 135 s ⇒ 120 + 135 < 300. Na prática ~1–2
// jogos por run (~10 por horário de KO, com runs a cada 10 min); o resto fica pro próximo.
export const LINEUP_RECHECK_START_DEADLINE_MS = 120_000;
// Jogo a ≤ 2 min do KO não é começado: não daria tempo de ninguém agir no número.
export const LINEUP_RECHECK_MIN_KICKOFF_LEAD_MS = 2 * 60_000;
// Marcador por jogo: o carimbo é o instante da busca dos candidatos já reconferidos.
// Pais criados depois dele ainda entram; os de antes já viraram reconferência (ou o jogo
// foi pulado sem informação nova). 3 h cobrem a janela de 75 min com folga.
export const LINEUP_RECHECK_MARKER_TTL_MS = 3 * 60 * 60_000;
export const lineupRecheckMarkerKey = (matchId: string) =>
  `lineup-recheck:done:${matchId}`;

export type LineupRecheckSummary = {
  skipped?: "flag_off" | "model_base_running" | "locked" | "missing_jev_key";
  candidates: number;
  matches: number;
  alreadyDone: number;
  lineupNotOut: number;
  kickoffTooClose: number;
  skippedDeadline: number;
  dataUnavailable: number;
  uninformative: number;
  jevFailed: number;
  persisted: number;
  flipped: number;
  oddsFromParent: number;
  parentsSkipped: Partial<Record<LineupRecheckSkipReason, number>>;
  errors: number;
};

function emptySummary(): LineupRecheckSummary {
  return {
    candidates: 0,
    matches: 0,
    alreadyDone: 0,
    lineupNotOut: 0,
    kickoffTooClose: 0,
    skippedDeadline: 0,
    dataUnavailable: 0,
    uninformative: 0,
    jevFailed: 0,
    persisted: 0,
    flipped: 0,
    oddsFromParent: 0,
    parentsSkipped: {},
    errors: 0,
  };
}

function logError(event: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ scope: SCOPE, event, ...fields }));
}

const errMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/**
 * A escalação traz informação nova pro JEV (pura)? Sim quando algum lado anunciado tem
 * mudanças contadas (diff por id) ou algum desfalcado da lista do provider está entre os
 * titulares de hoje. Os dois lados "changes unknown" e ninguém removido → a reconferência
 * só repetiria o número (sem JEV, sem row).
 */
export function isLineupInformative(input: MatchJudgmentInput): boolean {
  return (["home", "away"] as const).some((side) => {
    const summary = input.lineup[side];
    if (summary.status === "announced" && summary.changes !== null) return true;
    return input.providerAbsences[side].length > input.absences[side].length;
  });
}

type MatchGroup = {
  match: LineupRecheckCandidate["match"];
  parents: LineupRecheckCandidate[];
};

// Agrupa por jogo, mantendo a ordem de KO da query.
function groupByMatch(candidates: LineupRecheckCandidate[]): MatchGroup[] {
  const groups = new Map<string, MatchGroup>();
  for (const c of candidates) {
    const g = groups.get(c.match.id);
    if (g) g.parents.push(c);
    else groups.set(c.match.id, { match: c.match, parents: [c] });
  }
  return [...groups.values()];
}

export async function runLineupRechecks(
  opts: { now?: Date } = {},
): Promise<LineupRecheckSummary> {
  if (!(await getEnableLineupRecheck())) {
    return { ...emptySummary(), skipped: "flag_off" };
  }
  // O cron da base usa o mesmo cliente da API-Football (8 req/min por instância): os
  // dois juntos, em instâncias diferentes, dobrariam o ritmo na conta. Este espera.
  if ((await readKvStamp(COMPUTE_MATCH_MODELS_LOCK_KEY)) !== null) {
    console.log(JSON.stringify({ scope: SCOPE, event: "skipped_model_base_running" }));
    return { ...emptySummary(), skipped: "model_base_running" };
  }
  if (!(await acquireKvLock(LINEUP_RECHECK_LOCK_KEY, { ttlMs: LOCK_TTL_MS }))) {
    console.log(JSON.stringify({ scope: SCOPE, event: "skipped_locked" }));
    return { ...emptySummary(), skipped: "locked" };
  }
  try {
    return await runLocked(opts);
  } finally {
    await releaseKvLock(LINEUP_RECHECK_LOCK_KEY).catch((err: unknown) =>
      logError("lock_release_failed", { message: errMessage(err) }),
    );
  }
}

async function runLocked(opts: { now?: Date }): Promise<LineupRecheckSummary> {
  const summary = emptySummary();
  const startedMs = Date.now();
  const now = opts.now ?? new Date();
  const candidates = await getLineupRecheckCandidates({ now });
  summary.candidates = candidates.length;
  // Caso comum (144 runs/dia): nada na janela → uma query e sai, sem log.
  if (candidates.length === 0) return summary;
  if (!hasTypeSafeKey()) {
    console.warn(JSON.stringify({ scope: SCOPE, event: "jev_skipped_missing_key" }));
    return { ...summary, skipped: "missing_jev_key" };
  }

  const provider = getSportsDataProvider();
  const groups = groupByMatch(candidates);
  summary.matches = groups.length;
  // Pais com createdAt ≤ isto estavam nesta busca: é o carimbo do marcador.
  const coveredUntilMs = now.getTime();

  for (const { match, parents: all } of groups) {
    try {
      if (Date.now() - startedMs > LINEUP_RECHECK_START_DEADLINE_MS) {
        summary.skippedDeadline++;
        continue;
      }
      if (match.kickoffAt.getTime() - Date.now() <= LINEUP_RECHECK_MIN_KICKOFF_LEAD_MS) {
        summary.kickoffTooClose++;
        continue;
      }
      const markerKey = lineupRecheckMarkerKey(match.id);
      const marker = await readKvStamp(markerKey);
      const parents =
        marker === null
          ? all
          : all.filter((c) => c.prediction.createdAt.getTime() > marker);
      if (parents.length === 0) {
        summary.alreadyDone++;
        continue;
      }

      // Sonda: 1 req (cache de 5 min no adapter). Escalação ainda não saiu → próximo jogo.
      const ref: FixtureRef = {
        league: match.league,
        kickoffAt: match.kickoffAt.toISOString(),
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
      };
      let lineups: Awaited<ReturnType<typeof provider.getLineups>>;
      try {
        lineups = await provider.getLineups(ref);
      } catch (err) {
        summary.dataUnavailable++;
        logError("lineup_probe_failed", { matchId: match.id, message: errMessage(err) });
        continue;
      }
      if (!lineups) {
        summary.lineupNotOut++;
        continue;
      }

      // Marcador antes da passada (um run concorrente com o lock vencido não refaz o
      // jogo); qualquer falha antes de gravar volta o marcador ao que era.
      await writeKvStamp(markerKey, coveredUntilMs, LINEUP_RECHECK_MARKER_TTL_MS);
      const release = () =>
        (marker === null
          ? releaseKvLock(markerKey)
          : writeKvStamp(markerKey, marker, LINEUP_RECHECK_MARKER_TTL_MS)
        ).catch((err: unknown) =>
          logError("marker_release_failed", { matchId: match.id, message: errMessage(err) }),
        );

      // Tabela uma vez por jogo; falhou → sem JEV (um state sem tabela não bateria com o
      // do predict nem com o do cron da base).
      let standings: NormalizedStanding | undefined;
      try {
        standings = await provider.getStandings(match.league);
      } catch {
        summary.dataUnavailable++;
        logError("data_unavailable", { matchId: match.id, message: "standings_failed" });
        await release();
        continue;
      }
      let data: Awaited<ReturnType<typeof fetchMatchJudgmentData>>;
      try {
        data = await fetchMatchJudgmentData({ match, provider, standings });
      } catch (err) {
        summary.dataUnavailable++;
        logError("data_unavailable", { matchId: match.id, message: errMessage(err) });
        await release();
        continue;
      }

      const resolved = await resolveModelBaseJudgments({
        matchId: match.id,
        provider,
        data,
        logScope: SCOPE,
        judgeIf: isLineupInformative,
      });
      if (!resolved) {
        summary.jevFailed++;
        await release();
        continue;
      }
      if (resolved.run === null) {
        // Sem informação nova: o marcador fica (nada a refazer até um pai novo).
        summary.uninformative++;
        continue;
      }
      if (resolved.run.answers === null) {
        summary.jevFailed++;
        logError("jev_failed", {
          matchId: match.id,
          kind: resolved.run.failure?.kind ?? null,
        });
        await release();
        continue;
      }
      const judgment = { input: resolved.input, run: resolved.run };

      for (const parent of parents) {
        try {
          const out = await recheckPredictionWithLineup({
            parent: { prediction: parent.prediction, marketKey: parent.marketKey },
            match,
            judgment,
          });
          if (out.kind === "persisted") {
            summary.persisted++;
            if (out.flipped) summary.flipped++;
            if (out.oddsFrom === "parent") summary.oddsFromParent++;
          } else {
            summary.parentsSkipped[out.reason] =
              (summary.parentsSkipped[out.reason] ?? 0) + 1;
          }
        } catch (err) {
          summary.errors++;
          logError("recheck_failed", {
            matchId: match.id,
            predictionId: parent.prediction.id,
            message: errMessage(err),
          });
        }
      }
    } catch (err) {
      summary.errors++;
      logError("match_failed", { matchId: match.id, message: errMessage(err) });
    }
  }

  console.log(JSON.stringify({ scope: SCOPE, event: "run_complete", ...summary }));
  return summary;
}
