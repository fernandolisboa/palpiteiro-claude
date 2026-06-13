import { leagueToSportKey } from "@/lib/providers/odds-api-constants";
import { getOddsForSport } from "@/lib/providers/odds-api";
import { computeImpliedProbabilities } from "@/lib/odds/implied-probability";
import { ODDS_SNAPSHOT_FRESHNESS_MS } from "@/lib/odds/freshness-window";
import {
  OVER_UNDER,
  teamsMatch,
  type MarketDescriptor,
} from "@/lib/odds/market-descriptor";
import {
  pickBestBookmaker,
  type MarketOddsBundle,
} from "@/lib/odds/select-bookmaker";
import {
  getLatestFreshSelectionOddsSnapshots,
  getLatestOddsSnapshot,
  insertOddsSnapshotsBatch,
  insertSelectionOddsSnapshotsBatch,
  type DbOddsSnapshot,
  type SelectionSnapshotRow,
} from "@/lib/db/queries/odds-snapshots";
import { getMatchesInLeagueWindow, type DbMatch } from "@/lib/db/queries/matches";
import { db } from "@/lib/db";
import { resolveMarketCatalog } from "@/lib/db/queries/market-catalog";
import type { OddsApiEventOdds } from "@/lib/providers/odds-api-schemas";

const KICKOFF_PAIRING_WINDOW_MS = 6 * 60 * 60 * 1000;

function findEventForMatch(
  events: OddsApiEventOdds[],
  match: DbMatch,
): OddsApiEventOdds | undefined {
  const kickoffMs = match.kickoffAt.getTime();
  return events.find((event) => {
    const ts = Date.parse(event.commence_time);
    if (
      !Number.isFinite(ts) ||
      Math.abs(ts - kickoffMs) > KICKOFF_PAIRING_WINDOW_MS
    ) {
      return false;
    }
    return (
      teamsMatch(event.home_team, match.homeTeam) &&
      teamsMatch(event.away_team, match.awayTeam)
    );
  });
}

function isFresh(snapshot: DbOddsSnapshot | null, now: number): boolean {
  if (!snapshot) return false;
  return now - snapshot.capturedAt.getTime() < ODDS_SNAPSHOT_FRESHNESS_MS;
}

export type EnsureOddsOptions = {
  now?: Date;
  markets?: MarketDescriptor[];
};

/**
 * Garante snapshots frescas (< 30min) pros mercados pedidos do `match`.
 *
 * Estratégia de quota (inalterada): The Odds API free tier = 500 req/mês. 1 call =
 * liga inteira; persistimos snapshots pra TODOS os matches conhecidos da janela.
 *
 * Multi-mercado (#164): por descriptor, faz gate de frescor MARKET-AWARE
 *   - over_under: checa a tabela VELHA (`getLatestOddsSnapshot`, comportamento atual);
 *   - novos (match_result): checam a NOVA (`getLatestFreshSelectionOddsSnapshots`).
 * Sem isso, um snapshot fresco de over/under daria early-return antes do fetch h2h.
 *
 * Quando stale: fetch da liga (rede), `pickBestBookmaker` por match (UMA vez),
 * resolução de market/selection ids (reads) — TUDO antes do batch — e dual-write
 * ATÔMICO via `db.batch([...])` (neon-http não tem `db.transaction`; ver invites.ts):
 *   - over_under: VELHA (`insertOddsSnapshotsBatch(rows, now)`, strings idênticas) +
 *     NOVA (`insertSelectionOddsSnapshotsBatch`), AMBAS do mesmo bundle → mesmo
 *     captured_at (`now`)/bookmaker/overround;
 *   - match_result: SÓ a NOVA.
 *
 * Retorna a snapshot over/under (tabela velha) MAIS RECENTE do match após a
 * operação — contrato inalterado pro caller (page de match), independente de quais
 * mercados foram pedidos. null se a liga não tem o evento ou nenhum book oferece o
 * mercado over/under completo.
 */
