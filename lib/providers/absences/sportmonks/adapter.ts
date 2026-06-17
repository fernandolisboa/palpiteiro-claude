import { z } from "zod";

import {
  createProviderClient,
  HttpClientError,
  HttpClientTimeoutError,
  RetryableHttpError,
} from "@/lib/providers/http/client";
import { ONE_MINUTE } from "@/lib/providers/sports-data/cache-ttl";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import {
  SportsDataNotFoundError,
  SportsDataTransientError,
  type FixtureRef,
  type NormalizedInjury,
  type ProviderCapabilities,
} from "@/lib/providers/sports-data/types";

import type { AbsencesProvider } from "../types";

// SportMonks Football API v3 como fonte FALLBACK de desfalques (ADR 0026 D1, #227),
// via a entidade `sidelined` (lesões/suspensões). Estruturada/licenciada → source
// "official" (MESMA classe da API-Football; "unofficial" fica reservado pras fontes
// scraped rejeitadas). KEY-GATED: sem SPORTMONKS_API_TOKEN, `supportsAbsences=false`
// → o AbsencesFallbackProvider FILTRA este adapter fora (nunca o invoca) → zero
// gasto, zero mudança de comportamento. requireToken() só é alcançado se gated-in.
//
// ⚠️ SCHEMA E ENDPOINTS INFERIDOS DOS DOCS v3 (docs.sportmonks.com) — sem key viva
// pra validar. Os fixtures de teste cobrem a NORMALIZAÇÃO; o fio HTTP/resolução é
// best-effort até a integração ao vivo (ver PLAN-227 §7 / ADR 0026 §openUnknowns).
const SPORTMONKS_BASE_URL = "https://api.sportmonks.com/v3/football";
const PROVIDER_NAME = "sportmonks";

// SportMonks cobre BR/CL (planos Growth+); escopo oficial-primeiro, sem expandir liga.
const SUPPORTED_LEAGUES = new Set<SupportedLeague>([
  "brasileirao_a",
  "champions_league",
]);

export function hasSportMonksToken(): boolean {
  return Boolean(process.env.SPORTMONKS_API_TOKEN);
}

function requireSportMonksToken(): string {
  const token = process.env.SPORTMONKS_API_TOKEN;
  if (!token) {
    throw new Error(
      "SPORTMONKS_API_TOKEN is not set. Define it in .env.local (see .env.example).",
    );
  }
  return token;
}

const sportMonksClient = createProviderClient({
  name: PROVIDER_NAME,
  concurrency: 2,
  // Estimativa CONSERVADORA do trial (limite por entidade/hora) — validar os headers
  // de rate-limit reais quando a key existir.
  throttle: { maxRequests: 6, windowMs: ONE_MINUTE },
  quotaHeaders: {
    daily: "X-RateLimit-Remaining",
    dailyLimit: "X-RateLimit-Limit",
  },
});

// Shape MÍNIMO do `sidelined` (inferido dos docs v3): cada entrada traz o player, o
// type (model_type distingue injury/suspension; name = motivo legível) e a category
// (→ status). Tolerante (campos extras ignorados).
const SidelinedEntrySchema = z.object({
  player: z.object({ name: z.string().min(1) }).optional(),
  type: z
    .object({
      name: z.string().optional(),
      model_type: z.string().optional(),
    })
    .optional(),
  category: z.string().optional(),
});
const SidelinedResponseSchema = z.object({
  data: z
    .object({
      sidelined: z.array(z.unknown()).optional(),
    })
    .optional(),
});

function mapStatus(category: string | undefined): NormalizedInjury["status"] {
  const c = (category ?? "").toLowerCase();
  if (c.includes("suspen")) return "suspended";
  if (c.includes("doubt")) return "doubtful";
  return "injured";
}

