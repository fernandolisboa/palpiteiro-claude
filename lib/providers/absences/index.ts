import { AbsencesFallbackProvider } from "./fallback-provider";
import { SportsDataAbsencesAdapter } from "./sports-data-absences-adapter";
import { SportMonksAbsencesAdapter } from "./sportmonks/adapter";
import type { AbsencesProvider } from "./types";

// Factory da AbsencesProvider (ADR 0026 D1/D4, #227), espelhando o de sports-data.
// Composição por env var (lida uma vez, memoizada):
//   ABSENCES_PRIMARY   default 'sports-data' (wrapper da cascata api-football existente)
//   ABSENCES_FALLBACK  default 'sportmonks'  (key-gated: inerte sem SPORTMONKS_API_TOKEN)
// Sem token SportMonks, o fallback tem supportsAbsences=false → é filtrado no gate →
// só o primário roda → comportamento IDÊNTICO a hoje.
type AbsencesProviderName = "sports-data" | "sportmonks";

const VALID_PROVIDERS: readonly AbsencesProviderName[] = [
  "sports-data",
  "sportmonks",
] as const;

function parseProviderName(
  value: string | undefined,
  fallback: AbsencesProviderName,
): AbsencesProviderName {
  if (value === undefined || value === "") return fallback;
  if ((VALID_PROVIDERS as readonly string[]).includes(value)) {
    return value as AbsencesProviderName;
  }
  throw new Error(
    `Invalid absences provider: "${value}". ` +
      `Expected one of: ${VALID_PROVIDERS.join(", ")}.`,
  );
}

function makeAdapter(name: AbsencesProviderName): AbsencesProvider {
  if (name === "sportmonks") return new SportMonksAbsencesAdapter();
  return new SportsDataAbsencesAdapter();
}

let cached: AbsencesProvider | undefined;

export function getAbsencesProvider(): AbsencesProvider {
  if (cached) return cached;
  const primary = parseProviderName(process.env.ABSENCES_PRIMARY, "sports-data");
  const fallback = parseProviderName(process.env.ABSENCES_FALLBACK, "sportmonks");
  if (primary === fallback) {
    cached = makeAdapter(primary);
    return cached;
  }
  cached = new AbsencesFallbackProvider(makeAdapter(primary), makeAdapter(fallback));
  return cached;
}

/**
 * Test seam: overrides the memoized absences provider. `undefined` clears it so
 * the next `getAbsencesProvider()` rebuilds from env. Production MUST NOT call this.
 */
export function __setAbsencesProviderForTesting(
  provider: AbsencesProvider | undefined,
): void {
  cached = provider;
}

export { AbsencesFallbackProvider, SportsDataAbsencesAdapter, SportMonksAbsencesAdapter };
export type { AbsencesProvider } from "./types";
