import { describe, expect, it } from "vitest";

import type { LiveStateInput } from "@/lib/live/phase";
import {
  POOL_EXTEND_CAP_MS,
  poolBetsOpen,
  poolEntriesRemovable,
  poolExtendable,
  poolExtensionUntil,
  poolLiveStateWanted,
  poolManualScoreAllowed,
  poolMatchEnded,
  poolWindow,
  poolWindowOpen,
} from "@/lib/pools/pool-state";

// Regras do bolão ao vivo (#580, PLAN-580 §10/§14, ADR 0060 §7). Puras, `now` injetado.

const KICKOFF = new Date("2026-10-18T19:00:00Z");
const MIN = 60_000;
const at = (minutesAfterKickoff: number) => new Date(KICKOFF.getTime() + minutesAfterKickoff * MIN);
const match = (status = "scheduled") => ({ status, kickoffAt: KICKOFF });
const LIVE = { liveMode: true };
const OFF = { liveMode: false };
const noControls = { betsClosedAt: null, betsExtendedUntil: null };

function state(
  statusShort: string | null,
  elapsed: number | null,
  fetchedAt: Date,
  extra: number | null = null,
): LiveStateInput {
  return { statusShort, elapsed, extra, fetchedAt };
}

describe("poolWindowOpen: com minuto do provider", () => {
  it("14' aberto, 15' fechado", () => {
    const now = at(20);
    expect(poolWindowOpen(match(), state("1H", 14, now), now, LIVE)).toBe(true);
    expect(poolWindowOpen(match(), state("1H", 15, now), now, LIVE)).toBe(false);
  });

  it("devolve o minuto estimado enquanto aberto", () => {
    const now = at(13);
    expect(poolWindow(match(), state("1H", 12, now), now, LIVE)).toEqual({
      kind: "minute",
      estimatedMinute: 12,
    });
  });

  it("intervalo e 2º tempo: fechado", () => {
    const now = at(50);
    expect(poolWindowOpen(match(), state("HT", 45, now), now, LIVE)).toBe(false);
    expect(poolWindowOpen(match(), state("2H", 46, now), now, LIVE)).toBe(false);
  });

  it("estado velho é extrapolado pela idade (now − fetchedAt)", () => {
    // 10' lido há 4 min = 14' estimado (aberto); há 5 min = 15' (fechado).
    expect(poolWindowOpen(match(), state("1H", 10, at(12)), at(16), LIVE)).toBe(true);
    expect(poolWindowOpen(match(), state("1H", 10, at(12)), at(17), LIVE)).toBe(false);
    // Aos 14:30 estimados ainda aberto.
    expect(
      poolWindowOpen(match(), state("1H", 10, at(12)), new Date(at(16).getTime() + 30_000), LIVE),
    ).toBe(true);
  });

  it("atraso (NS depois do horário) fica aberto: o corte é de minuto jogado", () => {
    const now = at(40);
    const fresh = state("NS", null, new Date(now.getTime() - 30_000));
    expect(poolWindowOpen(match(), fresh, now, LIVE)).toBe(true);
    expect(poolWindowOpen(match("live"), fresh, now, LIVE)).toBe(true);
  });

  it("NS velho: a extrapolação supõe que a bola rolou na leitura", () => {
    expect(poolWindowOpen(match(), state("NS", null, at(5)), at(19), LIVE)).toBe(true);
    expect(poolWindowOpen(match(), state("NS", null, at(5)), at(20), LIVE)).toBe(false);
  });

  it("prorrogação, interrupção e terminais: fechado", () => {
    const now = at(10);
    for (const s of ["ET", "BT", "P", "INT", "SUSP", "FT", "AET", "PEN", "PST", "CANC", "ABD"]) {
      expect(poolWindowOpen(match(), state(s, 5, now), now, LIVE)).toBe(false);
    }
  });
});