export async function ensureOddsSnapshotsFresh(
  match: DbMatch,
  opts: EnsureOddsOptions = {},
): Promise<DbOddsSnapshot | null> {
  const now = opts.now ?? new Date();
  const descriptors = opts.markets ?? [OVER_UNDER];

  const fetchLeagueEvents = async (
    providerMarkets: string[],
  ): Promise<OddsApiEventOdds[] | null> => {
    // markets[] do provider NÃO pode ser vazio (guarda contra o fallback silencioso
    // de resolveCsv → ['totals'] em odds-api.ts).
    if (providerMarkets.length === 0) {
      throw new Error("ensureOddsSnapshotsFresh: provider markets[] vazio");
    }
    const sportKey = leagueToSportKey(match.league);
    try {
      return await getOddsForSport(sportKey, {
        markets: providerMarkets,
        regions: ["eu"],
      });
    } catch (err) {
      console.error(
        JSON.stringify({
          scope: "fetch-and-snapshot",
          league: match.league,
          matchId: match.id,
          error: "getOddsForSport_failed",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      return null;
    }
  };

  for (const descriptor of descriptors) {
    // ── Gate de frescor market-aware ────────────────────────────────────────
    if (descriptor.dbMarketKey === OVER_UNDER.dbMarketKey) {
      const existing = await getLatestOddsSnapshot(match.id);
      if (isFresh(existing, now.getTime())) continue;
    } else {
      const fresh = await getLatestFreshSelectionOddsSnapshots(
        {
          matchId: match.id,
          dbMarketKey: descriptor.dbMarketKey,
          params: descriptor.params,
        },
        now,
      );
      if (fresh) continue;
    }

    // ── Stale: fetch da liga + resolução de ids (TUDO antes do batch) ───────
    const events = await fetchLeagueEvents([descriptor.providerMarketKey]);
    if (!events) continue; // fetch falhou; degrada (não crasha a UI).

    const knownMatches = await getMatchesInLeagueWindow({
      league: match.league,
      windowHours: 7 * 24,
    });

    const { marketId, idByKey } = await resolveMarketCatalog(
      descriptor.dbMarketKey,
    );
    const selIdOf = (key: string): string => {
      const id = idByKey.get(key);
      if (!id) {
        throw new Error(
          `seleção '${key}' não seedada pro market '${descriptor.dbMarketKey}'`,
        );
      }
      return id;
    };

    const oldRows: Array<{
      matchId: string;
      bookmaker: string;
      overOdd: number;
      underOdd: number;
      overroundPct: number;
    }> = [];
    const newRows: SelectionSnapshotRow[] = [];

    for (const m of knownMatches) {
      const event = findEventForMatch(events, m);
      if (!event) continue;
      const bundle: MarketOddsBundle | null = pickBestBookmaker({
        event,
        match: { homeTeam: m.homeTeam, awayTeam: m.awayTeam },
        descriptor,
      });
      if (!bundle) continue;

      const overroundPct = bundle.overround * 100;

      // Linhas da tabela NOVA (todas as seleções; mesmo captured_at/bookmaker).
      for (const sel of bundle.selections) {
        newRows.push({
          matchId: m.id,
          marketId,
          selectionId: selIdOf(sel.key),
          marketParams: descriptor.params ?? null,
          odd: sel.odd.toFixed(3),
          overroundPct: overroundPct.toFixed(2),
          bookmaker: bundle.bookmakerTitle,
          capturedAt: now,
        });
      }

      // Tabela VELHA: SÓ over_under. Strings IDÊNTICAS ao caminho legado — o
      // overround é recomputado pelo wrapper binário (bit-exato com o do bundle).
      if (descriptor.dbMarketKey === OVER_UNDER.dbMarketKey) {
        const over = bundle.selections.find((s) => s.key === "over");
        const under = bundle.selections.find((s) => s.key === "under");
        if (over && under) {
          const { overround } = computeImpliedProbabilities(over.odd, under.odd);
          oldRows.push({
            matchId: m.id,
            bookmaker: bundle.bookmakerTitle,
            overOdd: over.odd,
            underOdd: under.odd,
            overroundPct: overround * 100,
          });
        }
      }
    }

    // ── Dual-write atômico: só os builders não-awaited entram no batch ──────
    // db.batch é o primitivo atômico do neon-http (db.transaction LANÇA; ver
    // invites.ts). Falha antes daqui ⇒ nenhuma escrita; falha no batch ⇒ rollback
    // de ambas. over_under escreve as DUAS tabelas no mesmo batch (mesmo `now`);
    // match_result só a nova.
    const writeOld =
      descriptor.dbMarketKey === OVER_UNDER.dbMarketKey && oldRows.length > 0;
    const writeNew = newRows.length > 0;

    if (writeOld && writeNew) {
      await db.batch([
        insertOddsSnapshotsBatch(oldRows, now),
        insertSelectionOddsSnapshotsBatch(newRows),
      ]);
    } else if (writeNew) {
      await insertSelectionOddsSnapshotsBatch(newRows);
    } else if (writeOld) {
      await insertOddsSnapshotsBatch(oldRows, now);
    }
  }

  // Contrato pro caller: a snapshot over/under (tabela velha) mais recente.
  return getLatestOddsSnapshot(match.id);
}
