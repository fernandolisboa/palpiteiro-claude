import type {
  GetEventsForSportOptions,
  GetOddsForEventOptions,
  GetOddsForSportOptions,
  NormalizedOddsEvent,
  NormalizedOddsEventListItem,
  OddsProvider,
  OddsProviderCapabilities,
} from "@/lib/providers/odds/types";

/**
 * Composite de OddsProviders (#289, ADR 0025). É um ROTEADOR por capability — NÃO um
 * cascade-on-failure nem um merger. Cada call site passa UM `markets: [key]`, então
 * `pick()` resolve o ÚNICO adapter que cobre aquele key via `supportsMarket`. O
 * default (over/under, h2h, btts, dupla chance, alternate_totals) cai no `fallback`
 * (The Odds API) por passthrough → **byte-idêntico ao #288**. Correct score (bet_10)
 * roteia pro `primary` (api-football). Espelha o FallbackProvider de sports-data
 * (ADR 0005) como PADRÃO, sem o cascade (os providers de odds são COMPLEMENTARES,
 * não redundantes).
 */
export class OddsFallbackProvider implements OddsProvider {
  readonly capabilities: OddsProviderCapabilities;

  constructor(
    private readonly primary: OddsProvider,
    private readonly fallback: OddsProvider,
  ) {
    this.capabilities = {
      name: `odds-fallback(${primary.capabilities.name},${fallback.capabilities.name})`,
      supportedLeagues: new Set([
        ...primary.capabilities.supportedLeagues,
        ...fallback.capabilities.supportedLeagues,
      ]),
    };
  }

  supportsMarket(args: {
    sportKey: string;
    providerMarketKey: string;
  }): boolean {
    return (
      this.primary.supportsMarket(args) || this.fallback.supportsMarket(args)
    );
  }

  // Resolve o ÚNICO adapter que cobre TODOS os markets pedidos.
  //  - markets undefined/vazio → fallback (preserva o default ['totals'] do fio).
  //  - todos cobertos pelo primary → primary; pelo fallback → fallback (passthrough).
  //  - cruzando providers (NUNCA acontece hoje — call sites passam 1 key) → throw,
  //    forçando uma decisão explícita em vez de inventar um merge.
  private pick(sportKey: string, markets?: readonly string[]): OddsProvider {
    if (!markets || markets.length === 0) return this.fallback;
    const primaryOk = markets.every((m) =>
      this.primary.supportsMarket({ sportKey, providerMarketKey: m }),
    );
    if (primaryOk) return this.primary;
    const fallbackOk = markets.every((m) =>
      this.fallback.supportsMarket({ sportKey, providerMarketKey: m }),
    );
    if (fallbackOk) return this.fallback;
    throw new Error(
      `OddsFallbackProvider: nenhum provider único cobre markets [${markets.join(", ")}] em ${sportKey}`,
    );
  }

  // async: garante que um throw síncrono do pick() (markets cruzando providers)
  // vire REJEIÇÃO de promise, não throw síncrono — coerente com o contrato Promise.
  // Byte-idêntico no passthrough (mesmo valor resolvido).
  async getOddsForSport(
    sportKey: string,
    options?: GetOddsForSportOptions,
  ): Promise<NormalizedOddsEvent[]> {
    return this.pick(sportKey, options?.markets).getOddsForSport(
      sportKey,
      options,
    );
  }

  async getOddsForEvent(
    sportKey: string,
    eventId: string,
    options?: GetOddsForEventOptions,
  ): Promise<NormalizedOddsEvent> {
    return this.pick(sportKey, options?.markets).getOddsForEvent(
      sportKey,
      eventId,
      options,
    );
  }

  getEventsForSport(
    sportKey: string,
    options?: GetEventsForSportOptions,
  ): Promise<NormalizedOddsEventListItem[]> {
    // A lista grátis NÃO carrega markets — sempre o fallback (The Odds API), o
    // caminho de hoje (byte-idêntico). Correct score é featured (batch via
    // getOddsForSport), nunca usa este path por evento.
    return this.fallback.getEventsForSport(sportKey, options);
  }
}
