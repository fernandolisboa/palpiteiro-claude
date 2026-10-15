// Contas do histórico "Suas apostas" (#577): status do slip, recorte Em aberto /
// Encerradas e saldo em unidades. PURO (sem `lib/db`): a query entrega `matchOver`
// já calculado (status do jogo + tempo desde o apito) e as colunas numeric como string.

// ── Status do slip (#473, ADR 0036) ─────────────────────────────────────────
// DERIVADO EM LEITURA (nunca coluna denormalizada). PRECEDÊNCIA PINADA (Decisão 5,
// lost domina): (1) alguma perna com outcome `lost` → errou; (2) senão alguma perna
// `settleable=false` → nao_conferida; (3) senão TODA perna com outcome `won` →
// acertou; (4) senão pendente. Perna pendente/não-liquidada tem outcome=null → não
// conta como `won` → nunca falso-acertou (a armadilha do `bool_and` sobre o NULL do
// LEFT JOIN).
export type SlipStatus = "acertou" | "errou" | "pendente" | "nao_conferida";

export function deriveSlipStatus(
  legs: ReadonlyArray<{ settleable: boolean; outcome: { result: string } | null }>,
): SlipStatus {
  if (legs.some((l) => l.outcome?.result === "lost")) return "errou";
  if (legs.some((l) => !l.settleable)) return "nao_conferida";
  if (legs.length > 0 && legs.every((l) => l.outcome?.result === "won"))
    return "acertou";
  return "pendente";
}

export type LedgerMatchStatus = "scheduled" | "live" | "finished" | "postponed" | "cancelled";

export type SlipLedgerLeg = {
  settleable: boolean;
  userOdd: string | null;
  stakeUnits: string | null;
  outcome: { result: "won" | "lost" | "void" | "push" } | null;
};

export type SlipLedgerRow = {
  id: string;
  mode: "simples" | "combinada" | null;
  stakeUnits: string | null;
  comboUserOdd: string | null;
  matchStatus: LedgerMatchStatus;
  // Jogo encerrado (finished/cancelled) OU apitado há mais que a janela de liquidação:
  // cobre o jogo cujo status o cron ainda não virou (ou nunca vira).
  matchOver: boolean;
  legs: SlipLedgerLeg[];
};

export type SlipBucket = "open" | "closed";

/**
 * Em aberto × Encerradas. Acertou/errou → encerrada. Pendente → em aberto, exceto
 * jogo cancelado (nunca liquida). Adiado continua em aberto (ainda pode ser jogado);
 * pendente de jogo já acabado fica em aberto até o cron liquidar. Não conferida
 * (perna de cartões etc.) fica em aberto até o jogo acabar.
 */
export function slipBucket(
  slip: Pick<SlipLedgerRow, "legs" | "matchStatus" | "matchOver">,
): SlipBucket {
  const status = deriveSlipStatus(slip.legs);
  if (status === "acertou" || status === "errou") return "closed";
  if (status === "pendente") return slip.matchStatus === "cancelled" ? "closed" : "open";
  return slip.matchOver ? "closed" : "open";
}

function positive(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Lucro do slip em unidades, só de acertou/errou. Simples: stake e odd da perna (é
 * onde o cupom grava). Combinada: stake e odd do slip. Ganhou: stake × (odd − 1);
 * errou: −stake. Sem stake ou sem odd (aposta em texto anterior ao cupom) → null:
 * fica fora do saldo.
 */
export function slipProfitUnits(
  slip: Pick<SlipLedgerRow, "mode" | "stakeUnits" | "comboUserOdd" | "legs">,
): number | null {
  const status = deriveSlipStatus(slip.legs);
  if (status !== "acertou" && status !== "errou") return null;
  const single = slip.mode === "simples" || slip.legs.length === 1;
  const stake = positive(single ? (slip.legs[0]?.stakeUnits ?? null) : slip.stakeUnits);
  const odd = positive(single ? (slip.legs[0]?.userOdd ?? null) : slip.comboUserOdd);
  if (stake === null || odd === null) return null;
  return status === "acertou" ? stake * (odd - 1) : -stake;
}

export type SlipLedgerSummary = {
  open: number;
  closed: number;
  won: number;
  lost: number;
  settledWithStake: number;
  settledWithoutStake: number;
  balanceUnits: number;
  openIds: string[];
  closedIds: string[];
};

export function summarizeSlipLedger(rows: readonly SlipLedgerRow[]): SlipLedgerSummary {
  const openIds: string[] = [];
  const closedIds: string[] = [];
  let won = 0;
  let lost = 0;
  let settledWithStake = 0;
  let settledWithoutStake = 0;
  let balance = 0;
  for (const row of rows) {
    (slipBucket(row) === "open" ? openIds : closedIds).push(row.id);
    const status = deriveSlipStatus(row.legs);
    if (status !== "acertou" && status !== "errou") continue;
    if (status === "acertou") won += 1;
    else lost += 1;
    const profit = slipProfitUnits(row);
    if (profit === null) {
      settledWithoutStake += 1;
    } else {
      settledWithStake += 1;
      balance += profit;
    }
  }
  return {
    open: openIds.length,
    closed: closedIds.length,
    won,
    lost,
    settledWithStake,
    settledWithoutStake,
    // Arredonda a soma no fim, não por slip (o `+ 0` tira o -0 de um saldo ~zero).
    balanceUnits: Math.round(balance * 100) / 100 + 0,
    openIds,
    closedIds,
  };
}