describe("poolWindowOpen: sem minuto, pelo relógio (apito + 15 min)", () => {
  const justBefore = new Date(at(15).getTime() - 1_000); // 14:59

  it("sem estado: 14:59 aberto, 15:00 fechado", () => {
    expect(poolWindowOpen(match(), null, justBefore, LIVE)).toBe(true);
    expect(poolWindowOpen(match(), null, at(15), LIVE)).toBe(false);
    expect(poolWindow(match(), null, at(3), LIVE)).toEqual({ kind: "clock", closesAt: at(15) });
  });

  it("estado sem elapsed, LIVE, status desconhecido ou nunca lido: relógio", () => {
    for (const s of [
      state("1H", null, at(1)),
      state("LIVE", 30, at(1)),
      state("XYZ", 3, at(1)),
      { statusShort: null, elapsed: null, extra: null, fetchedAt: null },
    ]) {
      expect(poolWindowOpen(match(), s, justBefore, LIVE)).toBe(true);
      expect(poolWindowOpen(match(), s, at(15), LIVE)).toBe(false);
    }
  });

  it("jogo `live` no DB sem estado: relógio", () => {
    expect(poolWindowOpen(match("live"), null, at(10), LIVE)).toBe(true);
    expect(poolWindowOpen(match("live"), null, at(15), LIVE)).toBe(false);
  });
});

describe("poolWindowOpen: pré-jogo, DB terminal e flag", () => {
  it("antes do apito: aberto com ou sem modo ao vivo", () => {
    expect(poolWindow(match(), null, at(-1), LIVE)).toEqual({ kind: "pre" });
    expect(poolWindowOpen(match(), null, at(-1), OFF)).toBe(true);
  });

  it.each(["postponed", "cancelled", "finished"])("%s no DB: fechado", (status) => {
    expect(poolWindowOpen(match(status), state("1H", 3, at(3)), at(3), LIVE)).toBe(false);
  });

  it("flag OFF: fecha no apito (hoje), mesmo com estado aos 3'", () => {
    expect(poolWindowOpen(match(), state("1H", 3, at(3)), at(3), OFF)).toBe(false);
    expect(poolWindowOpen(match(), null, KICKOFF, OFF)).toBe(false);
    // Sem opções = flag OFF.
    expect(poolWindowOpen(match(), null, at(1))).toBe(false);
  });
});

describe("poolBetsOpen: dono e admin", () => {
  it("sem controles = a janela", () => {
    expect(poolBetsOpen(noControls, match(), state("1H", 10, at(11)), at(11), LIVE)).toBe(true);
    expect(poolBetsOpen(noControls, match(), state("1H", 16, at(17)), at(17), LIVE)).toBe(false);
  });

  it("dono fechou: fechado, inclusive antes do apito", () => {
    const pool = { betsClosedAt: at(5), betsExtendedUntil: null };
    expect(poolBetsOpen(pool, match(), state("1H", 4, at(5)), at(5), LIVE)).toBe(false);
    expect(poolBetsOpen({ betsClosedAt: at(-30) }, match(), null, at(-10), LIVE)).toBe(false);
  });

  it("admin estendeu: aberto até o prazo, no 2º tempo também", () => {
    const pool = { betsClosedAt: null, betsExtendedUntil: at(70) };
    expect(poolBetsOpen(pool, match(), state("2H", 60, at(60)), at(60), LIVE)).toBe(true);
    expect(poolBetsOpen(pool, match(), state("2H", 70, at(70)), at(70), LIVE)).toBe(false);
  });

  it("extensão vencida volta para a janela (nunca encurta)", () => {
    const pool = { betsExtendedUntil: at(2) };
    expect(poolBetsOpen(pool, match(), state("1H", 9, at(10)), at(10), LIVE)).toBe(true);
  });

  it("estendido mas o jogo acabou (estado ou DB): fechado", () => {
    const pool = { betsExtendedUntil: at(150) };
    expect(poolBetsOpen(pool, match(), state("FT", 90, at(110)), at(110), LIVE)).toBe(false);
    expect(poolBetsOpen(pool, match("finished"), null, at(110), LIVE)).toBe(false);
    expect(poolBetsOpen(pool, match("cancelled"), null, at(30), LIVE)).toBe(false);
  });

  it("flag OFF ignora a extensão", () => {
    const pool = { betsExtendedUntil: at(60) };
    expect(poolBetsOpen(pool, match(), null, at(30), OFF)).toBe(false);
  });
});

