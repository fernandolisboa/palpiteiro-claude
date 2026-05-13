import type { matchStatusEnum } from "@/db/schema";

export const API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io";

// Confirmed via API-Football v3 docs. Brasileirão Série A = 71, UEFA UCL = 2.
export const LEAGUE_IDS = {
  BRASILEIRAO_A: 71,
  CHAMPIONS_LEAGUE: 2,
} as const;

export type LeagueId = (typeof LEAGUE_IDS)[keyof typeof LEAGUE_IDS];

type MatchStatus = (typeof matchStatusEnum.enumValues)[number];

// API-Football fixture short codes documented at /fixtures endpoint.
const SCHEDULED_CODES = new Set(["TBD", "NS"]);
const LIVE_CODES = new Set([
  "1H",
  "HT",
  "2H",
  "ET",
  "BT",
  "P",
  "LIVE",
  "INT",
  "SUSP",
]);
const FINISHED_CODES = new Set(["FT", "AET", "PEN", "AWD", "WO"]);
const POSTPONED_CODES = new Set(["PST"]);
const CANCELLED_CODES = new Set(["CANC", "ABD"]);

export function mapApiFootballStatus(short: string): MatchStatus {
  if (SCHEDULED_CODES.has(short)) return "scheduled";
  if (LIVE_CODES.has(short)) return "live";
  if (FINISHED_CODES.has(short)) return "finished";
  if (POSTPONED_CODES.has(short)) return "postponed";
  if (CANCELLED_CODES.has(short)) return "cancelled";
  // Unknown code — treat as scheduled so the downstream sync keeps the fixture
  // available; the next refresh will get an updated status.
  return "scheduled";
}

export function isFinishedStatus(short: string): boolean {
  return FINISHED_CODES.has(short) || CANCELLED_CODES.has(short);
}
