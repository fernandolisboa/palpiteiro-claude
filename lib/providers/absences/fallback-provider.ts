import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import {
  SportsDataNotFoundError,
  SportsDataTransientError,
  SportsDataUnsupportedError,
  type FixtureRef,
  type NormalizedInjury,
  type ProviderCapabilities,
} from "@/lib/providers/sports-data/types";

import type { AbsencesProvider } from "./types";

/**
 * Compõe dois AbsencesProvider (primário→fallback), espelhando EXATAMENTE o
 * contrato do FallbackProvider de sports-data (ADR 0026 D4 — compor, não
 * generalizar pra N):
 * - capability gate ANTES de invocar (`supportsAbsences` + liga) — um provider sem
 *   a capability NUNCA é chamado; se nenhum suporta, lança Unsupported (predict.ts
 *   captura → absences_available=false).
 * - `SportsDataTransientError` → tenta o próximo candidato (outage/5xx/429/timeout).
 * - `SportsDataNotFoundError` → bubble (erro de input, não outage).
 * - Reusa as classes de erro de sports-data (mesma hierarquia; o predict.ts já as pega).
 */
export class AbsencesFallbackProvider implements AbsencesProvider {
  readonly capabilities: ProviderCapabilities;

  constructor(
    private readonly primary: AbsencesProvider,
    private readonly fallback: AbsencesProvider,
  ) {
    const leagues = new Set<SupportedLeague>();
    for (const l of primary.capabilities.supportedLeagues) leagues.add(l);
    for (const l of fallback.capabilities.supportedLeagues) leagues.add(l);
    this.capabilities = {
      name: `absences-fallback(${primary.capabilities.name},${fallback.capabilities.name})`,
      supportsInjuries:
        primary.capabilities.supportsInjuries ||
        fallback.capabilities.supportsInjuries,
      supportsLineups:
        primary.capabilities.supportsLineups ||
        fallback.capabilities.supportsLineups,
      supportsAbsences:
        primary.capabilities.supportsAbsences === true ||
        fallback.capabilities.supportsAbsences === true,
      supportedLeagues: leagues,
    };
  }

  private logFallback(args: { method: string; from: string; to: string; cause: unknown }): void {
    const cause =
      args.cause instanceof Error
        ? `${args.cause.name}: ${args.cause.message}`
        : String(args.cause);
    console.warn(
      JSON.stringify({
        event: "absences_fallback_activated",
        method: args.method,
        from: args.from,
        to: args.to,
        cause,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  private async withFallback<T>(
    method: string,
    gate: (p: AbsencesProvider) => boolean,
    invoke: (p: AbsencesProvider) => Promise<T>,
  ): Promise<T> {
    // Gate ANTES de invocar (espelha fallback-provider.ts:86-88): só candidatos com
    // a capability (e a liga) são tentados; key-gating do SportMonth cai aqui
    // (supportsAbsences=false sem token → filtrado fora, nunca chamado).
    const candidates = [this.primary, this.fallback].filter((p) => gate(p));
    if (candidates.length === 0) {
      throw new SportsDataUnsupportedError(
        `No provider supports absences for ${method}`,
        this.capabilities.name,
        method,
      );
    }
    let lastError: unknown;
    for (let i = 0; i < candidates.length; i++) {
      const provider = candidates[i]!;
      try {
        return await invoke(provider);
      } catch (err) {
        if (err instanceof SportsDataNotFoundError) throw err; // input error
        if (!(err instanceof SportsDataTransientError)) throw err; // unsupported/programmer
        lastError = err;
        const next = candidates[i + 1];
        if (next) {
          this.logFallback({
            method,
            from: provider.capabilities.name,
            to: next.capabilities.name,
            cause: err,
          });
        }
      }
    }
    throw lastError;
  }

  getAbsencesByFixture(
    ref: FixtureRef,
  ): Promise<{ home: NormalizedInjury[]; away: NormalizedInjury[] }> {
    return this.withFallback(
      "getAbsencesByFixture",
      (p) =>
        p.capabilities.supportsAbsences === true &&
        p.capabilities.supportedLeagues.has(ref.league),
      (p) => p.getAbsencesByFixture(ref),
    );
  }

  getAbsencesByTeam(
    team: string,
    league: SupportedLeague,
  ): Promise<NormalizedInjury[]> {
    return this.withFallback(
      "getAbsencesByTeam",
      (p) =>
        p.capabilities.supportsAbsences === true &&
        p.capabilities.supportedLeagues.has(league),
      (p) => p.getAbsencesByTeam(team, league),
    );
  }
}
