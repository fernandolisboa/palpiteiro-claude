import { leagueToSportKey } from "@/lib/providers/odds-api-constants";
import {
  getEventsForSport,
  getOddsForEvent,
  getOddsForSport,
} from "@/lib/providers/odds-api";
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
  getLatestOverUnderSnapshot,
  insertSelectionOddsSnapshotsBatch,
  type OverUnderSnapshot,
  type SelectionSnapshotRow,
} from "@/lib/db/queries/odds-snapshots";
import { getMatchesInLeagueWindow, type DbMatch } from "@/lib/db/queries/matches";
import { resolveMarketCatalog } from "@/lib/db/queries/market-catalog";
import type { OddsApiEventOdds } from "@/lib/providers/odds-api-schemas";

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
 * Gate de frescor por descriptor, sempre contra `selection_odds_snapshots`
 * (`getLatestFreshSelectionOddsSnapshots`, por linha candidata). Na Fase 5 a tabela
 * legada `match_odds_snapshots` foi removida: over/under usa o MESMO gate por linha
 * (featured → linha 2.5) que os demais mercados — nada mais discrimina over/under.
 *
 * Quando stale: fetch da liga (rede), `pickBestBookmaker` por match (UMA vez),
 * resolução de market/selection ids (reads) e escrita em `selection_odds_snapshots`
 * (`insertSelectionOddsSnapshotsBatch`) — uma row por seleção do mesmo bundle (mesmo
 * captured_at (`now`)/bookmaker/overround). Sem mais dual-write.
 *
 * Retorna a captura over/under (linha 2.5) MAIS RECENTE do match na forma binária
 * (`getLatestOverUnderSnapshot`, best-effort) após a operação — contrato inalterado
 * pro caller (page de match), independente de quais mercados foram pedidos. null se a
 * liga não tem o evento ou nenhum book oferece o over/under 2.5 completo/coerente.
 */
export async function ensureOddsSnapshotsFresh(
  match: DbMatch,
  opts: EnsureOddsOptions = {},
): Promise<OverUnderSnapshot | null> {
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
    // ── Gate de frescor por linha candidata (#175), sempre na tabela nova ─────
    // Se QUALQUER linha estiver stale/ausente, o re-fetch (1 crédito, escada
    // inteira) reescreve TODAS. Single-line (over/under featured 2.5, btts, dupla
    // chance, match_result) → uma checagem (candidateLines ausente → [params.line]).
    // over/under não tem mais gate especial (a tabela legada saiu na Fase 5).
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

      // Uma row por seleção (todas; mesmo captured_at/bookmaker/overround).
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
    }

    // Escrita única em selection_odds_snapshots (sem mais dual-write; a tabela
    // legada saiu na Fase 5). Falha antes daqui ⇒ nenhuma escrita.
    if (newRows.length > 0) {
      await insertSelectionOddsSnapshotsBatch(newRows);
    }
  }

  // Contrato pro caller: a captura over/under (linha 2.5) mais recente, na forma
  // binária adaptada de selection_odds_snapshots (best-effort, nunca throw).
  return getLatestOverUnderSnapshot(match.id);
}
