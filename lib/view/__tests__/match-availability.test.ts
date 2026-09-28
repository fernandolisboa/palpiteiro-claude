import { describe, expect, it } from "vitest";

import {
  EMPTY_HERO_UNAVAILABLE_COPY,
  matchUnavailableReason,
  unavailableNoticeCopy,
} from "@/lib/view/match-availability";

const NOW = new Date("2026-09-28T20:00:00.000Z");
const FUTURE = new Date(NOW.getTime() + 60 * 1000);
const PAST = new Date(NOW.getTime() - 60 * 1000);

describe("matchUnavailableReason", () => {
  it("scheduled com kickoff no futuro → analisável (null)", () => {
    expect(matchUnavailableReason("scheduled", FUTURE, NOW)).toBeNull();
  });

  it("scheduled já apitado (enum stale até o cron virar) → ao vivo, não encerrado", () => {
    expect(matchUnavailableReason("scheduled", PAST, NOW)).toBe("live");
    expect(matchUnavailableReason("scheduled", NOW, NOW)).toBe("live");
  });

  it("scheduled sem kickoff (caminho de race) → decide só pelo status", () => {
    expect(matchUnavailableReason("scheduled", undefined, NOW)).toBeNull();
  });

  it.each(["live", "postponed", "cancelled", "finished"] as const)(
    "%s → o próprio motivo, qualquer kickoff",
    (status) => {
      expect(matchUnavailableReason(status, FUTURE, NOW)).toBe(status);
      expect(matchUnavailableReason(status, PAST, NOW)).toBe(status);
    }
  );

  it("status desconhecido → encerrado (fail-closed)", () => {
    expect(matchUnavailableReason("", undefined, NOW)).toBe("finished");
    expect(matchUnavailableReason("abandoned", FUTURE, NOW)).toBe("finished");
  });
});

describe("copy por motivo", () => {
  it("só encerrado e cancelado dizem que acabou", () => {
    expect(EMPTY_HERO_UNAVAILABLE_COPY.finished).toBe(
      "Jogo encerrado, sem palpite por aqui."
    );
    expect(EMPTY_HERO_UNAVAILABLE_COPY.cancelled).toContain("cancelado");
    expect(EMPTY_HERO_UNAVAILABLE_COPY.live).toContain("em andamento");
    expect(EMPTY_HERO_UNAVAILABLE_COPY.postponed).toContain("adiado");
    for (const reason of ["live", "postponed"] as const) {
      expect(EMPTY_HERO_UNAVAILABLE_COPY[reason]).not.toMatch(
        /encerrado|cancelado/
      );
      const { label, detail } = unavailableNoticeCopy(reason, null);
      expect(`${label} ${detail}`).not.toMatch(/encerrado|cancelado/);
    }
  });

  it("aviso do encerrado mostra o placar quando há", () => {
    expect(unavailableNoticeCopy("finished", { home: 2, away: 1 })).toEqual({
      label: "jogo encerrado",
      detail:
        "Placar final 2–1. Análise indisponível para jogos já encerrados.",
    });
    expect(unavailableNoticeCopy("finished", null).detail).toBe(
      "Análise indisponível para jogos já encerrados."
    );
  });

  it("cancelado tem rótulo próprio, sem placar", () => {
    expect(unavailableNoticeCopy("cancelled", { home: 0, away: 0 })).toEqual({
      label: "jogo cancelado",
      detail: "Análise indisponível para jogos cancelados.",
    });
  });
});
