export const FOOTBALL_DATA_ORG_BASE_URL = "https://api.football-data.org/v4";

// football-data.org v4 status values per docs (Match resource):
// SCHEDULED | LIVE | IN_PLAY | PAUSED | FINISHED | POSTPONED | SUSPENDED |
// CANCELLED | AWARDED.
import type { NormalizedFixtureStatus } from "@/lib/providers/sports-data/types";

const STATUS_MAP: Record<string, NormalizedFixtureStatus> = {
  SCHEDULED: "scheduled",
  TIMED: "scheduled",
  LIVE: "live",
  IN_PLAY: "live",
  PAUSED: "live",
  FINISHED: "finished",
  AWARDED: "finished",
  POSTPONED: "postponed",
  SUSPENDED: "postponed",
  CANCELLED: "cancelled",
};

export function mapFootballDataOrgStatus(s: string): NormalizedFixtureStatus {
  return STATUS_MAP[s] ?? "other";
}