// Normaliza UMA entrada `sidelined` → NormalizedInjury com source:"official".
// EXPORTADA pra teste (a parte verificável; o fio HTTP é best-effort sem key).
export function normalizeSidelined(raw: unknown): NormalizedInjury | null {
  const parsed = SidelinedEntrySchema.safeParse(raw);
  if (!parsed.success || !parsed.data.player?.name) return null;
  const { player, type, category } = parsed.data;
  const isSuspension =
    type?.model_type?.toLowerCase().includes("suspension") ||
    (category ?? "").toLowerCase().includes("suspen");
  return {
    player: { name: player.name },
    type: isSuspension ? "suspension" : "injury",
    reason: type?.name,
    status: mapStatus(category),
    source: "official",
  };
}

function wrapError(err: unknown, endpoint: string): never {
  if (err instanceof RetryableHttpError || err instanceof HttpClientTimeoutError) {
    throw new SportsDataTransientError(
      `SportMonks transient on ${endpoint}`,
      PROVIDER_NAME,
      endpoint,
      err,
    );
  }
  if (err instanceof HttpClientError) {
    // 4xx≠429 = input/config (ex.: time não-mapeado) → NotFound (bubble, NÃO
    // cascateia como outage — evita o mis-cascade do abuso de Transient, ADR 0005).
    throw new SportsDataNotFoundError(
      `SportMonks HTTP ${err.statusCode} on ${endpoint}`,
      PROVIDER_NAME,
      endpoint,
    );
  }
  throw err;
}

async function fetchTeamSidelined(team: string): Promise<NormalizedInjury[]> {
  const endpoint = `/teams/search/${encodeURIComponent(team)}`;
  // TOCTOU: o token é checado no gate (capabilities) e de novo aqui. Se sumir entre
  // os dois (env mutado), trata como TRANSIENT (cascateia/degrada) em vez de estourar
  // um Error genérico que violaria o contrato de cascata do AbsencesFallbackProvider.
  let token: string;
  try {
    token = requireSportMonksToken();
  } catch (err) {
    throw new SportsDataTransientError(
      "SPORTMONKS_API_TOKEN ausente no fetch (sumiu após o gate)",
      PROVIDER_NAME,
      endpoint,
      err,
    );
  }
  const url = new URL(SPORTMONKS_BASE_URL + endpoint);
  url.searchParams.set("api_token", token);
  url.searchParams.set("include", "sidelined.player;sidelined.type");
  let text: string;
  try {
    const r = await sportMonksClient.send({
      endpoint,
      url: url.toString(),
      init: { method: "GET", headers: { Accept: "application/json" } },
    });
    text = r.text;
  } catch (err) {
    wrapError(err, endpoint);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (jsonErr) {
    throw new SportsDataTransientError(
      `SportMonks invalid JSON on ${endpoint}`,
      PROVIDER_NAME,
      endpoint,
      jsonErr,
    );
  }
  const parsed = SidelinedResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new SportsDataTransientError(
      `SportMonks schema drift on ${endpoint}`,
      PROVIDER_NAME,
      endpoint,
      parsed.error,
    );
  }
  const entries = parsed.data.data?.sidelined ?? [];
  return entries
    .map(normalizeSidelined)
    .filter((x): x is NormalizedInjury => x !== null);
}

export class SportMonksAbsencesAdapter implements AbsencesProvider {
  // KEY-GATED: sem token, supportsAbsences=false → o cascade filtra este adapter.
  get capabilities(): ProviderCapabilities {
    return {
      name: PROVIDER_NAME,
      supportsInjuries: hasSportMonksToken(),
      supportsLineups: false,
      supportsAbsences: hasSportMonksToken(),
      supportedLeagues: SUPPORTED_LEAGUES,
    };
  }

  // sidelined é estado-corrente por time; pra um fixture, os desfalques dos dois
  // times é exatamente o que importa pro jogo. Reusa o caminho por time (sem
  // resolução de fixture-id).
  async getAbsencesByFixture(
    ref: FixtureRef,
  ): Promise<{ home: NormalizedInjury[]; away: NormalizedInjury[] }> {
    const [home, away] = await Promise.all([
      fetchTeamSidelined(ref.homeTeam),
      fetchTeamSidelined(ref.awayTeam),
    ]);
    return { home, away };
  }

  async getAbsencesByTeam(
    team: string,
    _league: SupportedLeague,
  ): Promise<NormalizedInjury[]> {
    return fetchTeamSidelined(team);
  }
}
