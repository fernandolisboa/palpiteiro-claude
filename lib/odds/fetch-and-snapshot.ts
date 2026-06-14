import { leagueToSportKey } from "@/lib/providers/odds-api-constants";
import {
  getEventsForSport,
  getOddsForEvent,
  getOddsForSport,
} from "@/lib/providers/odds-api";
import { computeImpliedProbabilities } from "@/lib/odds/implied-probability";
import { ODDS_SNAPSHOT_FRESHNESS_MS } from "@/lib/odds/freshness-window";
import { findEventInList } from "@/lib/odds/match-event";
import {
  OVER_UNDER,
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

  // Mercado *additional* (btts): odds só pelo endpoint POR EVENTO. NUNCA batch da
  // liga (quota: custo = nº markets × regiões POR evento). Resolve o eventId pela
  // lista GRATUITA de eventos (0 créditos) e busca SÓ este match → 1 crédito por
  // análise (em miss), deduplicado pelo gate de frescor acima. Escreve só a tabela
  // nova (selection_odds_snapshots) — o guard de dual-write já exclui não-over_under.
  const fetchAndWriteAdditional = async (
    descriptor: MarketDescriptor,
  ): Promise<void> => {
    const sportKey = leagueToSportKey(match.league);
    let event: OddsApiEventOdds;
    try {
      const events = await getEventsForSport(sportKey); // gratuito (0 créditos)
      const listItem = findEventInList(events, match);
      if (!listItem) return; // sem evento pareado nesta liga; degrada
      event = await getOddsForEvent(sportKey, listItem.id, {
        markets: [descriptor.providerMarketKey], // explícito (evita resolveCsv→totals)
        regions: ["eu"],
      }); // 1 crédito
    } catch (err) {
      console.error(
        JSON.stringify({
          scope: "fetch-and-snapshot",
          league: match.league,
          matchId: match.id,
          market: descriptor.dbMarketKey,
          error: "additional_fetch_failed",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      return;
    }

    const { marketId, idByKey } = await resolveMarketCatalog(
      descriptor.dbMarketKey,
    );
    // Multi-linha (#175): UM getOddsForEvent (acima) traz a escada inteira; aqui
    // resolvemos o MELHOR book POR linha candidata e acumulamos um bundle por linha
    // (marketParams:{line}). candidateLines ausente (btts/dupla chance) → [params.line]
    // (= [undefined] quando sem linha) = UM bundle, byte-idêntico ao anterior. Linha
    // sem book completo → pulada (escada parcial; analisa as disponíveis).
    const candidateLines = descriptor.candidateLines ?? [descriptor.params?.line];
    const newRows: SelectionSnapshotRow[] = [];
    for (const line of candidateLines) {
      const bundle: MarketOddsBundle | null = pickBestBookmaker({
        event,
        match: { homeTeam: match.homeTeam, awayTeam: match.awayTeam },
        descriptor,
        params: line === undefined ? undefined : { line },
      });
      if (!bundle) continue; // nenhum book com o mercado completo nesta linha; degrada
      const overroundPct = bundle.overround * 100;
      for (const sel of bundle.selections) {
        const selectionId = idByKey.get(sel.key);
        if (!selectionId) {
          // Hard-fail INTENCIONAL (não é caso de degrade como o fetch/!bundle acima):
          // seleção sem seed é bug de migration, não condição de runtime. A seed
          // garante as seleções → inalcançável pós-migration. Propaga p/ o catch da
          // action como erro inesperado.
          throw new Error(
            `seleção '${sel.key}' não seedada pro market '${descriptor.dbMarketKey}'`,
          );
        }
        newRows.push({
          matchId: match.id,
          marketId,
          selectionId,
          marketParams: line === undefined ? null : { line },
          odd: sel.odd.toFixed(3),
          overroundPct: overroundPct.toFixed(2),
          bookmaker: bundle.bookmakerTitle,
          capturedAt: now,
        });
      }
    }
    if (newRows.length > 0) {
      await insertSelectionOddsSnapshotsBatch(newRows);
    }
  };

  for (const descriptor of descriptors) {
    // ── Gate de frescor market-aware ────────────────────────────────────────
    // FEATURED over_under (e SÓ ele) gateia pela tabela LEGADA (dual-write). A
    // variante over_under_alt (#175) tem a MESMA dbMarketKey mas é `additional` →
    // cai no gate da tabela nova (por linha), não no legado. Discrimina por oddsSource.
    if (
      descriptor.dbMarketKey === OVER_UNDER.dbMarketKey &&
      descriptor.oddsSource !== "additional"
    ) {
      const existing = await getLatestOddsSnapshot(match.id);
      if (isFresh(existing, now.getTime())) continue;
    } else {
      // Frescor POR linha candidata (#175): se QUALQUER linha estiver stale/ausente,
      // o re-fetch (1 crédito, escada inteira) reescreve TODAS. Single-line (btts/
      // dupla chance/match_result) → uma checagem (candidateLines ausente → [params.line]).
      const candidateLines =
        descriptor.candidateLines ?? [descriptor.params?.line];
      let allFresh = true;
      for (const line of candidateLines) {
        const fresh = await getLatestFreshSelectionOddsSnapshots(
          {
            matchId: match.id,
            dbMarketKey: descriptor.dbMarketKey,
            params: line === undefined ? undefined : { line },
          },
          now,
        );
        if (!fresh) {
          allFresh = false;
          break;
        }
      }
      if (allFresh) continue;
    }

    // ── Stale + additional (btts): fetch POR EVENTO, só este match (sem batch) ──
    if (descriptor.oddsSource === "additional") {
      await fetchAndWriteAdditional(descriptor);
      continue;
    }

    // ── Stale + featured: fetch da liga + resolução de ids (TUDO antes do batch) ──
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
      const event = findEventInList(events, m);
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
