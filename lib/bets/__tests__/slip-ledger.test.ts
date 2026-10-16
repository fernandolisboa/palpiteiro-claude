import { describe, expect, it } from "vitest";

import {
  resolveSlipFilter,
  slipBucket,
  slipProfitUnits,
  summarizeSlipLedger,
  type SlipLedgerLeg,
  type SlipLedgerRow,
} from "@/lib/bets/slip-ledger";

const leg = (over: Partial<SlipLedgerLeg> = {}): SlipLedgerLeg => ({
  settleable: true,
  userOdd: "2.000",
  stakeUnits: null,
  outcome: null,
  ...over,
});
const won = (over: Partial<SlipLedgerLeg> = {}) => leg({ outcome: { result: "won" }, ...over });
const lost = (over: Partial<SlipLedgerLeg> = {}) => leg({ outcome: { result: "lost" }, ...over });

const row = (over: Partial<SlipLedgerRow> = {}): SlipLedgerRow => ({
  id: "s1",
  mode: "simples",
  stakeUnits: null,
  comboUserOdd: null,
  matchStatus: "scheduled",
  matchOver: false,
  isLive: false,
  legs: [leg()],
  ...over,
});

describe("slipBucket", () => {
  it.each([
    ["acertou", row({ legs: [won()], matchStatus: "finished", matchOver: true }), "closed"],
    ["errou", row({ legs: [lost()], matchStatus: "finished", matchOver: true }), "closed"],
    ["pendente", row(), "open"],
    ["pendente de jogo já acabado (cron ainda não liquidou)", row({ matchStatus: "finished", matchOver: true }), "open"],
    ["pendente adiado", row({ matchStatus: "postponed" }), "open"],
    ["pendente com jogo cancelado", row({ matchStatus: "cancelled", matchOver: true }), "closed"],
    ["não conferida antes do fim", row({ legs: [leg({ settleable: false })] }), "open"],
    [
      "não conferida depois do fim",
      row({ legs: [leg({ settleable: false })], matchOver: true }),
      "closed",
    ],
    [
      "combinada com perna não conferível e uma perdida",
      row({ mode: "combinada", legs: [lost(), leg({ settleable: false })] }),
      "closed",
    ],
  ] as const)("%s → %s", (_name, slip, bucket) => {
    expect(slipBucket(slip)).toBe(bucket);
  });
});

describe("slipProfitUnits", () => {
  it("simples: stake e odd da perna", () => {
    expect(slipProfitUnits(row({ legs: [won({ stakeUnits: "1.00", userOdd: "1.880" })] }))).toBeCloseTo(0.88, 9);
    expect(slipProfitUnits(row({ legs: [lost({ stakeUnits: "0.50", userOdd: "1.880" })] }))).toBe(-0.5);
  });

  it("combinada: stake e odd do slip", () => {
    const combo = {
      mode: "combinada" as const,
      stakeUnits: "0.50",
      comboUserOdd: "4.260",
    };
    expect(slipProfitUnits(row({ ...combo, legs: [won(), won()] }))).toBeCloseTo(1.63, 9);
    expect(slipProfitUnits(row({ ...combo, legs: [won(), lost()] }))).toBe(-0.5);
  });

  it("sem stake ou sem odd → null (fora do saldo)", () => {
    expect(slipProfitUnits(row({ legs: [won({ stakeUnits: null })] }))).toBeNull();
    expect(slipProfitUnits(row({ legs: [won({ stakeUnits: "1.00", userOdd: null })] }))).toBeNull();
    expect(
      slipProfitUnits(row({ mode: "combinada", comboUserOdd: "3.000", legs: [won(), won()] })),
    ).toBeNull();
  });

  it("aposta em texto antiga (mode null, sem stake) → null", () => {
    expect(slipProfitUnits(row({ mode: null, legs: [won()] }))).toBeNull();
    expect(slipProfitUnits(row({ mode: null, comboUserOdd: "3.000", legs: [won(), won()] }))).toBeNull();
  });

  it("pendente e não conferida → null", () => {
    expect(slipProfitUnits(row({ legs: [leg({ stakeUnits: "1.00" })] }))).toBeNull();
    expect(
      slipProfitUnits(row({ legs: [leg({ stakeUnits: "1.00", settleable: false })], matchOver: true })),
    ).toBeNull();
  });
});