describe("poolEntriesRemovable: só antes do apito", () => {
  it("pré-jogo: pode tirar", () => {
    expect(poolEntriesRemovable(match(), at(-1))).toBe(true);
  });

  it("falso em toda fase depois do apito, mesmo com as apostas abertas", () => {
    expect(poolEntriesRemovable(match(), KICKOFF)).toBe(false);
    for (const status of ["scheduled", "live", "finished", "postponed", "cancelled"]) {
      expect(poolEntriesRemovable(match(status), at(3))).toBe(false);
    }
    // Aos 3' com o bolão aberto ao vivo: anotar sim, tirar não.
    expect(poolBetsOpen(noControls, match(), state("1H", 3, at(3)), at(3), LIVE)).toBe(true);
    expect(poolEntriesRemovable(match(), at(3))).toBe(false);
  });
});

describe("poolManualScoreAllowed", () => {
  it("só depois do apito e com as apostas fechadas", () => {
    expect(poolManualScoreAllowed(noControls, match(), null, at(-5), LIVE)).toBe(false);
    expect(poolManualScoreAllowed(noControls, match(), null, at(5), LIVE)).toBe(false);
    expect(poolManualScoreAllowed(noControls, match(), null, at(20), LIVE)).toBe(true);
    // Dono fechou antes do apito: o placar ainda espera o jogo.
    expect(poolManualScoreAllowed({ betsClosedAt: at(-30) }, match(), null, at(-5), LIVE)).toBe(
      false,
    );
    // Flag OFF: como hoje, logo depois do apito.
    expect(poolManualScoreAllowed(noControls, match(), null, at(1), OFF)).toBe(true);
  });
});

describe("extensão do admin: prazo e teto", () => {
  it("+15/+30/+60 a partir de agora, com teto no apito + 3h", () => {
    expect(poolExtensionUntil(match(), at(20), 15)).toEqual(at(35));
    expect(poolExtensionUntil(match(), at(20), 60)).toEqual(at(80));
    expect(poolExtensionUntil(match(), at(170), 30)).toEqual(
      new Date(KICKOFF.getTime() + POOL_EXTEND_CAP_MS),
    );
    expect(poolExtensionUntil(match(), at(180), 15)).toBeNull();
  });

  it("poolExtendable: flag ligada, jogo não terminado, antes do teto", () => {
    expect(poolExtendable(match(), state("2H", 60, at(60)), at(60), LIVE)).toBe(true);
    expect(poolExtendable(match(), state("FT", 90, at(110)), at(110), LIVE)).toBe(false);
    expect(poolExtendable(match(), null, at(180), LIVE)).toBe(false);
    expect(poolExtendable(match(), null, at(30), OFF)).toBe(false);
  });

  it("poolMatchEnded: DB ou estado terminal", () => {
    expect(poolMatchEnded(match("finished"), null, at(100))).toBe(true);
    expect(poolMatchEnded(match(), state("PEN", 120, at(130)), at(130))).toBe(true);
    expect(poolMatchEnded(match(), state("ET", 95, at(100)), at(100))).toBe(false);
    expect(poolMatchEnded(match(), null, at(100))).toBe(false);
  });
});

describe("poolLiveStateWanted (detalhe do bolão)", () => {
  it("antes do apito ou com a flag desligada: não busca", () => {
    expect(poolLiveStateWanted(noControls, match(), null, at(-1), LIVE)).toBe(false);
    expect(poolLiveStateWanted(noControls, match(), null, at(3), OFF)).toBe(false);
  });

  it("enquanto pode estar aberto: busca; depois do corte: não", () => {
    expect(poolLiveStateWanted(noControls, match(), null, at(3), LIVE)).toBe(true);
    expect(poolLiveStateWanted(noControls, match(), state("1H", 10, at(10)), at(10), LIVE)).toBe(
      true,
    );
    expect(poolLiveStateWanted(noControls, match(), state("2H", 50, at(65)), at(65), LIVE)).toBe(
      false,
    );
    expect(poolLiveStateWanted(noControls, match(), null, at(20), LIVE)).toBe(false);
  });

  it("dono fechou: não busca; extensão valendo: busca", () => {
    expect(poolLiveStateWanted({ betsClosedAt: at(2) }, match(), null, at(3), LIVE)).toBe(false);
    expect(
      poolLiveStateWanted({ betsExtendedUntil: at(90) }, match(), state("2H", 60, at(75)), at(75), LIVE),
    ).toBe(true);
  });

  it("atraso NS velho: busca mesmo com a extrapolação fechada", () => {
    expect(poolLiveStateWanted(noControls, match(), state("NS", null, at(1)), at(30), LIVE)).toBe(
      true,
    );
  });
});
