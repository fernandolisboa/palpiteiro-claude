import { describe, expect, it } from "vitest";

import { MAX_SLIP_SELECTIONS } from "@/lib/bets/slip-markets";
import { MAX_STAKE_UNITS, parseSlipPayload } from "@/lib/bets/slip-schema";

const MATCH_ID = "550e8400-e29b-41d4-a716-446655440000";
const AI_CALL_ID = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";

const HOME = { kind: "match_result", params: { selection: "home" } };
const OVER = { kind: "over_under", params: { selection: "over", line: 2.5 } };
const BTTS = { kind: "btts", params: { selection: "yes" } };

function payload(over: Record<string, unknown> = {}) {
  return { matchId: MATCH_ID, mode: "simples", legs: [HOME], ...over };
}

function ok(raw: unknown) {
  const res = parseSlipPayload(raw);
  if (!res.ok) throw new Error(`esperava ok, veio ${res.error}`);
  return res.slip;
}

function err(raw: unknown) {
  const res = parseSlipPayload(raw);
  if (res.ok) throw new Error("esperava erro");
  return res.error;
}

describe("parseSlipPayload — payloads válidos", () => {
  it("simples: odd/stake PT-BR viram número, campos opcionais viram null", () => {
    const slip = ok(
      payload({
        legs: [
          { ...HOME, userOdd: "2,10", stakeUnits: "1,5" },
          { ...OVER, userOdd: "1.85" },
        ],
      })
    );
    expect(slip).toEqual({
      matchId: MATCH_ID,
      mode: "simples",
      legs: [
        {
          kind: "match_result",
          params: { selection: "home" },
          userOdd: 2.1,
          stakeUnits: 1.5,
        },
        {
          kind: "over_under",
          params: { selection: "over", line: 2.5 },
          userOdd: 1.85,
          stakeUnits: null,
        },
      ],
      comboUserOdd: null,
      comboStakeUnits: null,
      rawInput: null,
      parseAiCallId: null,
      gridLive: false,
    });
  });

  it("combinada: odd e stake da combinada valem", () => {
    const slip = ok(
      payload({
        mode: "combinada",
        legs: [HOME, OVER, BTTS],
        comboUserOdd: "4,25",
        comboStakeUnits: "2",
        rawInput: "flamengo vence e over 2.5",
        parseAiCallId: AI_CALL_ID,
      })
    );
    expect(slip.mode).toBe("combinada");
    expect(slip.legs).toHaveLength(3);
    expect(slip.comboUserOdd).toBe(4.25);
    expect(slip.comboStakeUnits).toBe(2);
    expect(slip.rawInput).toBe("flamengo vence e over 2.5");
    expect(slip.parseAiCallId).toBe(AI_CALL_ID);
  });

  it("perna sem odd é aceita (userOdd ausente)", () => {
    const slip = ok(payload());
    expect(slip.legs[0].userOdd).toBeUndefined();
    expect(slip.legs[0].stakeUnits).toBeNull();
  });

  it("cartões/escanteios são aceitos como perna", () => {
    const slip = ok(
      payload({
        legs: [{ kind: "cards", params: { selection: "over", line: 4.5 } }],
      })
    );
    expect(slip.legs[0].kind).toBe("cards");
  });

  it("odd/stake da combinada são descartados no modo simples", () => {
    const slip = ok(payload({ comboUserOdd: "3,5", comboStakeUnits: "2" }));
    expect(slip.comboUserOdd).toBeNull();
    expect(slip.comboStakeUnits).toBeNull();
  });
});

