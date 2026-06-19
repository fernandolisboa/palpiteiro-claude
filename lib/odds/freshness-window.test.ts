import { describe, it, expect } from "vitest";

import {
  KICKOFF_FAR_THRESHOLD_MS,
  ODDS_SNAPSHOT_FRESHNESS_FAR_MS,
  ODDS_SNAPSHOT_FRESHNESS_MS,
  oddsFreshnessMsForKickoff,
} from "@/lib/odds/freshness-window";
import { CLV_CAPTURE_LOOKAHEAD_MS } from "@/lib/odds/clv-window";

// oddsFreshnessMsForKickoff é PURA (now injetável). A janela larga (60min) só vale
// pra jogos distantes (>24h); o piso (30min) cobre os iminentes — incluindo, por
// construção, o conjunto de captura do CLV (KO ≤90min). O cutoff de 24h NUNCA pode
// descer abaixo do CLV_CAPTURE_LOOKAHEAD_MS (90min), senão um snapshot de 31-59min
// seria "fresco", o fetch de fechamento seria pulado e o CLV degradaria pra ≈0.
describe("oddsFreshnessMsForKickoff", () => {
  const now = new Date("2026-05-15T12:00:00Z");

  it("KO a mais de 24h → janela larga (60min)", () => {
    const kickoff = new Date(now.getTime() + KICKOFF_FAR_THRESHOLD_MS + 60_000);
    expect(oddsFreshnessMsForKickoff(kickoff, now)).toBe(
      ODDS_SNAPSHOT_FRESHNESS_FAR_MS,
    );
  });

  it("KO dentro de 24h → piso (30min)", () => {
    const kickoff = new Date(now.getTime() + 6 * 60 * 60 * 1000); // 6h
    expect(oddsFreshnessMsForKickoff(kickoff, now)).toBe(
      ODDS_SNAPSHOT_FRESHNESS_MS,
    );
  });

  it("KO exatamente em 24h → piso (30min, boundary `>` estrito)", () => {
    const kickoff = new Date(now.getTime() + KICKOFF_FAR_THRESHOLD_MS);
    expect(oddsFreshnessMsForKickoff(kickoff, now)).toBe(
      ODDS_SNAPSHOT_FRESHNESS_MS,
    );
  });

  it("KO em 90min (boundary de captura do CLV) → piso (30min): protege a closing line", () => {
    const kickoff = new Date(now.getTime() + CLV_CAPTURE_LOOKAHEAD_MS); // 90min
    expect(oddsFreshnessMsForKickoff(kickoff, now)).toBe(
      ODDS_SNAPSHOT_FRESHNESS_MS,
    );
    // Invariante explícita: o cutoff de "distante" tem que ficar acima da janela de
    // captura do CLV, senão a janela larga vazaria pro conjunto de fechamento.
    expect(KICKOFF_FAR_THRESHOLD_MS).toBeGreaterThan(CLV_CAPTURE_LOOKAHEAD_MS);
  });

  it("kickoff undefined → piso (30min, back-compat)", () => {
    expect(oddsFreshnessMsForKickoff(undefined, now)).toBe(
      ODDS_SNAPSHOT_FRESHNESS_MS,
    );
  });
});
