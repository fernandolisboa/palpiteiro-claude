import { describe, expect, it } from "vitest";

import type { LiveStateInput } from "@/lib/live/phase";
import {
  POOL_EXTEND_CAP_MS,
  poolBetsOpen,
  poolEntriesRemovable,
  poolExtendable,
  poolExtensionUntil,
  poolHasResult,
  poolLiveStateWanted,
  poolManualScoreAllowed,
  poolMatchEnded,
  poolExtendCap,
  poolOpenUntilEnd,
  poolOwnerClosable,
  poolOwnerReopenable,
  poolReopenNeedsFreshState,
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
    expect(poolExtendable(noControls, match(), state("2H", 60, at(60)), at(60), LIVE)).toBe(true);
    expect(poolExtendable(noControls, match(), state("FT", 90, at(110)), at(110), LIVE)).toBe(
      false,
    );
    expect(poolExtendable(noControls, match(), null, at(180), LIVE)).toBe(false);
    expect(poolExtendable(noControls, match(), null, at(30), OFF)).toBe(false);
  });

  it("poolExtendable: antes do apito não estende (as apostas já estão abertas)", () => {
    expect(poolExtendable(noControls, match(), null, at(-10), LIVE)).toBe(false);
    expect(poolExtendable({ betsClosedAt: at(-30) }, match(), null, at(-10), LIVE)).toBe(false);
    expect(poolExtendable(noControls, match(), null, KICKOFF, LIVE)).toBe(true);
  });

  it("dono fechou e lançou 2-1: estender recusado e anotar recusado", () => {
    const pool = { betsClosedAt: at(5), manualHomeScore: 2, manualAwayScore: 1 };
    const now = at(30);
    expect(poolHasResult(pool, match())).toBe(true);
    expect(poolExtendable(pool, match(), null, now, LIVE)).toBe(false);
    // Mesmo com uma extensão valendo (gravada antes do placar), anotar fica fechado.
    const extended = { ...pool, betsClosedAt: null, betsExtendedUntil: at(60) };
    expect(poolBetsOpen(extended, match(), null, now, LIVE)).toBe(false);
    // O placar manual continua editável.
    expect(poolManualScoreAllowed(extended, match(), null, now, LIVE)).toBe(true);
  });

  it("poolHasResult: manual vence; jogo encerrado com placar; sem nada, não", () => {
    expect(poolHasResult(noControls, match())).toBe(false);
    expect(poolHasResult({ manualHomeScore: 1, manualAwayScore: null }, match())).toBe(false);
    expect(
      poolHasResult(noControls, { ...match("finished"), homeScore: 0, awayScore: 0 }),
    ).toBe(true);
    expect(poolHasResult(noControls, match("finished"))).toBe(false);
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

describe("poolOwnerClosable (fechar apostas do dono)", () => {
  it("modo ao vivo e apostas abertas: pode fechar (antes ou depois do apito)", () => {
    expect(poolOwnerClosable(noControls, match(), null, at(-10), LIVE)).toBe(true);
    expect(poolOwnerClosable(noControls, match(), state("1H", 5, at(5)), at(5), LIVE)).toBe(true);
  });

  it("flag OFF: sem o controle, mesmo antes do apito (como antes)", () => {
    expect(poolOwnerClosable(noControls, match(), null, at(-10), OFF)).toBe(false);
    expect(poolOwnerClosable(noControls, match(), null, at(-10))).toBe(false);
  });

  it("já fechadas ou com resultado: não", () => {
    expect(poolOwnerClosable({ betsClosedAt: at(-20) }, match(), null, at(-10), LIVE)).toBe(false);
    expect(poolOwnerClosable(noControls, match(), null, at(20), LIVE)).toBe(false);
  });
});

describe("poolOwnerReopenable (reabrir apostas do dono, #601)", () => {
  const CAP = new Date(KICKOFF.getTime() + POOL_EXTEND_CAP_MS);
  // O que o "reabrir" grava: extensão até o teto, fechamento limpo.
  const reopened = { betsClosedAt: null, betsExtendedUntil: CAP };

  it("fechado pelo corte dos 15': reabre", () => {
    expect(poolOwnerReopenable(noControls, match(), state("1H", 20, at(20)), at(20), LIVE)).toBe(
      true,
    );
    expect(poolOwnerReopenable(noControls, match(), null, at(20), LIVE)).toBe(true);
    expect(poolOwnerReopenable(noControls, match(), state("HT", 45, at(50)), at(50), LIVE)).toBe(
      true,
    );
  });

  it("fechado pelo dono ou por extensão vencida: reabre", () => {
    expect(
      poolOwnerReopenable({ betsClosedAt: at(5) }, match(), state("1H", 6, at(6)), at(6), LIVE),
    ).toBe(true);
    expect(
      poolOwnerReopenable(
        { betsExtendedUntil: at(40) },
        match(),
        state("2H", 50, at(65)),
        at(65),
        LIVE,
      ),
    ).toBe(true);
  });

  it("apostas abertas (janela ou extensão valendo): não há o que reabrir", () => {
    expect(poolOwnerReopenable(noControls, match(), state("1H", 10, at(10)), at(10), LIVE)).toBe(
      false,
    );
    expect(
      poolOwnerReopenable({ betsExtendedUntil: at(90) }, match(), state("2H", 60, at(75)), at(75), LIVE),
    ).toBe(false);
    expect(poolOwnerReopenable(reopened, match(), state("2H", 60, at(75)), at(75), LIVE)).toBe(
      false,
    );
  });

  it("antes do apito, fechado pelo dono: reabre e volta a janela de sempre", () => {
    const closed = { betsClosedAt: at(-30), betsExtendedUntil: null };
    expect(poolBetsOpen(closed, match(), null, at(-10), LIVE)).toBe(false);
    expect(poolOwnerReopenable(closed, match(), null, at(-10), LIVE)).toBe(true);
    // O que a action grava antes do apito: só o fechamento limpo, sem extensão.
    expect(poolBetsOpen(noControls, match(), null, at(-10), LIVE)).toBe(true);
    expect(poolBetsOpen(noControls, match(), state("1H", 16, at(16)), at(16), LIVE)).toBe(false);
  });

  it("antes do apito sem o dono ter fechado, com a flag desligada ou com resultado: não", () => {
    expect(poolOwnerReopenable(noControls, match(), null, at(-10), LIVE)).toBe(false);
    // Flag desligada: sem controle, como antes (antes ou depois do apito).
    expect(poolOwnerReopenable({ betsClosedAt: at(-30) }, match(), null, at(-10), OFF)).toBe(
      false,
    );
    expect(poolOwnerReopenable({ betsClosedAt: at(-30) }, match(), null, at(-10))).toBe(false);
    expect(
      poolOwnerReopenable(
        { betsClosedAt: at(-30), manualHomeScore: 1, manualAwayScore: 0 },
        match(),
        null,
        at(-10),
        LIVE,
      ),
    ).toBe(false);
    expect(poolOwnerReopenable(noControls, match(), null, at(30), OFF)).toBe(false);
    expect(poolOwnerReopenable({ betsClosedAt: at(-30) }, match(), null, at(30))).toBe(false);
    const scored = { betsClosedAt: at(5), manualHomeScore: 2, manualAwayScore: 1 };
    expect(poolOwnerReopenable(scored, match(), null, at(30), LIVE)).toBe(false);
  });

  it("jogo terminado (estado ou DB) ou no teto (apito + 3h): não", () => {
    expect(poolOwnerReopenable(noControls, match(), state("FT", 90, at(110)), at(110), LIVE)).toBe(
      false,
    );
    expect(poolOwnerReopenable(noControls, match("finished"), null, at(110), LIVE)).toBe(false);
    expect(poolOwnerReopenable(noControls, match("cancelled"), null, at(30), LIVE)).toBe(false);
    expect(poolOwnerReopenable(noControls, match(), null, at(179), LIVE)).toBe(true);
    expect(poolOwnerReopenable(noControls, match(), null, at(180), LIVE)).toBe(false);
  });

  it("reaberto: aberto no 2º tempo até o jogo acabar ou o teto, e o dono pode fechar", () => {
    expect(poolExtendCap(match())).toEqual(CAP);
    expect(poolOpenUntilEnd(reopened, match())).toBe(true);
    expect(poolOpenUntilEnd({ betsExtendedUntil: at(90) }, match())).toBe(false);
    expect(poolBetsOpen(reopened, match(), state("2H", 80, at(100)), at(100), LIVE)).toBe(true);
    expect(poolOwnerClosable(reopened, match(), state("2H", 80, at(100)), at(100), LIVE)).toBe(
      true,
    );
    expect(poolBetsOpen(reopened, match(), state("FT", 90, at(112)), at(112), LIVE)).toBe(false);
    expect(poolBetsOpen(reopened, match(), null, at(180), LIVE)).toBe(false);
    // Flag desligada: a extensão não vale (kill-switch), fecha como antes.
    expect(poolBetsOpen(reopened, match(), null, at(100), OFF)).toBe(false);
  });

  it("fechar e reabrir se alternam", () => {
    // Reaberto aos 30', fechado aos 60' (o fechar limpa a extensão), reabre aos 61'.
    const closedAgain = { betsClosedAt: at(60), betsExtendedUntil: null };
    expect(poolBetsOpen(closedAgain, match(), state("2H", 61, at(76)), at(76), LIVE)).toBe(false);
    expect(poolOwnerReopenable(closedAgain, match(), state("2H", 61, at(76)), at(76), LIVE)).toBe(
      true,
    );
  });

  it("reaberto: tirar aposta segue bloqueado e o placar manual espera fechar", () => {
    expect(poolEntriesRemovable(match(), at(100))).toBe(false);
    expect(poolManualScoreAllowed(reopened, match(), null, at(100), LIVE)).toBe(false);
  });

  it("poolLiveStateWanted: reaberto busca; reaberto com o jogo terminado, não", () => {
    expect(poolLiveStateWanted(reopened, match(), state("2H", 60, at(75)), at(75), LIVE)).toBe(
      true,
    );
    expect(poolLiveStateWanted(reopened, match(), null, at(100), LIVE)).toBe(true);
    expect(poolLiveStateWanted(reopened, match(), state("FT", 90, at(112)), at(115), LIVE)).toBe(
      false,
    );
  });
});

describe("poolReopenNeedsFreshState (reabrir perto do fim, #601)", () => {
  it("até o apito + 105 min: não pede estado novo", () => {
    expect(poolReopenNeedsFreshState(match(), null, at(30))).toBe(false);
    expect(poolReopenNeedsFreshState(match(), state("1H", 20, at(20)), at(105))).toBe(false);
  });

  it("depois do apito + 105 min: sem estado ou estado com mais de 2 min, pede", () => {
    expect(poolReopenNeedsFreshState(match(), null, at(106))).toBe(true);
    // Cota baixa ou busca falhou: a row velha ainda diz 2º tempo.
    expect(poolReopenNeedsFreshState(match(), state("2H", 80, at(95)), at(110))).toBe(true);
    expect(
      poolReopenNeedsFreshState(match(), { ...state("2H", 80, at(95)), fetchedAt: null }, at(110)),
    ).toBe(true);
  });

  it("depois do apito + 105 min: estado de até 2 min vale", () => {
    expect(poolReopenNeedsFreshState(match(), state("2H", 88, at(108)), at(110))).toBe(false);
  });
});