describe("parseSlipPayload — envelope fail-closed", () => {
  it("chave desconhecida no envelope → payload", () => {
    expect(err(payload({ hack: true }))).toBe("payload");
  });

  it("chave desconhecida na perna → perna", () => {
    expect(err(payload({ legs: [{ ...HOME, evil: 1 }] }))).toBe("perna");
  });

  it("kind desconhecido ou params inválidos → perna", () => {
    expect(err(payload({ legs: [{ kind: "handicap", params: {} }] }))).toBe(
      "perna"
    );
    expect(
      err(
        payload({
          legs: [
            { kind: "over_under", params: { selection: "over", line: 2 } },
          ],
        })
      )
    ).toBe("perna");
  });

  it("matchId que não é uuid → payload", () => {
    expect(err(payload({ matchId: "nope" }))).toBe("payload");
  });

  it("modo desconhecido → payload", () => {
    expect(err(payload({ mode: "sistema" }))).toBe("payload");
  });

  it("não-objeto → payload", () => {
    expect(err(null)).toBe("payload");
    expect(err("x")).toBe("payload");
  });

  it("sem pernas → payload", () => {
    expect(err(payload({ legs: [] }))).toBe("payload");
  });

  it(`mais de ${MAX_SLIP_SELECTIONS} pernas → payload`, () => {
    const legs = Array.from({ length: MAX_SLIP_SELECTIONS + 1 }, (_, i) => ({
      kind: "exact_score",
      params: { home: i, away: 0 },
    }));
    expect(err(payload({ legs }))).toBe("payload");
    expect(
      ok(payload({ legs: legs.slice(0, MAX_SLIP_SELECTIONS) })).legs
    ).toHaveLength(MAX_SLIP_SELECTIONS);
  });

  it("odd da perna ≤ 1 → perna", () => {
    expect(err(payload({ legs: [{ ...HOME, userOdd: "1,00" }] }))).toBe(
      "perna"
    );
  });

  it("odd da perna acima do teto da coluna (999,999) → perna", () => {
    expect(err(payload({ legs: [{ ...HOME, userOdd: "1001" }] }))).toBe(
      "perna"
    );
    expect(ok(payload({ legs: [{ ...HOME, userOdd: "999,999" }] })).legs[0]
      .userOdd).toBe(999.999);
  });

  it("odd combinada acima de 999,999 → payload", () => {
    expect(
      err(
        payload({ mode: "combinada", legs: [HOME, OVER], comboUserOdd: "1000" })
      )
    ).toBe("payload");
  });

  it("gridLive: booleano opcional (ausente = false); outro tipo → payload", () => {
    expect(ok(payload()).gridLive).toBe(false);
    expect(ok(payload({ gridLive: true })).gridLive).toBe(true);
    expect(ok(payload({ gridLive: false })).gridLive).toBe(false);
    expect(err(payload({ gridLive: "true" }))).toBe("payload");
  });

  it("odd combinada ≤ 1 → payload", () => {
    expect(
      err(
        payload({ mode: "combinada", legs: [HOME, OVER], comboUserOdd: "0,9" })
      )
    ).toBe("payload");
  });
});

describe("parseSlipPayload — pernas", () => {
  it("a mesma seleção duas vezes → perna-repetida (mesmo com odds diferentes)", () => {
    expect(
      err(
        payload({
          legs: [
            { ...HOME, userOdd: "2,0" },
            { ...HOME, userOdd: "2,1" },
          ],
        })
      )
    ).toBe("perna-repetida");
  });

  it("mesma linha com seleções diferentes não é repetida", () => {
    const under = {
      kind: "over_under",
      params: { selection: "under", line: 2.5 },
    };
    expect(ok(payload({ legs: [OVER, under] })).legs).toHaveLength(2);
  });

  it("combinada com 1 perna → combinada-curta", () => {
    expect(err(payload({ mode: "combinada", legs: [HOME] }))).toBe(
      "combinada-curta"
    );
  });

  it("combinada com mais de 4 pernas → combinada-longa (simples aceita)", () => {
    const legs = Array.from({ length: 5 }, (_, i) => ({
      kind: "exact_score",
      params: { home: i, away: 1 },
    }));
    expect(err(payload({ mode: "combinada", legs }))).toBe("combinada-longa");
    expect(ok(payload({ mode: "simples", legs })).legs).toHaveLength(5);
  });
});

describe("parseSlipPayload — stake em unidades", () => {
  it('decimal PT-BR "1,5" é aceito', () => {
    expect(
      ok(payload({ legs: [{ ...HOME, stakeUnits: "1,5" }] })).legs[0].stakeUnits
    ).toBe(1.5);
  });

  it(`stake no teto (${MAX_STAKE_UNITS}) é aceito`, () => {
    expect(
      ok(payload({ legs: [{ ...HOME, stakeUnits: String(MAX_STAKE_UNITS) }] }))
        .legs[0].stakeUnits
    ).toBe(MAX_STAKE_UNITS);
  });

  it.each(["0", "0,0", "-1", "100,5", "101", "abc"])(
    'stake "%s" → payload',
    (stake) => {
      expect(err(payload({ legs: [{ ...HOME, stakeUnits: stake }] }))).toBe(
        "payload"
      );
    }
  );

  it("stake da combinada fora da faixa → payload", () => {
    expect(
      err(
        payload({ mode: "combinada", legs: [HOME, OVER], comboStakeUnits: "0" })
      )
    ).toBe("payload");
    expect(
      err(
        payload({
          mode: "combinada",
          legs: [HOME, OVER],
          comboStakeUnits: "150",
        })
      )
    ).toBe("payload");
  });
});