describe("resolveSlipFilter", () => {
  it.each([
    ["abertas", false, "abertas"],
    ["encerradas", true, "encerradas"],
    [undefined, true, "abertas"],
    [undefined, false, "encerradas"],
    ["todas", true, "abertas"],
    ["", false, "encerradas"],
  ] as const)("%j (há aberta: %s) → %s", (raw, hasOpen, out) => {
    expect(resolveSlipFilter(raw, hasOpen)).toBe(out);
  });
});

describe("summarizeSlipLedger", () => {
  it("contagens, saldo arredondado no fim e apostas sem stake", () => {
    const rows: SlipLedgerRow[] = [
      row({ id: "a", legs: [won({ stakeUnits: "1.00", userOdd: "1.333" })] }),
      row({ id: "b", legs: [won({ stakeUnits: "1.00", userOdd: "1.333" })] }),
      row({ id: "c", legs: [won({ stakeUnits: "1.00", userOdd: "1.334" })] }),
      row({ id: "d", legs: [lost({ stakeUnits: "0.50" })] }),
      row({ id: "e", legs: [won()] }),
      row({ id: "f" }),
      row({ id: "g", legs: [leg({ settleable: false })], matchOver: true }),
    ];
    const s = summarizeSlipLedger(rows);
    expect(s.open).toBe(1);
    expect(s.closed).toBe(6);
    expect(s.won).toBe(4);
    expect(s.lost).toBe(1);
    expect(s.settledWithStake).toBe(4);
    expect(s.settledWithoutStake).toBe(1);
    // 0,333 + 0,333 + 0,334 − 0,5 = 0,5 (somado antes de arredondar).
    expect(s.balanceUnits).toBe(0.5);
    expect(s.openIds).toEqual(["f"]);
    expect([...s.closedIds].sort()).toEqual(["a", "b", "c", "d", "e", "g"]);
  });

  it("vazio", () => {
    expect(summarizeSlipLedger([])).toEqual({
      open: 0,
      closed: 0,
      won: 0,
      lost: 0,
      settledWithStake: 0,
      settledWithoutStake: 0,
      balanceUnits: 0,
      openIds: [],
      closedIds: [],
      live: null,
    });
  });

  it("saldo que arredonda a zero não sai como -0", () => {
    const s = summarizeSlipLedger([
      row({ id: "a", legs: [won({ stakeUnits: "1.00", userOdd: "1.499" })] }),
      row({ id: "b", legs: [lost({ stakeUnits: "0.50" })] }),
    ]);
    expect(Object.is(s.balanceUnits, -0)).toBe(false);
    expect(s.balanceUnits).toBe(0);
  });

  it("ao vivo (#580): fora do resumo de pré-jogo, numa linha própria; listas contam todas", () => {
    const s = summarizeSlipLedger([
      row({ id: "pre", legs: [won({ stakeUnits: "1.00", userOdd: "2.000" })] }),
      row({ id: "live-won", isLive: true, legs: [won({ stakeUnits: "1.00", userOdd: "1.500" })] }),
      row({ id: "live-lost", isLive: true, legs: [lost({ stakeUnits: "2.00" })] }),
      row({ id: "live-open", isLive: true }),
    ]);
    expect(s.won).toBe(1);
    expect(s.lost).toBe(0);
    expect(s.balanceUnits).toBe(1);
    expect(s.settledWithStake).toBe(1);
    expect(s.live).toEqual({
      total: 3,
      won: 1,
      lost: 1,
      settledWithStake: 2,
      settledWithoutStake: 0,
      balanceUnits: -1.5,
    });
    expect(s.open).toBe(1);
    expect(s.openIds).toEqual(["live-open"]);
    expect(s.closed).toBe(3);
  });

  it("primeira aposta ao vivo não mexe no resumo de pré-jogo", () => {
    const pre = [row({ id: "a", legs: [won({ stakeUnits: "1.00", userOdd: "2.000" })] })];
    const before = summarizeSlipLedger(pre);
    const after = summarizeSlipLedger([
      ...pre,
      row({ id: "l", isLive: true, legs: [won({ stakeUnits: "5.00", userOdd: "3.000" })] }),
    ]);
    for (const k of ["won", "lost", "settledWithStake", "settledWithoutStake", "balanceUnits"] as const) {
      expect(after[k]).toBe(before[k]);
    }
    expect(before.live).toBeNull();
    expect(after.live?.total).toBe(1);
  });
});
